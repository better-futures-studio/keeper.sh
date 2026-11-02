import { TARGET_MARKER } from "./config";
import {
  columnSql,
  inspectSchema,
  isResolvedTable,
  tableSql,
} from "./schema";
import type {
  AuditCounts,
  AuditOptionalCounts,
  AuditReport,
  EssentialResolution,
  OptionalResolution,
  QueryClient,
  ResolvedTable,
  SchemaResolution,
  TableResolution,
} from "./types";

const countRows = async (
  client: QueryClient,
  tableName: string,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${tableSql(tableName)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
};

const countWhereTrue = async (
  client: QueryClient,
  table: ResolvedTable,
  drizzleName: string,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM ${tableSql(table.tableName)}
     WHERE ${columnSql(table, drizzleName)} = TRUE`,
  );
  return Number(result.rows[0]?.count ?? 0);
};

const countNonEmpty = async (
  client: QueryClient,
  table: ResolvedTable,
  drizzleName: string,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM ${tableSql(table.tableName)}
     WHERE NULLIF(${columnSql(table, drizzleName)}, '') IS NOT NULL`,
  );
  return Number(result.rows[0]?.count ?? 0);
};

const optionalCount = (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number | "missing"> => {
  if (!isResolvedTable(resolution)) {
    return Promise.resolve("missing");
  }
  return countRows(client, resolution.tableName);
};

const readEssentialCounts = async (
  client: QueryClient,
  essential: EssentialResolution,
): Promise<AuditCounts> => ({
  user: await countRows(client, essential.user.tableName),
  calendar_accounts: await countRows(client, essential.calendar_accounts.tableName),
  calendars: await countRows(client, essential.calendars.tableName),
  caldav_credentials: await countRows(
    client,
    essential.caldav_credentials.tableName,
  ),
  event_states: await countRows(client, essential.event_states.tableName),
});

const readOptionalCounts = async (
  client: QueryClient,
  optional: OptionalResolution,
): Promise<AuditOptionalCounts> => {
  const counts = {} as AuditOptionalCounts;
  for (const tableName of Object.keys(optional) as (keyof OptionalResolution)[]) {
    counts[tableName] = await optionalCount(client, optional[tableName]);
  }
  return counts;
};

const readStatuses = async (
  client: QueryClient,
  schema: SchemaResolution,
): Promise<Record<string, number>> => {
  const statuses: Record<string, number> = {
    calendar_accounts_needs_reauthentication: await countWhereTrue(
      client,
      schema.essential.calendar_accounts,
      "needsReauthentication",
    ),
  };
  const oauthCredentials = schema.optional.oauth_credentials;
  if (isResolvedTable(oauthCredentials)) {
    statuses.oauth_credentials_needs_reauthentication = await countWhereTrue(
      client,
      oauthCredentials,
      "needsReauthentication",
    );
    statuses.oauth_credentials_access_token_present = await countNonEmpty(
      client,
      oauthCredentials,
      "accessToken",
    );
    statuses.oauth_credentials_refresh_token_present = await countNonEmpty(
      client,
      oauthCredentials,
      "refreshToken",
    );
  }
  const oauthApplication = schema.optional.oauth_application;
  if (isResolvedTable(oauthApplication)) {
    statuses.oauth_application_disabled = await countWhereTrue(
      client,
      oauthApplication,
      "disabled",
    );
    statuses.oauth_application_client_secret_present = await countNonEmpty(
      client,
      oauthApplication,
      "clientSecret",
    );
  }
  const icalFeeds = schema.optional.ical_feeds;
  if (isResolvedTable(icalFeeds)) {
    statuses.ical_feeds_legacy_alias = await countWhereTrue(
      client,
      icalFeeds,
      "legacyAlias",
    );
  }
  return statuses;
};

const runAudit = async (
  client: QueryClient,
  applicationName: string,
): Promise<AuditReport> => {
  const schema = await inspectSchema(client);
  return {
    applicationName,
    targetMarkerPresent: applicationName === TARGET_MARKER,
    essential: await readEssentialCounts(client, schema.essential),
    optional: await readOptionalCounts(client, schema.optional),
    statuses: await readStatuses(client, schema),
    missingOptionalTables: schema.missingOptionalTables,
  };
};

export { runAudit };
