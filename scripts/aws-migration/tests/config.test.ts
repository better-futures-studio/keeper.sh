import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBase64 } from "tweetnacl-util";
import { describe, expect, it } from "bun:test";
import {
  TARGET_MARKER,
  confirmRotationTarget,
  loadKeyPair,
  parseArgs,
  resolveDatabaseUrl,
} from "../src/config";
import { KEY_BYTE_LENGTH } from "../src/crypto";
import { MigrationError } from "../src/errors";

const keyFromByte = (value: number): string =>
  encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(value));

const writeMode = async (
  directory: string,
  name: string,
  contents: string,
  mode: number,
): Promise<string> => {
  const filePath = join(directory, name);
  await writeFile(filePath, contents);
  await chmod(filePath, mode);
  return filePath;
};

describe("CLI argument parsing", () => {
  it("rejects connection URLs on the command line", () => {
    expect(() =>
      parseArgs(["audit", "postgres://local/db"]),
    ).toThrow(MigrationError);
    expect(() =>
      parseArgs(["audit", "--database-url", "postgresql://local/db"]),
    ).toThrow(/must not be passed/);
  });

  it("parses audit and rotate-target flags", () => {
    expect(parseArgs(["audit", "--database-url-file", "/tmp/url"])).toEqual({
      command: "audit",
      confirmTarget: null,
      databaseUrlFile: "/tmp/url",
      oldKeyFile: null,
      newKeyFile: null,
    });
    expect(
      parseArgs([
        "rotate-target",
        "--old-key-file",
        "/tmp/old",
        "--new-key-file",
        "/tmp/new",
        "--confirm-target",
        TARGET_MARKER,
      ]),
    ).toMatchObject({
      command: "rotate-target",
      confirmTarget: TARGET_MARKER,
      oldKeyFile: "/tmp/old",
      newKeyFile: "/tmp/new",
    });
  });
});

describe("DATABASE_URL loading", () => {
  it("reads the environment when no file is given", async () => {
    const url = await resolveDatabaseUrl(
      { DATABASE_URL: "postgres://local/keeper" },
      null,
    );
    expect(url).toBe("postgres://local/keeper");
  });

  it("requires mode 0600 for a database URL file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aws-migration-url-"));
    const openFile = await writeMode(
      directory,
      "url",
      "postgres://local/keeper\n",
      0o644,
    );
    await expect(resolveDatabaseUrl({}, openFile)).rejects.toThrow(/mode 0600/);
    const locked = await writeMode(
      directory,
      "url-locked",
      "postgres://local/keeper\n",
      0o600,
    );
    await expect(resolveDatabaseUrl({}, locked)).resolves.toBe(
      "postgres://local/keeper",
    );
  });
});

describe("rotation target confirmation", () => {
  it("accepts the application_name marker or the explicit flag", () => {
    expect(confirmRotationTarget(TARGET_MARKER)).toBe(
      "application_name",
    );
    expect(confirmRotationTarget("other", TARGET_MARKER)).toBe("confirm-target");
  });

  it("rejects an unconfirmed target and a wrong confirm value", () => {
    expect(() => confirmRotationTarget("other")).toThrow(
      /application_name/,
    );
    expect(() => confirmRotationTarget("other", "production")).toThrow(
      /Invalid --confirm-target/,
    );
  });
});

describe("encryption key files", () => {
  it("loads distinct keys from mode-0600 files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aws-migration-keys-"));
    const oldFile = await writeMode(directory, "old", keyFromByte(11), 0o600);
    const newFile = await writeMode(directory, "new", keyFromByte(12), 0o600);
    const pair = await loadKeyPair(oldFile, newFile);
    expect(pair.oldFingerprint.startsWith("sha256:")).toBe(true);
    expect(pair.newFingerprint.startsWith("sha256:")).toBe(true);
    expect(pair.oldFingerprint).not.toBe(pair.newFingerprint);
  });

  it("rejects identical keys and world-readable key files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aws-migration-bad-keys-"));
    const key = keyFromByte(13);
    const oldFile = await writeMode(directory, "old", key, 0o600);
    const sameFile = await writeMode(directory, "same", key, 0o600);
    await expect(loadKeyPair(oldFile, sameFile)).rejects.toThrow(/different/);
    const openFile = await writeMode(directory, "open", keyFromByte(14), 0o644);
    await expect(loadKeyPair(oldFile, openFile)).rejects.toThrow(/mode 0600/);
  });
});
