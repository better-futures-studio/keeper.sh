import { MigrationError } from "./errors";
import { quoteIdent, toSnakeCase } from "./sql";
import type {
  EssentialResolution,
  OptionalResolution,
  QueryClient,
  ResolvedTable,
  SchemaResolution,
  TableResolution,
} from "./types";

/*
 * Logical fields follow packages/database/src/database/schema.ts and
 * auth-schema.ts. This repo's drizzle.config.ts does not set casing, so the
 * generated SQL uses quoted camelCase names. A snake_case layout is also
 * accepted if that is what information_schema reports. Both present is
 * rejected as ambiguous.
 */
const ESSENTIAL_TABLES = {
  user: ["id"],
  calendar_accounts: ["id", "authType", "needsReauthentication"],
  calendars: ["id"],
  caldav_credentials: ["id", "encryptedPassword"],
  event_states: ["id"],
} as const;

/*
 * ICS subscriptions use authType none and store no provider credentials.
 * Credential-backed oauth/caldav accounts still need reauth after a copy.
 */
const UNAUTHENTICATED_CALENDAR_AUTH_TYPE = "none" as const;

const OPTIONAL_TABLES = {
  oauth_credentials: [
    "id",
    "accessToken",
    "refreshToken",
    "needsReauthentication",
  ],
  account: ["id", "accessToken", "refreshToken", "idToken", "password"],
  session: ["id"],
  verification: ["id"],
  jwks: ["id", "privateKey"],
  oauth_application: ["id", "clientSecret", "disabled"],
  oauth_access_token: ["id"],
  oauth_refresh_token: ["id"],
  api_tokens: ["id"],
  sync_status: ["id"],
  ical_feeds: ["id", "token", "legacyAlias"],
  ical_feed_settings: ["userId"],
  ical_feed_calendars: ["id", "feedId"],
  calendar_push_channels: ["id", "secretHash"],
  event_mappings: ["id"],
  source_destination_mappings: ["id"],
  passkey: ["id", "publicKey"],
} as const;

const RECEIPT_TABLE = "aws_migration_key_rotation_receipt";

const RECEIPT_COLUMNS = [
  "old_key_fingerprint",
  "new_key_fingerprint",
  "completed_at",
] as const;

type EssentialTableName = keyof typeof ESSENTIAL_TABLES;
type OptionalTableName = keyof typeof OPTIONAL_TABLES;

const resolveColumnName = (
  tableName: string,
  drizzleName: string,
  presentColumns: Set<string>,
): string => {
  const snakeName = toSnakeCase(drizzleName);
  const hasDrizzleName = presentColumns.has(drizzleName);
  const hasSnakeName = presentColumns.has(snakeName);
  if (hasDrizzleName && hasSnakeName && drizzleName !== snakeName) {
    throw new MigrationError(
      "SCHEMA_LAYOUT",
      `Ambiguous column layout on ${tableName}`,
    );
  }
  if (hasSnakeName) {
    return snakeName;
  }
  if (hasDrizzleName) {
    return drizzleName;
  }
  throw new MigrationError(
    "SCHEMA_LAYOUT",
    `Required column is missing on ${tableName}`,
  );
};

const resolveTable = (
  tableName: string,
  drizzleColumns: readonly string[],
  presentColumns: Set<string> | null,
): ResolvedTable => {
  if (!presentColumns) {
    throw new MigrationError(
      "SCHEMA_MISSING_ESSENTIAL",
      `Essential table ${tableName} is missing`,
    );
  }
  const columns: ResolvedTable["columns"] = {};
  for (const drizzleName of drizzleColumns) {
    columns[drizzleName] = {
      drizzleName,
      sqlName: resolveColumnName(tableName, drizzleName, presentColumns),
    };
  }
  return { tableName, columns, present: true };
};

const resolveOptionalTable = (
  tableName: string,
  drizzleColumns: readonly string[],
  presentColumns: Set<string> | null,
): TableResolution => {
  if (!presentColumns) {
    return { tableName, present: false };
  }
  return resolveTable(tableName, drizzleColumns, presentColumns);
};

const loadColumnMap = async (
  client: QueryClient,
): Promise<Map<string, Set<string>>> => {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  const tables = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const existing = tables.get(row.table_name) ?? new Set<string>();
    existing.add(row.column_name);
    tables.set(row.table_name, existing);
  }
  return tables;
};

const columnsOf = (
  columnMap: Map<string, Set<string>>,
  tableName: string,
): Set<string> | null => columnMap.get(tableName) ?? null;

const inspectSchema = async (client: QueryClient): Promise<SchemaResolution> => {
  const columnMap = await loadColumnMap(client);
  const essential = {} as EssentialResolution;
  for (const tableName of Object.keys(ESSENTIAL_TABLES) as EssentialTableName[]) {
    essential[tableName] = resolveTable(
      tableName,
      ESSENTIAL_TABLES[tableName],
      columnsOf(columnMap, tableName),
    );
  }

  const optional = {} as OptionalResolution;
  for (const tableName of Object.keys(OPTIONAL_TABLES) as OptionalTableName[]) {
    optional[tableName] = resolveOptionalTable(
      tableName,
      OPTIONAL_TABLES[tableName],
      columnsOf(columnMap, tableName),
    );
  }
  const missingOptionalTables = Object.entries(optional)
    .filter(([, resolution]) => !resolution.present)
    .map(([tableName]) => tableName);

  return { essential, optional, missingOptionalTables };
};

const columnSql = (table: ResolvedTable, drizzleName: string): string => {
  const column = table.columns[drizzleName];
  if (!column) {
    throw new MigrationError(
      "SCHEMA_LAYOUT",
      `Required column is missing on ${table.tableName}`,
    );
  }
  return quoteIdent(column.sqlName);
};

const tableSql = (tableName: string): string => quoteIdent(tableName);

const isResolvedTable = (
  resolution: TableResolution | null,
): resolution is ResolvedTable => Boolean(resolution?.present);

export {
  ESSENTIAL_TABLES,
  OPTIONAL_TABLES,
  RECEIPT_COLUMNS,
  RECEIPT_TABLE,
  UNAUTHENTICATED_CALENDAR_AUTH_TYPE,
  columnSql,
  inspectSchema,
  isResolvedTable,
  resolveColumnName,
  tableSql,
};
export type { EssentialTableName, OptionalTableName };
