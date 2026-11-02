import { Client } from 'pg';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { check, targetUrl, metadataGuard, mountGuard, compareCounts, quote } from './guards';
import {command, aws, counts} from './core';

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
  const app = targetUrl(required('TARGET_DATABASE_URL'), required('TARGET_APP_PASSWORD'));
  check((process.env.TARGET_DB_HOST ?? '172.31.15.170') === app.hostname);
  check((process.env.TARGET_DB_PORT ?? '15432') === app.port && (process.env.TARGET_DB_NAME ?? 'keeper') === 'keeper');
  const admin = new URL(app); admin.username = 'keeper_admin'; admin.password = required('TARGET_ADMIN_PASSWORD');
  const source = new URL(required('SOURCE_DATABASE_URL'));
  check(['postgres:', 'postgresql:'].includes(source.protocol) && source.hostname === 'turntable.proxy.rlwy.net' && source.port === '25437');
  check([...source.searchParams.keys()].every(key => ['sslmode','application_name'].includes(key)));
  source.searchParams.set('sslmode','require');
  const bucket = required('MIGRATION_BUCKET');
  // Private access and default encryption are enforced by reviewed AWS infrastructure.
  check(bucket === 'bocapro-shared-host-keeper-backup-491565008757');
  const work = await mkdtemp('/tmp/keeper-transfer-'); await chmod(work,0o700);
  const dst = new Client({connectionString:admin.toString()});
  const sourceClientUrl = new URL(source);
  sourceClientUrl.searchParams.delete('sslmode');
  const src = new Client({connectionString:sourceClientUrl.toString(),ssl:{rejectUnauthorized:false}});
  try {
    await dst.connect();
    const infoResult = await dst.query("SELECT current_database() db, current_user usr, inet_server_port() port, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super");
    const [info] = infoResult.rows;
    check(info.db === 'keeper' && info.usr === 'keeper_admin' && info.port === 5432 && info.super);
    const tableResult = await dst.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    check(tableResult.rows[0].n === 0);
    const roleResult = await dst.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='keeper_app'");
    check(roleResult.rows[0].n === 0);
    phase = 'source snapshot';
    await src.connect(); await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await src.query('SELECT pg_export_snapshot() id');
    const snapshot: string = snapshotResult.rows[0].id;
    const before = await counts(src);
    for (const key of ['user','calendar_accounts','calendars','caldav_credentials','event_states']) {check(key in before);}
    const archive = `${work}/source.dump`;
    phase = 'dump';
    await command(['pg_dump','--format=custom','--schema=public','--no-owner','--no-acl',`--snapshot=${snapshot}`,`--file=${archive}`], {PGDATABASE:decodeURIComponent(source.pathname.slice(1)), PGHOST:source.hostname, PGPORT:source.port, PGUSER:decodeURIComponent(source.username), PGPASSWORD:decodeURIComponent(source.password), PGSSLMODE:'require'});
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
    await command(['pg_restore','--data-only','--schema=public','--disable-triggers','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=keeper',archive],{PGHOST:app.hostname,PGPORT:app.port,PGUSER:'keeper_admin',PGPASSWORD:required('TARGET_ADMIN_PASSWORD')});
    const restored = await counts(dst); compareCounts(before,restored);
    phase = 'rotation';
    for (const [name,key] of [['old','OLD_ENCRYPTION_KEY'],['new','NEW_ENCRYPTION_KEY']] as const) {await writeFile(`${work}/${name}`,required(key),{mode:0o600});}
    const rotation = await command(['bun','/app/scripts/aws-migration/src/cli.ts','rotate-target','--old-key-file',`${work}/old`,'--new-key-file',`${work}/new`],{DATABASE_URL:admin.toString()});
    const after = await counts(dst);
    compareCounts(Object.fromEntries(Object.entries(before).filter(([key]) => !deleted.has(key))),after);
    for (const key of deleted) {if (key in after) {check(after[key] === '0');}}
    phase = 'runtime role';
    await dst.query('BEGIN');
    const passwordResult = await dst.query('SELECT quote_literal($1) p',[required('TARGET_APP_PASSWORD')]);
    const passwordLiteral: string = passwordResult.rows[0].p;
    await dst.query(`CREATE ROLE keeper_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${passwordLiteral}`);
    await dst.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON DATABASE keeper FROM PUBLIC; GRANT CONNECT ON DATABASE keeper TO keeper_app; GRANT USAGE ON SCHEMA public TO keeper_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO keeper_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO keeper_app');
    // Receipts are operational records and must not be writable by the runtime.
    for (const name of Object.keys(after).filter(key => !(key in before))) {await dst.query(`REVOKE ALL ON TABLE public.${quote(name)} FROM keeper_app`);}
    await dst.query('COMMIT');
    const runtime = new Client({connectionString:app.toString()});
    try {
      await runtime.connect();
      const permissions = await runtime.query("SELECT current_user usr, has_schema_privilege(current_user,'public','CREATE') can_create");
      check(permissions.rows[0].usr === 'keeper_app' && !permissions.rows[0].can_create);
    } finally { await runtime.end(); }
    phase = 'receipt';
    await writeFile(`${work}/receipt.json`,JSON.stringify({version:1,completedAt:new Date().toISOString(),sourceArchive:{key:`${prefix}/source.dump`,sha256,bytes:bytes.length,versionId:head.VersionId},before,restored,after,rotation},null,2),{mode:0o600});
    const receiptBytes = await readFile(`${work}/receipt.json`);
    const receiptChecksum = createHash('sha256').update(receiptBytes).digest('base64');
    await aws(['s3api','put-object','--bucket',bucket,'--key',`${prefix}/receipt.json`,'--body',`${work}/receipt.json`,'--server-side-encryption','AES256','--checksum-algorithm','SHA256','--checksum-sha256',receiptChecksum]);
    const receiptHead = await aws(['s3api','head-object','--bucket',bucket,'--key',`${prefix}/receipt.json`,'--checksum-mode','ENABLED']);
    check(receiptHead.ContentLength === receiptBytes.length);
    check(receiptHead.ChecksumSHA256 === receiptChecksum);
    check(receiptHead.ServerSideEncryption === 'AES256');
    process.stdout.write(`${JSON.stringify({status:'complete',receipt:`s3://${bucket}/${prefix}/receipt.json`,sha256})}\n`);
  } finally { await Promise.allSettled([src.end(),dst.end()]); await rm(work,{recursive:true,force:true}); }
};
main().catch(() => { process.stderr.write(`Keeper AWS transfer failed during ${phase}; details suppressed. Target may contain partial work; do not rerun without review.\n`); process.exitCode=1; });
