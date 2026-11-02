// Synthetic PostgreSQL18 TLS fixture only. The production driver has no bypass.
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { verifiedSourceConnections } from './source-tls';
import { check } from './guards';

const ca = await readFile('/fixture/ca.pem', 'utf8');
const wrongCa = await readFile('/fixture/wrong-ca.pem', 'utf8');
const source = new URL('postgresql://postgres:synthetic@turntable.proxy.rlwy.net:25437/railway');
const config = verifiedSourceConnections(source, '127.0.0.1', ca);
const query = async (ssl: typeof config.client.ssl) => {
  const client = new Client({ ...config.client, ssl });
  try { await client.connect(); await client.query('SELECT 1'); }
  finally { await client.end(); }
};
await query(config.client.ssl);
for (const ssl of [{ ...config.client.ssl, ca: wrongCa }, { ...config.client.ssl, servername: 'wrong.example' }]) {
  let rejected = false;
  try { await query(ssl); } catch { rejected = true; }
  check(rejected);
}
const dump = async (host: string, root: string) => {
  const child = Bun.spawn(['pg_dump', '--schema-only', '--no-owner', '--no-acl', '--file=/tmp/source-tls-fixture.dump'], {
    env: { PATH: process.env.PATH, ...config.dumpEnvironment, PGHOST: host, PGSSLROOTCERT: root },
    stdout: 'pipe', stderr: 'pipe',
  });
  await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return child.exited;
};
check(await dump(config.dumpEnvironment.PGHOST, '/fixture/ca.pem') === 0);
check(await dump('wrong.example', '/fixture/ca.pem') !== 0);
check(await dump(config.dumpEnvironment.PGHOST, '/fixture/wrong-ca.pem') !== 0);
process.stdout.write('Source TLS fixture passed: node-postgres and pg_dump authenticate the expected name and reject wrong CA/name.\n');
