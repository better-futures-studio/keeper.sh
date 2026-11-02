import type { QueryClient, QueryResult, QueryResultRow } from "../src/types";

interface ColumnRow {
  table_name: string;
  column_name: string;
}

interface MockDatabase {
  columns: ColumnRow[];
  counts: Record<string, number>;
  caldav: { id: string; ciphertext: string }[];
  icalFeeds?: { id: string }[];
  calendarAccounts?: { id: string; authType: string }[];
  receipts: {
    old_key_fingerprint: string;
    new_key_fingerprint: string;
  }[];
}

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

const CAMEL_CASE_LAYOUT: ColumnRow[] = [
  { table_name: "user", column_name: "id" },
  { table_name: "calendar_accounts", column_name: "id" },
  { table_name: "calendar_accounts", column_name: "authType" },
  { table_name: "calendar_accounts", column_name: "needsReauthentication" },
  { table_name: "calendars", column_name: "id" },
  { table_name: "caldav_credentials", column_name: "id" },
  { table_name: "caldav_credentials", column_name: "encryptedPassword" },
  { table_name: "event_states", column_name: "id" },
  { table_name: "oauth_credentials", column_name: "id" },
  { table_name: "oauth_credentials", column_name: "accessToken" },
  { table_name: "oauth_credentials", column_name: "refreshToken" },
  { table_name: "oauth_credentials", column_name: "needsReauthentication" },
  { table_name: "account", column_name: "id" },
  { table_name: "account", column_name: "accessToken" },
  { table_name: "account", column_name: "refreshToken" },
  { table_name: "account", column_name: "idToken" },
  { table_name: "account", column_name: "password" },
  { table_name: "session", column_name: "id" },
  { table_name: "verification", column_name: "id" },
  { table_name: "jwks", column_name: "id" },
  { table_name: "jwks", column_name: "privateKey" },
  { table_name: "oauth_application", column_name: "id" },
  { table_name: "oauth_application", column_name: "clientSecret" },
  { table_name: "oauth_application", column_name: "disabled" },
  { table_name: "oauth_access_token", column_name: "id" },
  { table_name: "oauth_refresh_token", column_name: "id" },
  { table_name: "api_tokens", column_name: "id" },
  { table_name: "sync_status", column_name: "id" },
  { table_name: "ical_feeds", column_name: "id" },
  { table_name: "ical_feeds", column_name: "token" },
  { table_name: "ical_feeds", column_name: "legacyAlias" },
  { table_name: "ical_feed_settings", column_name: "userId" },
  { table_name: "ical_feed_calendars", column_name: "id" },
  { table_name: "ical_feed_calendars", column_name: "feedId" },
  { table_name: "calendar_push_channels", column_name: "id" },
  { table_name: "calendar_push_channels", column_name: "secretHash" },
  { table_name: "event_mappings", column_name: "id" },
  { table_name: "source_destination_mappings", column_name: "id" },
  { table_name: "passkey", column_name: "id" },
  { table_name: "passkey", column_name: "publicKey" },
];

const SNAKE_CASE_LAYOUT: ColumnRow[] = CAMEL_CASE_LAYOUT.map((row) => ({
  table_name: row.table_name,
  column_name: row.column_name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase(),
}));

const rows = <Row>(
  items: Row[],
  rowCount = items.length,
): QueryResult<Row> => ({ rows: items, rowCount });

const quotedTable = (sql: string, keyword: string): string | null => {
  const match = new RegExp(`${keyword}\\s+"([^"]+)"`, "i").exec(sql);
  const name = match?.[1];
  if (name) {
    return name;
  }
  return null;
};

const tableNameFromSql = (sql: string): string => {
  const fromName = quotedTable(sql, "FROM");
  if (fromName) {
    return fromName;
  }
  const updateName = quotedTable(sql, "UPDATE");
  if (updateName) {
    return updateName;
  }
  const deleteName = quotedTable(sql, "DELETE FROM");
  if (deleteName) {
    return deleteName;
  }
  return "";
};

const mutationRowCount = (
  sql: string,
  database: MockDatabase,
  values: unknown[],
): number => {
  const tableName = tableNameFromSql(sql);
  if (
    sql.includes("WHERE")
    && (tableName === "caldav_credentials" || tableName === "ical_feeds")
  ) {
    return 1;
  }
  if (
    tableName === "calendar_accounts"
    && sql.startsWith("UPDATE")
    && database.calendarAccounts
  ) {
    const excludedAuthType = String(values[0] ?? "");
    return database.calendarAccounts.filter(
      (account) => account.authType !== excludedAuthType,
    ).length;
  }
  return database.counts[tableName] ?? 1;
};

const respondInformationSchema = (
  sql: string,
  values: unknown[],
  database: MockDatabase,
): QueryResult<unknown> | null => {
  if (!sql.includes("FROM information_schema.columns")) {
    return null;
  }
  if (sql.includes("table_name = $1")) {
    const tableName = String(values[0] ?? "");
    return rows(
      database.columns
        .filter((column) => column.table_name === tableName)
        .map((column) => ({ column_name: column.column_name })),
    );
  }
  return rows(database.columns);
};

const respondRows = (
  sql: string,
  values: unknown[],
  database: MockDatabase,
): QueryResult<unknown> | null => {
  if (sql.includes("old_key_fingerprint") && sql.includes("SELECT")) {
    return rows(database.receipts);
  }
  if (sql.startsWith("INSERT INTO")) {
    return rows([], 1);
  }
  if (sql.includes("AS ciphertext")) {
    return rows(database.caldav);
  }
  if (sql.includes('FROM "ical_feeds"') && sql.includes("AS id")) {
    return rows((database.icalFeeds ?? []).map((feed) => ({ id: feed.id })));
  }
  if (sql.startsWith("SELECT count(*)")) {
    const tableName = tableNameFromSql(sql);
    return rows([{ count: String(database.counts[tableName] ?? 0) }]);
  }
  if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
    return rows([], mutationRowCount(sql, database, values));
  }
  return null;
};

const respond = (
  text: string,
  values: unknown[],
  database: MockDatabase,
): QueryResult<unknown> => {
  const sql = text.replaceAll(/\s+/g, " ").trim();
  if (
    sql === "BEGIN"
    || sql === "COMMIT"
    || sql === "ROLLBACK"
    || sql.startsWith("SELECT pg_advisory_xact_lock")
    || sql.startsWith("CREATE TABLE")
  ) {
    return rows([]);
  }
  const schemaResult = respondInformationSchema(sql, values, database);
  if (schemaResult) {
    return schemaResult;
  }
  const rowResult = respondRows(sql, values, database);
  if (rowResult) {
    return rowResult;
  }
  throw new Error("unmocked query");
};

const createMockClient = (
  database: MockDatabase,
): { client: QueryClient; recorded: RecordedQuery[] } => {
  const recorded: RecordedQuery[] = [];
  const client: QueryClient = {
    query: <Row = QueryResultRow>(
      text: string,
      values: unknown[] = [],
    ): Promise<QueryResult<Row>> => {
      recorded.push({ sql: text, values });
      return Promise.resolve(respond(text, values, database) as QueryResult<Row>);
    },
  };
  return { client, recorded };
};

export { CAMEL_CASE_LAYOUT, SNAKE_CASE_LAYOUT, createMockClient };
export type { MockDatabase, RecordedQuery };
