import { describe, expect, it } from "bun:test";
import { assertReceiptAllowsRun, decideReceipt } from "../src/receipt";
import { MigrationError } from "../src/errors";

const OLD_FINGERPRINT = "sha256:old";
const NEW_FINGERPRINT = "sha256:new";

describe("receipt consistency", () => {
  it("treats an empty receipt table as a fresh run", () => {
    expect(decideReceipt([], OLD_FINGERPRINT, NEW_FINGERPRINT)).toEqual({
      kind: "fresh",
    });
    expect(assertReceiptAllowsRun([], OLD_FINGERPRINT, NEW_FINGERPRINT)).toBe(
      "fresh",
    );
  });

  it("replays when every stored row matches both fingerprints", () => {
    const rows = [
      {
        old_key_fingerprint: OLD_FINGERPRINT,
        new_key_fingerprint: NEW_FINGERPRINT,
      },
    ];
    expect(decideReceipt(rows, OLD_FINGERPRINT, NEW_FINGERPRINT)).toEqual({
      kind: "replay",
    });
    expect(assertReceiptAllowsRun(rows, OLD_FINGERPRINT, NEW_FINGERPRINT)).toBe(
      "replay",
    );
  });

  it("fails closed when fingerprints change", () => {
    const rows = [
      {
        old_key_fingerprint: OLD_FINGERPRINT,
        new_key_fingerprint: NEW_FINGERPRINT,
      },
    ];
    expect(
      decideReceipt(rows, OLD_FINGERPRINT, "sha256:other"),
    ).toEqual({ kind: "conflict" });
    expect(() =>
      assertReceiptAllowsRun(rows, OLD_FINGERPRINT, "sha256:other"),
    ).toThrow(MigrationError);
    expect(() =>
      assertReceiptAllowsRun(rows, OLD_FINGERPRINT, "sha256:other"),
    ).toThrow(/different key fingerprints/);
  });
});
