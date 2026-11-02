import { encodeBase64 } from "tweetnacl-util";
import { describe, expect, it } from "bun:test";
import {
  KEY_BYTE_LENGTH,
  assertKeysDistinct,
  decryptCalDavPassword,
  encryptCalDavPassword,
  fingerprintKey,
  parseEncryptionKey,
  reencryptCalDavPassword,
} from "../src/crypto";
import { MigrationError } from "../src/errors";

const keyFromByte = (value: number): string =>
  encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(value));

describe("encryption key parsing", () => {
  it("accepts a 32-byte base64 key and fingerprints the raw bytes", () => {
    const key = keyFromByte(3);
    expect(parseEncryptionKey(` ${key}\n `)).toBe(key);
    expect(fingerprintKey(key).startsWith("sha256:")).toBe(true);
    expect(fingerprintKey(key)).toBe(fingerprintKey(`\n${key}`));
  });

  it("rejects the wrong decoded length", () => {
    const shortKey = encodeBase64(new Uint8Array(16).fill(4));
    expect(() => parseEncryptionKey(shortKey)).toThrow(MigrationError);
    expect(() => parseEncryptionKey(shortKey)).toThrow(/32 bytes/);
  });

  it("rejects identical old and new keys", () => {
    const key = keyFromByte(5);
    expect(() => assertKeysDistinct(key, key)).toThrow(MigrationError);
    expect(() => assertKeysDistinct(key, key)).toThrow(/different/);
  });
});

describe("secretbox roundtrip", () => {
  it("matches the existing nonce:ciphertext format and round-trips", () => {
    const key = keyFromByte(6);
    const ciphertext = encryptCalDavPassword("calendar-secret", key);
    expect(ciphertext.includes(":")).toBe(true);
    expect(decryptCalDavPassword(ciphertext, key)).toBe("calendar-secret");
  });

  it("fails closed on the wrong key without returning plaintext", () => {
    const ciphertext = encryptCalDavPassword("calendar-secret", keyFromByte(7));
    expect(() => decryptCalDavPassword(ciphertext, keyFromByte(8))).toThrow(
      MigrationError,
    );
    expect(() => decryptCalDavPassword(ciphertext, keyFromByte(8))).toThrow(
      /decryption failed/i,
    );
  });

  it("re-encrypts and verifies the new key before returning ciphertext", () => {
    const oldKey = keyFromByte(9);
    const newKey = keyFromByte(10);
    const original = encryptCalDavPassword("calendar-secret", oldKey);
    const rotated = reencryptCalDavPassword(original, oldKey, newKey);
    expect(decryptCalDavPassword(rotated, newKey)).toBe("calendar-secret");
    expect(() => decryptCalDavPassword(rotated, oldKey)).toThrow(MigrationError);
  });
});
