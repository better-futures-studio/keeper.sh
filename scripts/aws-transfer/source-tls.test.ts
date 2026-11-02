import { describe, expect, test } from 'bun:test';
import { verifiedSourceConnections, SOURCE_CA_FILE, SOURCE_TLS_NAME } from './source-tls';

const url = () => new URL('postgresql://postgres:synthetic%2Bpassword@turntable.proxy.rlwy.net:25437/railway?sslmode=require');
const ca = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----';

describe('authenticated Railway source routing', () => {
  test('both clients verify the internal certificate identity through the public proxy address', () => {
    const config = verifiedSourceConnections(url(), '66.33.22.229', ca);
    expect(new URL(config.client.connectionString).hostname).toBe('66.33.22.229');
    expect(new URL(config.client.connectionString).searchParams.has('sslmode')).toBe(false);
    expect(config.client.ssl).toEqual({ ca, servername: SOURCE_TLS_NAME, rejectUnauthorized: true });
    expect(config.dumpEnvironment.PGHOST).toBe(SOURCE_TLS_NAME);
    expect(config.dumpEnvironment.PGHOSTADDR).toBe('66.33.22.229');
    expect(config.dumpEnvironment.PGSSLMODE).toBe('verify-full');
    expect(config.dumpEnvironment.PGSSLROOTCERT).toBe(SOURCE_CA_FILE);
    expect(config.dumpEnvironment.PGPASSWORD).toBe('synthetic+password');
  });
  test('rejects unexpected routing, database and TLS parameters', () => {
    for (const raw of [
      'postgres://postgres@other.example:25437/railway',
      'postgres://postgres@turntable.proxy.rlwy.net:5432/railway',
      'postgres://postgres@turntable.proxy.rlwy.net:25437/other',
      'postgres://postgres@turntable.proxy.rlwy.net:25437/railway?sslrootcert=other',
    ]) {
      expect(() => verifiedSourceConnections(new URL(raw), '66.33.22.229', ca)).toThrow();
    }
    expect(() => verifiedSourceConnections(url(), 'not-an-address', ca)).toThrow();
    expect(() => verifiedSourceConnections(url(), '::1', ca)).toThrow();
    expect(() => verifiedSourceConnections(url(), '66.33.22.229', '')).toThrow();
  });
});
