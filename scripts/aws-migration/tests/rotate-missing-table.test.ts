import { encodeBase64 } from "tweetnacl-util";
import { describe, expect, it } from "bun:test";
import { KEY_BYTE_LENGTH, fingerprintKey } from "../src/crypto";
import { rotateTarget } from "../src/rotate";
import { CAMEL_CASE_LAYOUT, createMockClient } from "./mock-client";

const oldKey = encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(31));
const newKey = encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(32));

describe("essential schema presence", () => {
  it("fails closed when an essential table is missing", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT.filter((column) => column.table_name !== "user"),
      counts: {},
      caldav: [],
      receipts: [],
    });

    await expect(
      rotateTarget(client, {
        keys: {
          oldKey,
          newKey,
          oldFingerprint: fingerprintKey(oldKey),
          newFingerprint: fingerprintKey(newKey),
        },
        targetConfirmedBy: "confirm-target",
      }),
    ).rejects.toThrow(/Essential table user is missing/);
    expect(recorded.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("fails closed when calendar_accounts.authType is missing", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT.filter(
        (column) =>
          !(
            column.table_name === "calendar_accounts"
            && column.column_name === "authType"
          ),
      ),
      counts: {},
      caldav: [],
      receipts: [],
    });

    await expect(
      rotateTarget(client, {
        keys: {
          oldKey,
          newKey,
          oldFingerprint: fingerprintKey(oldKey),
          newFingerprint: fingerprintKey(newKey),
        },
        targetConfirmedBy: "confirm-target",
      }),
    ).rejects.toThrow(/Required column is missing on calendar_accounts/);
    expect(recorded.at(-1)?.sql).toBe("ROLLBACK");
  });
});
