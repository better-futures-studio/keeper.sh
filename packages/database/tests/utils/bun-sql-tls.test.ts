import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/utils/database";
import {
  BUN_SQL_TLS_HOSTNAME_ERROR,
  BUN_SQL_TLS_ROOT_CERT_ERROR,
  normalizeBunSqlConnection,
} from "../../src/utils/bun-sql-tls";

const SECRET_PASSWORD = "super-secret-fixture-password";
const SYNTHETIC_PEM = `-----BEGIN CERTIFICATE-----
MIIBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END CERTIFICATE-----
`;
const TLS_CA_FILE = process.env.KEEPER_TLS_CA_FILE;
const TLS_WRONG_CA_FILE = process.env.KEEPER_TLS_WRONG_CA_FILE;

const errorText = (error: unknown): string => {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const record = current as Error & { code?: unknown; errno?: unknown };
      parts.push(current.name, current.message, current.stack ?? "");
      if (typeof record.code === "string") {
        parts.push(record.code);
      }
      if (typeof record.errno === "number" || typeof record.errno === "string") {
        parts.push(String(record.errno));
      }
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join("\n");
};

const expectNoCredentials = (error: unknown): void => {
  const text = errorText(error);
  expect(text).not.toContain(SECRET_PASSWORD);
  expect(text).not.toMatch(/28P01|password authentication/i);
  expect(text).toContain(BUN_SQL_TLS_ROOT_CERT_ERROR);
};

const writeTempCertificate = (contents: string): { directory: string; path: string } => {
  const directory = mkdtempSync(join(tmpdir(), "keeper-bun-sql-tls-"));
  const path = join(directory, "ca.pem");
  writeFileSync(path, contents);
  return { directory, path };
};

describe("normalizeBunSqlConnection", () => {
  it("leaves a Railway URL without sslrootcert unchanged", () => {
    const url = "postgres://keeper:railway-secret@turntable.proxy.rlwy.net:25437/railway";
    expect(normalizeBunSqlConnection(url)).toEqual({ url });
  });

  it("leaves sslmode=require Railway URLs unchanged and does not attach tls", () => {
    const url =
      "postgres://keeper:railway-secret@turntable.proxy.rlwy.net:25437/railway?sslmode=require";
    expect(normalizeBunSqlConnection(url)).toEqual({ url });
  });

  it("fails closed when sslrootcert is missing, without credential errors", () => {
    const url =
      `postgres://keeper_app:${SECRET_PASSWORD}@managed:5432/keeper` +
      "?sslmode=verify-full&sslrootcert=/no/such/keeper-ca.pem";
    expect(() => normalizeBunSqlConnection(url)).toThrow(BUN_SQL_TLS_ROOT_CERT_ERROR);
    try {
      normalizeBunSqlConnection(url);
    } catch (error) {
      expectNoCredentials(error);
      return;
    }
    throw new Error("expected missing CA to fail closed");
  });

  it("fails closed when sslrootcert is empty", () => {
    const url =
      `postgres://keeper_app:${SECRET_PASSWORD}@managed:5432/keeper` +
      "?sslmode=verify-full&sslrootcert=";
    expect(() => normalizeBunSqlConnection(url)).toThrow(BUN_SQL_TLS_ROOT_CERT_ERROR);
    try {
      normalizeBunSqlConnection(url);
    } catch (error) {
      expectNoCredentials(error);
    }
  });

  it("fails closed when the CA file is not a certificate", () => {
    const { directory, path } = writeTempCertificate("not-a-certificate");
    try {
      const url =
        `postgres://keeper_app:${SECRET_PASSWORD}@managed:5432/keeper` +
        `?sslmode=verify-full&sslrootcert=${path}`;
      expect(() => normalizeBunSqlConnection(url)).toThrow(BUN_SQL_TLS_ROOT_CERT_ERROR);
      try {
        normalizeBunSqlConnection(url);
      } catch (error) {
        expectNoCredentials(error);
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails closed when the URL has a root cert but no hostname", () => {
    const { directory, path } = writeTempCertificate(SYNTHETIC_PEM);
    try {
      expect(() =>
        normalizeBunSqlConnection(`postgres:///keeper?sslrootcert=${path}`),
      ).toThrow(BUN_SQL_TLS_HOSTNAME_ERROR);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("strips sslrootcert, keeps verify-full, and passes CA PEM plus hostname", () => {
    const { directory, path } = writeTempCertificate(SYNTHETIC_PEM);
    try {
      const url =
        `postgres://keeper_app:${SECRET_PASSWORD}@managed:5432/keeper` +
        `?sslmode=verify-full&sslrootcert=${path}&application_name=keeper`;
      const normalized = normalizeBunSqlConnection(url);
      const parsed = new URL(normalized.url);
      expect(parsed.searchParams.get("sslrootcert")).toBeNull();
      expect(parsed.searchParams.get("sslmode")).toBe("verify-full");
      expect(parsed.searchParams.get("application_name")).toBe("keeper");
      expect(parsed.hostname).toBe("managed");
      expect(decodeURIComponent(parsed.password)).toBe(SECRET_PASSWORD);
      expect(normalized.url).not.toContain("sslrootcert");
      expect(normalized.tls).toEqual({
        ca: SYNTHETIC_PEM,
        rejectUnauthorized: true,
        servername: "managed",
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("sets verify-full when sslrootcert is present without sslmode", () => {
    const { directory, path } = writeTempCertificate(SYNTHETIC_PEM);
    try {
      const url = `postgres://keeper_app:${SECRET_PASSWORD}@managed:5432/keeper?sslrootcert=${path}`;
      const normalized = normalizeBunSqlConnection(url);
      expect(new URL(normalized.url).searchParams.get("sslmode")).toBe("verify-full");
      expect(normalized.tls?.servername).toBe("managed");
      expect(normalized.tls?.rejectUnauthorized).toBe(true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("createDatabase TLS guards", () => {
  it("rejects a missing CA before connecting and does not mention credentials", async () => {
    const url =
      `postgres://keeper_app:${SECRET_PASSWORD}@127.0.0.1:1/keeper` +
      "?sslmode=verify-full&sslrootcert=/no/such/keeper-ca.pem";
    const startedAt = Date.now();
    try {
      await createDatabase(url, { maxConnections: 1 });
    } catch (error) {
      expectNoCredentials(error);
      expect(Date.now() - startedAt).toBeLessThan(500);
      return;
    }
    throw new Error("expected createDatabase to fail closed");
  });
});

const tlsUrl = (host: string, caFile: string): string =>
  `postgres://postgres@${host}:5432/postgres?sslmode=verify-full&sslrootcert=${caFile}`;

const hasEmptyHostnameMismatch = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { cause?: unknown; errno?: unknown; message?: unknown };
    if (record.message === "" && record.errno === 0) {
      return true;
    }
    current = record.cause;
  }
  return false;
};

const isTlsFailure = (error: unknown): boolean =>
  /unable to verify|self-signed|UNABLE_TO_VERIFY|unable to get local issuer|certificate|hostname|altnames|ERR_POSTGRES_TLS|SSL|tls/i
    .test(errorText(error))
  || hasEmptyHostnameMismatch(error);

describe.skipIf(!TLS_CA_FILE || !TLS_WRONG_CA_FILE)(
  "createDatabase against a local PostgreSQL 18 TLS fixture",
  () => {
    it("selects 1 with the trusted CA and localhost hostname", async () => {
      const database = await createDatabase(tlsUrl("localhost", TLS_CA_FILE as string), {
        maxConnections: 1,
      });
      try {
        await database.execute("SELECT 1");
      } finally {
        closeDatabase(database);
      }
    });

    it("rejects the wrong CA", async () => {
      try {
        await createDatabase(tlsUrl("localhost", TLS_WRONG_CA_FILE as string), {
          maxConnections: 1,
        });
      } catch (error) {
        expect(isTlsFailure(error)).toBe(true);
        expect(errorText(error)).not.toMatch(/28P01|password authentication/i);
        return;
      }
      throw new Error("expected the wrong CA to fail TLS verification");
    });

    it("rejects the wrong hostname", async () => {
      try {
        await createDatabase(tlsUrl("127.0.0.1", TLS_CA_FILE as string), {
          maxConnections: 1,
        });
      } catch (error) {
        expect(isTlsFailure(error)).toBe(true);
        expect(errorText(error)).not.toMatch(/28P01|password authentication/i);
        return;
      }
      throw new Error("expected the wrong hostname to fail TLS verification");
    });
  },
);
