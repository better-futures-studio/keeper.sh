import { createHash, timingSafeEqual } from "node:crypto";
import { secretbox } from "tweetnacl";
import { decodeBase64 } from "tweetnacl-util";
import {
  decryptPassword,
  encryptPassword,
} from "../../../packages/database/src/encryption";
import { MigrationError } from "./errors";

const KEY_BYTE_LENGTH = secretbox.keyLength;
const FINGERPRINT_PREFIX = "sha256:";

const decodeKeyBytes = (value: string): Uint8Array => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MigrationError("KEY_EMPTY", "Encryption key file is empty");
  }
  try {
    return decodeBase64(trimmed);
  } catch {
    throw new MigrationError(
      "KEY_ENCODING",
      "Encryption key is not valid base64",
    );
  }
};

const parseEncryptionKey = (value: string): string => {
  const trimmed = value.trim();
  const decoded = decodeKeyBytes(trimmed);
  if (decoded.length !== KEY_BYTE_LENGTH) {
    throw new MigrationError(
      "KEY_LENGTH",
      `Encryption key must be ${KEY_BYTE_LENGTH} bytes after base64 decode`,
    );
  }
  return trimmed;
};

const fingerprintKey = (value: string): string => {
  const decoded = decodeKeyBytes(value);
  const digest = createHash("sha256").update(decoded).digest("hex");
  return `${FINGERPRINT_PREFIX}${digest}`;
};

const keysAreIdentical = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(decodeKeyBytes(left));
  const rightBytes = Buffer.from(decodeKeyBytes(right));
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
};

const assertKeysDistinct = (oldKey: string, newKey: string): void => {
  if (keysAreIdentical(oldKey, newKey)) {
    throw new MigrationError(
      "IDENTICAL_KEYS",
      "Old and new encryption keys must be different",
    );
  }
};

const encryptCalDavPassword = (plaintext: string, key: string): string => {
  try {
    return encryptPassword(plaintext, key);
  } catch {
    throw new MigrationError(
      "ENCRYPT_FAILED",
      "CalDAV credential encryption failed",
    );
  }
};

const decryptCalDavPassword = (ciphertext: string, key: string): string => {
  try {
    return decryptPassword(ciphertext, key);
  } catch {
    throw new MigrationError(
      "DECRYPT_FAILED",
      "CalDAV credential decryption failed",
    );
  }
};

const reencryptCalDavPassword = (
  ciphertext: string,
  oldKey: string,
  newKey: string,
): string => {
  const plaintext = decryptCalDavPassword(ciphertext, oldKey);
  const rotated = encryptCalDavPassword(plaintext, newKey);
  const verified = decryptCalDavPassword(rotated, newKey);
  if (verified !== plaintext) {
    throw new MigrationError(
      "VERIFY_FAILED",
      "New encryption key did not round-trip the CalDAV credential",
    );
  }
  return rotated;
};

export {
  KEY_BYTE_LENGTH,
  assertKeysDistinct,
  decryptCalDavPassword,
  encryptCalDavPassword,
  fingerprintKey,
  parseEncryptionKey,
  reencryptCalDavPassword,
};
