import { decryptCalDavPassword, reencryptCalDavPassword } from "./crypto";
import { MigrationError } from "./errors";
import { generateFeedToken } from "./ical-feed-tokens";
import {
  assertReceiptAllowsRun,
  ensureReceiptTable,
  insertReceipt,
  readReceipts,
} from "./receipt";
import {
  columnSql,
  inspectSchema,
  isResolvedTable,
  tableSql,
} from "./schema";
import type {
  KeyPair,
  PreservationCounts,
  QueryClient,
  ResolvedTable,
  RotationEffects,
  RotationReport,
  SchemaResolution,
  TableResolution,
} from "./types";

const ADVISORY_LOCK_KEY_1 = 1_262_702_674;
const ADVISORY_LOCK_KEY_2 = 1_380_922_161;

interface RotateOptions {
  keys: KeyPair;
  targetConfirmedBy: "application_name" | "confirm-target";
}

const emptyEffects = (): RotationEffects => ({
  caldavReencrypted: 0,
  icalFeedTokensRotated: 0,
  calendarPushChannelsDeleted: 0,
  calendarAccountsMarkedReauth: 0,
  oauthCredentialsCleared: 0,
  accountProviderTokensCleared: 0,
  sessionsInvalidated: 0,
  verificationsInvalidated: 0,
  jwksInvalidated: 0,
  oauthAccessTokensInvalidated: 0,
  oauthRefreshTokensInvalidated: 0,
  apiTokensInvalidated: 0,
  oauthClientSecretsCleared: 0,
  oauthClientsDisabled: 0,
});

const countTable = async (
  client: QueryClient,
  tableName: string,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${tableSql(tableName)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
};

const optionalTableCount = (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number> => {
  if (!isResolvedTable(resolution)) {
    return Promise.resolve(0);
  }
  return countTable(client, resolution.tableName);
};

const readPreservationCounts = async (
  client: QueryClient,
  schema: SchemaResolution,
): Promise<PreservationCounts> => ({
  users: await countTable(client, schema.essential.user.tableName),
  calendarAccounts: await countTable(
    client,
    schema.essential.calendar_accounts.tableName,
  ),
  calendars: await countTable(client, schema.essential.calendars.tableName),
  eventStates: await countTable(client, schema.essential.event_states.tableName),
  syncStatuses: await optionalTableCount(client, schema.optional.sync_status ?? null),
  icalFeeds: await optionalTableCount(client, schema.optional.ical_feeds ?? null),
  icalFeedSettings: await optionalTableCount(
    client,
    schema.optional.ical_feed_settings ?? null,
  ),
  icalFeedCalendars: await optionalTableCount(
    client,
    schema.optional.ical_feed_calendars ?? null,
  ),
  eventMappings: await optionalTableCount(
    client,
    schema.optional.event_mappings ?? null,
  ),
  sourceDestinationMappings: await optionalTableCount(
    client,
    schema.optional.source_destination_mappings ?? null,
  ),
  passkeys: await optionalTableCount(client, schema.optional.passkey ?? null),
});

const assertPreserved = (
  before: PreservationCounts,
  after: PreservationCounts,
): void => {
  const fields = Object.keys(before) as (keyof PreservationCounts)[];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      throw new MigrationError(
        "PRESERVATION_FAILED",
        "User, calendar, event, sync, feed, mapping, or passkey row counts changed during rotation",
      );
    }
  }
};

const deleteAll = async (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number> => {
  if (!isResolvedTable(resolution)) {
    return 0;
  }
  const result = await client.query(
    `DELETE FROM ${tableSql(resolution.tableName)}`,
  );
  return result.rowCount ?? 0;
};

const updateAllTrue = async (
  client: QueryClient,
  table: ResolvedTable,
  drizzleName: string,
): Promise<number> => {
  const result = await client.query(
    `UPDATE ${tableSql(table.tableName)}
     SET ${columnSql(table, drizzleName)} = TRUE`,
  );
  return result.rowCount ?? 0;
};

const loadCalDavRows = async (
  client: QueryClient,
  table: ResolvedTable,
): Promise<{ id: string; ciphertext: string }[]> => {
  const result = await client.query<{ id: string; ciphertext: string }>(
    `SELECT ${columnSql(table, "id")}::text AS id,
            ${columnSql(table, "encryptedPassword")} AS ciphertext
     FROM ${tableSql(table.tableName)}`,
  );
  return result.rows;
};

const verifyDecryptsWithKey = (
  rows: { ciphertext: string }[],
  key: string,
): void => {
  for (const row of rows) {
    decryptCalDavPassword(row.ciphertext, key);
  }
};

const rotateCalDavRows = async (
  client: QueryClient,
  table: ResolvedTable,
  rows: { id: string; ciphertext: string }[],
  oldKey: string,
  newKey: string,
): Promise<number> => {
  const rotated = rows.map((row) => ({
    id: row.id,
    ciphertext: reencryptCalDavPassword(row.ciphertext, oldKey, newKey),
  }));
  for (const row of rotated) {
    const result = await client.query(
      `UPDATE ${tableSql(table.tableName)}
       SET ${columnSql(table, "encryptedPassword")} = $1
       WHERE ${columnSql(table, "id")}::text = $2`,
      [row.ciphertext, row.id],
    );
    if (result.rowCount !== 1) {
      throw new MigrationError(
        "CALDAV_UPDATE_FAILED",
        "CalDAV credential update did not affect the expected row",
      );
    }
  }
  return rotated.length;
};

const clearOauthCredentials = async (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number> => {
  if (!isResolvedTable(resolution)) {
    return 0;
  }
  const result = await client.query(
    `UPDATE ${tableSql(resolution.tableName)}
     SET ${columnSql(resolution, "accessToken")} = '',
         ${columnSql(resolution, "refreshToken")} = '',
         ${columnSql(resolution, "needsReauthentication")} = TRUE`,
  );
  return result.rowCount ?? 0;
};

const clearAccountProviderTokens = async (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number> => {
  if (!isResolvedTable(resolution)) {
    return 0;
  }
  const result = await client.query(
    `UPDATE ${tableSql(resolution.tableName)}
     SET ${columnSql(resolution, "accessToken")} = NULL,
         ${columnSql(resolution, "refreshToken")} = NULL,
         ${columnSql(resolution, "idToken")} = NULL
     WHERE ${columnSql(resolution, "accessToken")} IS NOT NULL
        OR ${columnSql(resolution, "refreshToken")} IS NOT NULL
        OR ${columnSql(resolution, "idToken")} IS NOT NULL`,
  );
  return result.rowCount ?? 0;
};

const clearOauthClientSecrets = async (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<{ cleared: number; disabled: number }> => {
  if (!isResolvedTable(resolution)) {
    return { cleared: 0, disabled: 0 };
  }
  const result = await client.query(
    `UPDATE ${tableSql(resolution.tableName)}
     SET ${columnSql(resolution, "clientSecret")} = NULL,
         ${columnSql(resolution, "disabled")} = TRUE
     WHERE NULLIF(${columnSql(resolution, "clientSecret")}, '') IS NOT NULL`,
  );
  const count = result.rowCount ?? 0;
  return { cleared: count, disabled: count };
};

const allocateFeedTokens = (count: number): string[] => {
  const allocated: string[] = [];
  const seen = new Set<string>();
  while (allocated.length < count) {
    const token = generateFeedToken();
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    allocated.push(token);
  }
  return allocated;
};

const loadIcalFeedIds = async (
  client: QueryClient,
  table: ResolvedTable,
): Promise<string[]> => {
  const result = await client.query<{ id: string }>(
    `SELECT ${columnSql(table, "id")}::text AS id
     FROM ${tableSql(table.tableName)}`,
  );
  return result.rows.map((row) => row.id);
};

const rotateIcalFeedTokens = async (
  client: QueryClient,
  resolution: TableResolution | null,
): Promise<number> => {
  if (!isResolvedTable(resolution)) {
    return 0;
  }
  const ids = await loadIcalFeedIds(client, resolution);
  const tokens = allocateFeedTokens(ids.length);
  for (const [index, id] of ids.entries()) {
    const token = tokens[index];
    if (!token) {
      throw new MigrationError(
        "ICAL_FEED_UPDATE_FAILED",
        "iCal feed token allocation did not cover every feed row",
      );
    }
    const result = await client.query(
      `UPDATE ${tableSql(resolution.tableName)}
       SET ${columnSql(resolution, "token")} = $1,
           ${columnSql(resolution, "legacyAlias")} = FALSE
       WHERE ${columnSql(resolution, "id")}::text = $2`,
      [token, id],
    );
    if (result.rowCount !== 1) {
      throw new MigrationError(
        "ICAL_FEED_UPDATE_FAILED",
        "iCal feed token update did not affect the expected row",
      );
    }
  }
  return ids.length;
};

type InvalidationEffects = Omit<
  RotationEffects,
  "caldavReencrypted" | "icalFeedTokensRotated"
>;

const runInvalidations = async (
  client: QueryClient,
  schema: SchemaResolution,
): Promise<InvalidationEffects> => {
  const oauthClients = await clearOauthClientSecrets(
    client,
    schema.optional.oauth_application ?? null,
  );
  return {
    calendarPushChannelsDeleted: await deleteAll(
      client,
      schema.optional.calendar_push_channels ?? null,
    ),
    calendarAccountsMarkedReauth: await updateAllTrue(
      client,
      schema.essential.calendar_accounts,
      "needsReauthentication",
    ),
    oauthCredentialsCleared: await clearOauthCredentials(
      client,
      schema.optional.oauth_credentials ?? null,
    ),
    accountProviderTokensCleared: await clearAccountProviderTokens(
      client,
      schema.optional.account ?? null,
    ),
    sessionsInvalidated: await deleteAll(client, schema.optional.session ?? null),
    verificationsInvalidated: await deleteAll(
      client,
      schema.optional.verification ?? null,
    ),
    jwksInvalidated: await deleteAll(client, schema.optional.jwks ?? null),
    oauthAccessTokensInvalidated: await deleteAll(
      client,
      schema.optional.oauth_access_token ?? null,
    ),
    oauthRefreshTokensInvalidated: await deleteAll(
      client,
      schema.optional.oauth_refresh_token ?? null,
    ),
    apiTokensInvalidated: await deleteAll(client, schema.optional.api_tokens ?? null),
    oauthClientSecretsCleared: oauthClients.cleared,
    oauthClientsDisabled: oauthClients.disabled,
  };
};

const rollbackQuietly = async (client: QueryClient): Promise<void> => {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* The original rotation error is reported instead of a rollback failure. */
  }
};

const rotateTarget = async (
  client: QueryClient,
  options: RotateOptions,
): Promise<RotationReport> => {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ADVISORY_LOCK_KEY_1,
      ADVISORY_LOCK_KEY_2,
    ]);
    const schema = await inspectSchema(client);
    const preservedBefore = await readPreservationCounts(client, schema);
    await ensureReceiptTable(client);
    const receipts = await readReceipts(client);
    const receiptKind = assertReceiptAllowsRun(
      receipts,
      options.keys.oldFingerprint,
      options.keys.newFingerprint,
    );
    const caldavRows = await loadCalDavRows(
      client,
      schema.essential.caldav_credentials,
    );

    if (receiptKind === "replay") {
      verifyDecryptsWithKey(caldavRows, options.keys.newKey);
      const preservedAfter = await readPreservationCounts(client, schema);
      assertPreserved(preservedBefore, preservedAfter);
      await client.query("COMMIT");
      return {
        alreadyCompleted: true,
        targetConfirmedBy: options.targetConfirmedBy,
        oldKeyFingerprint: options.keys.oldFingerprint,
        newKeyFingerprint: options.keys.newFingerprint,
        effects: emptyEffects(),
        missingOptionalTables: schema.missingOptionalTables,
        preserved: preservedAfter,
      };
    }

    const caldavReencrypted = await rotateCalDavRows(
      client,
      schema.essential.caldav_credentials,
      caldavRows,
      options.keys.oldKey,
      options.keys.newKey,
    );
    const icalFeedTokensRotated = await rotateIcalFeedTokens(
      client,
      schema.optional.ical_feeds ?? null,
    );
    const invalidations = await runInvalidations(client, schema);
    await insertReceipt(
      client,
      options.keys.oldFingerprint,
      options.keys.newFingerprint,
    );
    const preservedAfter = await readPreservationCounts(client, schema);
    assertPreserved(preservedBefore, preservedAfter);
    await client.query("COMMIT");
    return {
      alreadyCompleted: false,
      targetConfirmedBy: options.targetConfirmedBy,
      oldKeyFingerprint: options.keys.oldFingerprint,
      newKeyFingerprint: options.keys.newFingerprint,
      effects: { caldavReencrypted, icalFeedTokensRotated, ...invalidations },
      missingOptionalTables: schema.missingOptionalTables,
      preserved: preservedAfter,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
};

export { ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2, rotateTarget };
export type { RotateOptions };
