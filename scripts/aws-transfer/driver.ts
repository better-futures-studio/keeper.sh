import { Client } from 'pg';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { check, targetUrl, metadataGuard, mountGuard, compareCounts } from './guards';
import {command, aws, counts} from './core';
import {verifyForeignKeys, verifyRdsAdmin, ensureAppDatabase, assertFreshTarget, grantRuntimeRole, verifyRuntimeRole} from './integrity';
import { SOURCE_CA_FILE, verifiedSourceConnections } from './source-tls';

let phase = 'preflight';
const required = (key: string) => { const value = process.env[key]; check(value); return value; };
const deleted = new Set(['session','verification','jwks','oauth_access_token','oauth_refresh_token','api_tokens','calendar_push_channels']);
const main = async () => {
  process.umask(0o077);
  check(process.getuid?.() === 65_532);
  mountGuard(await readFile('/proc/mounts','utf8'));
  const uri = required('ECS_CONTAINER_METADATA_URI_V4');
  check(/^http:\/\/169\.254\.170\.2\/v4\/[a-zA-Z0-9-]+$/.test(uri));
  const metadataResponse = await fetch(`${uri}/task`);
  metadataGuard(await metadataResponse.json());
  const identity = await aws(['sts','get-caller-identity']); check(identity.Account === '491565008757');
  const app = targetUrl(required('TARGET_DATABASE_URL'), required('TARGET_APP_PASSWORD'), required('TARGET_DB_HOST'));
  check(required('TARGET_DB_PORT') === '5432' && required('TARGET_DB_NAME') === 'keeper');
  check(required('TARGET_ADMIN_USER') === 'bocapro_data_admin');
  const admin = new URL(app); admin.username = required('TARGET_ADMIN_USER'); admin.password = required('TARGET_ADMIN_PASSWORD');
  const source = new URL(required('SOURCE_DATABASE_URL'));
  check(['postgres:', 'postgresql:'].includes(source.protocol) && source.hostname === 'turntable.proxy.rlwy.net' && source.port === '25437');
  check([...source.searchParams.keys()].every(key => ['sslmode','application_name'].includes(key)));
  const sourceAddress = await lookup(source.hostname, { family: 4 });
  const verifiedSource = verifiedSourceConnections(source, sourceAddress.address, await readFile(SOURCE_CA_FILE, 'utf8'));
  const bucket = required('MIGRATION_BUCKET');
  // Private access and default encryption are enforced by reviewed AWS infrastructure.
  check(bucket === 'bocapro-shared-host-keeper-backup-491565008757');
  const work = await mkdtemp('/tmp/keeper-transfer-'); await chmod(work,0o700);
  const catalogUrl = new URL(admin); catalogUrl.pathname = '/postgres';
  check(catalogUrl.hostname === app.hostname && catalogUrl.port === '5432' && catalogUrl.pathname === '/postgres');
  check(catalogUrl.searchParams.get('sslmode') === 'verify-full' && catalogUrl.searchParams.get('sslrootcert') === '/app/certs/aws-rds-us-east-2.pem');
  const catalog = new Client({connectionString:catalogUrl.toString()});
  const dst = new Client({connectionString:admin.toString()});
  const src = new Client(verifiedSource.client);
  try {
    await catalog.connect();
    await verifyRdsAdmin(catalog,'postgres','bocapro_data_admin');
    await ensureAppDatabase(catalog,'keeper');
    await dst.connect();
    await verifyRdsAdmin(dst,'keeper','bocapro_data_admin');
    await assertFreshTarget(dst,'keeper_app');
    phase = 'source snapshot';
    await src.connect(); await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await src.query('SELECT pg_export_snapshot() id');
    const snapshot: string = snapshotResult.rows[0].id;
    const before = await counts(src);
    for (const key of ['user','calendar_accounts','calendars','caldav_credentials','event_states']) {check(key in before);}
    const archive = `${work}/source.dump`;
    phase = 'dump';
    await command(['pg_dump','--format=custom','--schema=public','--no-owner','--no-acl',`--snapshot=${snapshot}`,`--file=${archive}`], verifiedSource.dumpEnvironment);
    await chmod(archive,0o600); await src.query('COMMIT'); await src.end();
    const bytes = await readFile(archive); const sha256 = createHash('sha256').update(bytes).digest('hex');
    const prefix = `migration/${new Date().toISOString().replaceAll(':','-')}`;
    phase = 'archive';
    await aws(['s3api','put-object','--bucket',bucket,'--key',`${prefix}/source.dump`,'--body',archive,'--server-side-encryption','AES256','--checksum-algorithm','SHA256','--checksum-sha256',Buffer.from(sha256,'hex').toString('base64')]);
    const head = await aws(['s3api','head-object','--bucket',bucket,'--key',`${prefix}/source.dump`,'--checksum-mode','ENABLED']);
    check(head.ContentLength === bytes.length && head.ServerSideEncryption && head.ChecksumSHA256 === Buffer.from(sha256,'hex').toString('base64'));
    phase = 'schema';
    await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:admin.toString()});
    phase = 'restore';
    await command(['pg_restore','--data-only','--schema=public','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=keeper',archive],{PGHOST:app.hostname,PGPORT:app.port,PGUSER:required('TARGET_ADMIN_USER'),PGPASSWORD:required('TARGET_ADMIN_PASSWORD'),PGSSLMODE:'verify-full',PGSSLROOTCERT:'/app/certs/aws-rds-us-east-2.pem',PGOPTIONS:'-c session_replication_role=replica'});
    const checkedForeignKeys = await verifyForeignKeys(dst);
    const restored = await counts(dst); compareCounts(before,restored);
    phase = 'rotation';
    for (const [name,key] of [['old','OLD_ENCRYPTION_KEY'],['new','NEW_ENCRYPTION_KEY']] as const) {await writeFile(`${work}/${name}`,required(key),{mode:0o600});}
    const rotation = await command(['bun','/app/scripts/aws-migration/src/cli.ts','rotate-target','--old-key-file',`${work}/old`,'--new-key-file',`${work}/new`],{DATABASE_URL:admin.toString()});
    await verifyForeignKeys(dst);
    const after = await counts(dst);
    compareCounts(Object.fromEntries(Object.entries(before).filter(([key]) => !deleted.has(key))),after);
    for (const key of deleted) {if (key in after) {check(after[key] === '0');}}
    phase = 'runtime role';
    await dst.query('BEGIN');
    const passwordResult = await dst.query('SELECT quote_literal($1) p',[required('TARGET_APP_PASSWORD')]);
    const passwordLiteral: string = passwordResult.rows[0].p;
    // Receipts are operational records and must not be writable by the runtime.
    await grantRuntimeRole(dst,'keeper_app','keeper',passwordLiteral,Object.keys(after).filter(key => !(key in before)));
    await dst.query('COMMIT');
    await verifyRuntimeRole(dst,'keeper_app','keeper');
    const runtime = new Client({connectionString:app.toString()});
    try {
      await runtime.connect();
      const permissions = await runtime.query("SELECT current_user usr, has_schema_privilege(current_user,'public','CREATE') can_create, current_setting('session_replication_role') replication_mode");
      check(permissions.rows[0].usr === 'keeper_app' && !permissions.rows[0].can_create && permissions.rows[0].replication_mode === 'origin');
    } finally { await runtime.end(); }
    phase = 'receipt';
    await writeFile(`${work}/receipt.json`,JSON.stringify({version:1,completedAt:new Date().toISOString(),sourceArchive:{key:`${prefix}/source.dump`,sha256,bytes:bytes.length,versionId:head.VersionId},before,restored,after,rotation,checkedForeignKeys},null,2),{mode:0o600});
    const receiptBytes = await readFile(`${work}/receipt.json`);
    const receiptChecksum = createHash('sha256').update(receiptBytes).digest('base64');
    await aws(['s3api','put-object','--bucket',bucket,'--key',`${prefix}/receipt.json`,'--body',`${work}/receipt.json`,'--server-side-encryption','AES256','--checksum-algorithm','SHA256','--checksum-sha256',receiptChecksum]);
    const receiptHead = await aws(['s3api','head-object','--bucket',bucket,'--key',`${prefix}/receipt.json`,'--checksum-mode','ENABLED']);
    check(receiptHead.ContentLength === receiptBytes.length);
    check(receiptHead.ChecksumSHA256 === receiptChecksum);
    check(receiptHead.ServerSideEncryption === 'AES256');
    process.stdout.write(`${JSON.stringify({status:'complete',receipt:`s3://${bucket}/${prefix}/receipt.json`,sha256})}\n`);
  } finally { await Promise.allSettled([src.end(),dst.end(),catalog.end()]); await rm(work,{recursive:true,force:true}); }
};
main().catch(() => { process.stderr.write(`Keeper AWS transfer failed during ${phase}; details suppressed. Target may contain partial work; do not rerun without review.\n`); process.exitCode=1; });
