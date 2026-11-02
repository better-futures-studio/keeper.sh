import { MigrationError } from "./errors";
import { RECEIPT_COLUMNS, RECEIPT_TABLE, tableSql } from "./schema";
import { quoteIdent } from "./sql";
import type { QueryClient } from "./types";

interface ReceiptRow {
  old_key_fingerprint: string;
  new_key_fingerprint: string;
}

const createReceiptTableSql = (): string =>
  `CREATE TABLE IF NOT EXISTS ${tableSql(RECEIPT_TABLE)} (
    ${quoteIdent("old_key_fingerprint")} text NOT NULL,
    ${quoteIdent("new_key_fingerprint")} text NOT NULL,
    ${quoteIdent("completed_at")} timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (${quoteIdent("old_key_fingerprint")}, ${quoteIdent("new_key_fingerprint")})
  )`;

const loadReceiptColumns = async (
  client: QueryClient,
): Promise<Set<string> | null> => {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [RECEIPT_TABLE],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return new Set(result.rows.map((row) => row.column_name));
};

const assertReceiptLayout = (columns: Set<string>): void => {
  for (const column of RECEIPT_COLUMNS) {
    if (!columns.has(column)) {
      throw new MigrationError(
        "SCHEMA_LAYOUT",
        "Migration receipt table has an unexpected layout",
      );
    }
  }
};

const ensureReceiptTable = async (client: QueryClient): Promise<void> => {
  const existing = await loadReceiptColumns(client);
  if (!existing) {
    await client.query(createReceiptTableSql());
    return;
  }
  assertReceiptLayout(existing);
};

const readReceipts = async (client: QueryClient): Promise<ReceiptRow[]> => {
  const result = await client.query<ReceiptRow>(
    `SELECT ${quoteIdent("old_key_fingerprint")}, ${quoteIdent("new_key_fingerprint")}
     FROM ${tableSql(RECEIPT_TABLE)}`,
  );
  return result.rows;
};

type ReceiptDecision =
  | { kind: "fresh" }
  | { kind: "replay" }
  | { kind: "conflict" };

const decideReceipt = (
  rows: ReceiptRow[],
  oldFingerprint: string,
  newFingerprint: string,
): ReceiptDecision => {
  if (rows.length === 0) {
    return { kind: "fresh" };
  }
  const matching = rows.filter(
    (row) =>
      row.old_key_fingerprint === oldFingerprint
      && row.new_key_fingerprint === newFingerprint,
  );
  if (matching.length === rows.length) {
    return { kind: "replay" };
  }
  return { kind: "conflict" };
};

const assertReceiptAllowsRun = (
  rows: ReceiptRow[],
  oldFingerprint: string,
  newFingerprint: string,
): "fresh" | "replay" => {
  const decision = decideReceipt(rows, oldFingerprint, newFingerprint);
  if (decision.kind === "conflict") {
    throw new MigrationError(
      "RECEIPT_CONFLICT",
      "A migration receipt exists for different key fingerprints",
    );
  }
  return decision.kind;
};

const insertReceipt = async (
  client: QueryClient,
  oldFingerprint: string,
  newFingerprint: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO ${tableSql(RECEIPT_TABLE)} (
      ${quoteIdent("old_key_fingerprint")},
      ${quoteIdent("new_key_fingerprint")}
    ) VALUES ($1, $2)
    ON CONFLICT (${quoteIdent("old_key_fingerprint")}, ${quoteIdent("new_key_fingerprint")})
    DO NOTHING`,
    [oldFingerprint, newFingerprint],
  );
};

export {
  assertReceiptAllowsRun,
  decideReceipt,
  ensureReceiptTable,
  insertReceipt,
  readReceipts,
};
export type { ReceiptDecision, ReceiptRow };
