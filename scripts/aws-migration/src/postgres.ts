import { Client } from "pg";
import { MigrationError } from "./errors";
import type { QueryClient, QueryResult, QueryResultRow } from "./types";

const TOOL_APPLICATION_NAME = "keeper-aws-migration";

const wrapQueryClient = (client: Client): QueryClient => ({
  query: async <Row = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> => {
    try {
      const result = await client.query(text, values);
      return { rowCount: result.rowCount, rows: result.rows as Row[] };
    } catch {
      throw new MigrationError("DATABASE_QUERY_FAILED", "A database query failed");
    }
  },
});

const connectDatabase = async (databaseUrl: string): Promise<{
  client: Client;
  queries: QueryClient;
}> => {
  const client = new Client({
    connectionString: databaseUrl,
  });
  try {
    await client.connect();
  } catch {
    throw new MigrationError(
      "DATABASE_CONNECT_FAILED",
      "Failed to connect to the database",
    );
  }
  return { client, queries: wrapQueryClient(client) };
};

const readApplicationName = async (queries: QueryClient): Promise<string> => {
  const result = await queries.query<{ application_name: string }>(
    "SELECT current_setting('application_name', true) AS application_name",
  );
  return result.rows[0]?.application_name ?? "";
};

const closeDatabase = async (client: Client): Promise<void> => {
  try {
    await client.end();
  } catch {
    throw new MigrationError(
      "DATABASE_DISCONNECT_FAILED",
      "Failed to close the database connection",
    );
  }
};

export {
  TOOL_APPLICATION_NAME,
  closeDatabase,
  connectDatabase,
  readApplicationName,
  wrapQueryClient,
};
