import { isIP } from 'node:net';
import { check } from './guards';

const SOURCE_TLS_NAME = 'postgres.railway.internal';
const SOURCE_CA_FILE = '/app/certs/railway-keeper-source-ca.pem';

/*
 * Route through Railway's public proxy while authenticating its database
 * certificate identity. pg overrides servername for DNS hosts, so use the
 * resolved address for routing and an explicit TLS name for verification.
 */
const verifiedSourceConnections = (source: URL, address: string, ca: string) => {
  check(['postgres:', 'postgresql:'].includes(source.protocol));
  check(source.hostname === 'turntable.proxy.rlwy.net' && source.port === '25437');
  check(source.pathname === '/railway' && isIP(address) === 4);
  check([...source.searchParams.keys()].every(key => ['sslmode', 'application_name'].includes(key)));
  check(ca.includes('-----BEGIN CERTIFICATE-----'));
  const clientUrl = new URL(source);
  clientUrl.hostname = address;
  clientUrl.searchParams.delete('sslmode');
  return {
    client: {
      connectionString: clientUrl.toString(),
      ssl: { ca, servername: SOURCE_TLS_NAME, rejectUnauthorized: true as const },
    },
    dumpEnvironment: {
      PGDATABASE: 'railway',
      PGHOST: SOURCE_TLS_NAME,
      PGHOSTADDR: address,
      PGPORT: source.port,
      PGUSER: decodeURIComponent(source.username),
      PGPASSWORD: decodeURIComponent(source.password),
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: SOURCE_CA_FILE,
    },
  };
};

export { SOURCE_CA_FILE, SOURCE_TLS_NAME, verifiedSourceConnections };
