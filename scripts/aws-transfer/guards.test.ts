import { describe, expect, test } from 'bun:test';
import { targetUrl, metadataGuard, mountGuard, compareCounts, quote } from './guards';
describe('transfer boundaries', () => {
  const host = 'shared-data-postgres.fixture.us-east-2.rds.amazonaws.com';
  const url = `postgresql://keeper_app:fixture@${host}:5432/keeper?sslmode=verify-full&sslrootcert=/app/certs/aws-rds-us-east-2.pem`;
  test('exact private target and injected credential', () => {
    expect(targetUrl(url,'fixture',host).searchParams.get('application_name')).toBe('keeper-aws-staging');
    for (const bad of [url.replace(host,'127.0.0.1'),url.replace('/keeper','/postgres'),url.replace('keeper_app','keeper_admin'),`${url}&options=-csearch_path=evil`]) {expect(() => targetUrl(bad,'fixture',host)).toThrow();}
    expect(() => targetUrl(url,'different',host)).toThrow();
    expect(() => targetUrl(url,'fixture','evil.us-east-2.rds.amazonaws.com')).toThrow();
    expect(() => targetUrl(url.replace('verify-full','require'),'fixture',host)).toThrow();
    expect(() => targetUrl(url.replace('aws-rds-us-east-2.pem','evil.pem'),'fixture',host)).toThrow();
  });
  test('AWS account and cluster cannot be substituted', () => {
    metadataGuard({TaskARN:'arn:aws:ecs:us-east-2:491565008757:task/shared-host/abc',Cluster:'shared-host'});
    expect(() => metadataGuard({TaskARN:'arn:aws:ecs:us-east-2:111111111111:task/shared-host/abc',Cluster:'shared-host'})).toThrow();
    expect(() => metadataGuard({TaskARN:'arn:aws:ecs:us-east-2:491565008757:task/shared-host/abc',Cluster:'production'})).toThrow();
  });
  test('disk or executable temp directories fail closed', () => {
    const mounts = 'overlay / overlay ro,relatime 0 0\ntmpfs /tmp tmpfs rw,nosuid,nodev,noexec,size=524288k 0 0';
    mountGuard(mounts);
    for (const bad of [mounts.replace('overlay ro','overlay rw'),mounts.replace(',noexec',''),mounts.replace('size=524288k','size=1g'),mounts.replace('/tmp tmpfs','/tmp ext4')]) {expect(() => mountGuard(bad)).toThrow();}
  });
  test('missing tables and lost rows fail comparison', () => {
    compareCounts({user:'12'},{user:'12',receipt:'1'});
    expect(() => compareCounts({user:'12'},{user:'11'})).toThrow();
    expect(() => compareCounts({user:'12'},{})).toThrow();
    expect(quote('a";drop table x;')).toBe('"a"";drop table x;"');
  });
});
