import { readFileSync } from "node:fs";

/*
 * Bun 1.3.11 does not read libpq's sslrootcert URL key. Current docs that map
 * it to tls.caFile landed in 1.4.4; on 1.3.11 the key is forwarded as a
 * PostgreSQL startup parameter and the server refuses the session. sslmode is
 * already parsed. When a root cert is present, load it here and pass the
 * 1.3.11 SQL tls object so verify-full still checks the certificate and the
 * hostname.
 */
const SSLROOTCERT_PARAM = "sslrootcert";
const SSLMODE_PARAM = "sslmode";
const VERIFY_FULL = "verify-full";
const PEM_BEGIN = "-----BEGIN CERTIFICATE-----";

const BUN_SQL_TLS_ROOT_CERT_ERROR =
  "Database TLS root certificate is missing or unreadable";
const BUN_SQL_TLS_HOSTNAME_ERROR = "Database TLS hostname is missing";

interface BunSqlTls {
  ca: string;
  rejectUnauthorized: true;
  servername: string;
}

interface NormalizedBunSqlConnection {
  tls?: BunSqlTls;
  url: string;
}

const isPostgresUrl = (protocol: string): boolean =>
  protocol === "postgres:" || protocol === "postgresql:";

const readRootCertificate = (path: string): string => {
  let pem = "";
  try {
    pem = readFileSync(path, "utf8");
  } catch {
    throw new Error(BUN_SQL_TLS_ROOT_CERT_ERROR);
  }
  if (!pem.includes(PEM_BEGIN)) {
    throw new Error(BUN_SQL_TLS_ROOT_CERT_ERROR);
  }
  return pem;
};

const normalizeBunSqlConnection = (url: string): NormalizedBunSqlConnection => {
  const parsed = new URL(url);
  if (!isPostgresUrl(parsed.protocol)) {
    return { url };
  }
  const rootCertPath = parsed.searchParams.get(SSLROOTCERT_PARAM);
  if (rootCertPath === null) {
    return { url };
  }
  if (rootCertPath.length === 0) {
    throw new Error(BUN_SQL_TLS_ROOT_CERT_ERROR);
  }
  const ca = readRootCertificate(rootCertPath);
  const { hostname } = parsed;
  if (hostname.length === 0) {
    throw new Error(BUN_SQL_TLS_HOSTNAME_ERROR);
  }
  parsed.searchParams.delete(SSLROOTCERT_PARAM);
  parsed.searchParams.set(SSLMODE_PARAM, VERIFY_FULL);
  return {
    tls: {
      ca,
      rejectUnauthorized: true,
      servername: hostname,
    },
    url: parsed.toString(),
  };
};

export {
  BUN_SQL_TLS_HOSTNAME_ERROR,
  BUN_SQL_TLS_ROOT_CERT_ERROR,
  normalizeBunSqlConnection,
};
export type { BunSqlTls, NormalizedBunSqlConnection };
