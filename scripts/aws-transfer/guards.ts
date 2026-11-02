const check: (ok: unknown) => asserts ok = (ok) => {
  if (!ok) { throw new Error('Transfer guard rejected configuration or state'); }
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const targetUrl = (raw: string, password: string, expectedHost: string) => {
  const url = new URL(raw);
  check(['postgres:', 'postgresql:'].includes(url.protocol));
  check(/^shared-data-postgres\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/.test(expectedHost));
  check(url.hostname === expectedHost && url.port === '5432' && url.pathname === '/keeper');
  check(url.searchParams.get('sslmode') === 'verify-full');
  check(url.searchParams.get('sslrootcert') === '/app/certs/aws-rds-us-east-2.pem');
  check(decodeURIComponent(url.username) === 'keeper_app' && decodeURIComponent(url.password) === password);
  check([...url.searchParams.keys()].every(key => ['sslmode', 'sslrootcert', 'application_name'].includes(key)));
  url.searchParams.set('application_name', 'keeper-aws-staging');
  return url;
};
const metadataGuard = (value: unknown) => {
  check(typeof value === 'object' && value !== null);
  const meta = value as Record<string,unknown>;
  check(typeof meta.TaskARN === 'string');
  check(meta.TaskARN.startsWith('arn:aws:ecs:us-east-2:491565008757:task/'));
  check(meta.Cluster === 'shared-host' || meta.Cluster === 'arn:aws:ecs:us-east-2:491565008757:cluster/shared-host');
};
const mountGuard = (mounts: string) => {
  const lines = mounts.split('\n').map(line => line.split(' '));
  check(lines.some(line => line[1] === '/' && line[3]?.split(',').includes('ro')));
  check(lines.some(line => line[1] === '/tmp' && line[2] === 'tmpfs' && ['noexec', 'nosuid', 'nodev'].every(option => line[3]?.split(',').includes(option)) && line[3]?.split(',').some(option => /^size=(524288k|536870912)$/.test(option))));
};
const compareCounts = (before: Record<string,string>, after: Record<string,string>) => {
  check(Object.entries(before).every(([key,value]) => after[key] === value));
};
export {check, quote, targetUrl, metadataGuard, mountGuard, compareCounts};
