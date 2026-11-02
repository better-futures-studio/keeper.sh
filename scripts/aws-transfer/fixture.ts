// Local synthetic fixture only. Does not import or bypass the production driver.
import { Client } from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { command, counts } from './core';
import { check, compareCounts } from './guards';
import {verifyForeignKeys, verifyRdsAdmin, ensureAppDatabase, assertFreshTarget, grantRuntimeRole, verifyRuntimeRole} from './integrity';
const names = async (client: Client, sql: string) => {
  const result = await client.query<{name:string}>(sql);
  return result.rows.map(row => row.name);
};
const verifyRestrictedBackup = async (catalog: Client, target: Client, temp: string) => {
  await ensureAppDatabase(catalog,'fixture_backup_restore');
  const passwordResult = await target.query('SELECT quote_literal($1) p',['synthetic-fixture-only']);
  await grantRuntimeRole(target,'fixture_app','fixture_target',passwordResult.rows[0].p,['aws_migration_key_rotation_receipt']);
  await verifyRuntimeRole(target,'fixture_app','fixture_target');
  const backupEnv = {PATH:process.env.PATH ?? '',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'fixture_app',PGDATABASE:'fixture_target',PGPASSWORD:'synthetic-fixture-only'};
  const denied = Bun.spawn(['pg_dump','--format=custom','--no-owner','--no-acl',`--file=${temp}/denied.dump`],{env:backupEnv,stdout:'pipe',stderr:'pipe'});
  const [,deniedError] = await Promise.all([new Response(denied.stdout).text(),new Response(denied.stderr).text()]);
  check(await denied.exited !== 0);
  check(deniedError.includes('permission denied'));
  await command(['pg_dump','--format=custom','--schema=public','--exclude-table=public.aws_migration_key_rotation_receipt','--no-owner','--no-acl',`--file=${temp}/backup.dump`],backupEnv);
  await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:'postgresql://bocapro_data_admin@127.0.0.1:5432/fixture_backup_restore'});
  await command(['pg_restore','--data-only','--schema=public','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=fixture_backup_restore',`${temp}/backup.dump`],{PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'bocapro_data_admin',PGOPTIONS:'-c session_replication_role=replica'});
  const restored = new Client({connectionString:'postgresql://bocapro_data_admin@127.0.0.1:5432/fixture_backup_restore'});
  try {
    await restored.connect();
    await verifyRdsAdmin(restored,'fixture_backup_restore','bocapro_data_admin');
    await verifyForeignKeys(restored);
    const restoredCounts = await counts(restored);
    const targetCounts = await counts(target);
    const expected = Object.fromEntries(Object.entries(targetCounts).filter(([name]) => name !== 'aws_migration_key_rotation_receipt'));
    compareCounts(expected,restoredCounts);
    check(!('aws_migration_key_rotation_receipt' in restoredCounts));
    const history = await restored.query("SELECT to_regclass('drizzle.__drizzle_migrations') history");
    check(history.rows[0].history === 'drizzle.__drizzle_migrations');
  } finally { await restored.end(); }
};
const verifyRejectedForeignKey = async (target: Client) => {
  await target.query('BEGIN');
  try {
    await target.query('CREATE TABLE public.fixture_parent (id integer PRIMARY KEY); CREATE TABLE public.fixture_child (id integer REFERENCES public.fixture_parent(id)); SET LOCAL session_replication_role=replica; INSERT INTO public.fixture_child VALUES (123); SET LOCAL session_replication_role=origin');
    let rejected = false;
    try { await verifyForeignKeys(target); } catch { rejected = true; }
    check(rejected);
  } finally { await target.query('ROLLBACK'); }
  await verifyForeignKeys(target);
};
const verifyCatalogBootstrap = async (root: Client, catalog: Client) => {
  let superRejected = false;
  try { await verifyRdsAdmin(root,'postgres','postgres'); } catch { superRejected = true; }
  check(superRejected);
  await verifyRdsAdmin(catalog,'postgres','bocapro_data_admin');
  const rolesBefore = await names(catalog,"SELECT rolname AS name FROM pg_roles ORDER BY 1");
  const databasesBefore = await names(catalog,"SELECT datname AS name FROM pg_database WHERE datistemplate=false ORDER BY 1");
  await ensureAppDatabase(catalog,'fixture_target');
  const databasesAfter = await names(catalog,"SELECT datname AS name FROM pg_database WHERE datistemplate=false ORDER BY 1");
  check(JSON.stringify(databasesAfter) === JSON.stringify([...databasesBefore,'fixture_target'].toSorted()));
  check(JSON.stringify(await names(catalog,"SELECT rolname AS name FROM pg_roles ORDER BY 1")) === JSON.stringify(rolesBefore));
  await ensureAppDatabase(catalog,'fixture_existing_empty');
  await ensureAppDatabase(catalog,'fixture_existing_empty');
  const existingEmpty = new Client({connectionString:'postgresql://bocapro_data_admin@127.0.0.1:5432/fixture_existing_empty'});
  try {
    await existingEmpty.connect();
    await assertFreshTarget(existingEmpty,'keeper_app');
  } finally { await existingEmpty.end(); }
  await ensureAppDatabase(catalog,'fixture_dirty');
  const dirty = new Client({connectionString:'postgresql://bocapro_data_admin@127.0.0.1:5432/fixture_dirty'});
  try {
    await dirty.connect();
    await dirty.query('CREATE TABLE public.existing_data (id integer PRIMARY KEY); INSERT INTO public.existing_data VALUES (7)');
    await ensureAppDatabase(catalog,'fixture_dirty');
    const leftover = await dirty.query('SELECT id FROM public.existing_data');
    check(leftover.rows[0].id === 7);
    let dirtyRejected = false;
    try { await assertFreshTarget(dirty,'keeper_app'); } catch { dirtyRejected = true; }
    check(dirtyRejected);
  } finally { await dirty.end(); }
};
const fixture = async () => {
  const sourceUrl = 'postgresql://postgres@127.0.0.1:5432/fixture_source';
  const targetUrl = 'postgresql://bocapro_data_admin@127.0.0.1:5432/fixture_target?application_name=keeper-aws-staging';
  const root = new Client({connectionString:'postgresql://postgres@127.0.0.1:5432/postgres'});
  const catalog = new Client({connectionString:'postgresql://bocapro_data_admin@127.0.0.1:5432/postgres'});
  const unrelated = new Client({connectionString:'postgresql://postgres@127.0.0.1:5432/fixture_unrelated'});
  const source = new Client({connectionString:sourceUrl});
  const target = new Client({connectionString:targetUrl});
  const concurrent = new Client({connectionString:sourceUrl});
  const temp = await mkdtemp('/tmp/keeper-fixture-');
  try {
    await root.connect();
    await root.query('CREATE ROLE rds_superuser NOLOGIN; CREATE ROLE rds_iam NOLOGIN; CREATE ROLE bocapro_data_admin LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT; GRANT rds_superuser TO bocapro_data_admin; GRANT SET ON PARAMETER session_replication_role TO rds_superuser');
    await root.query('CREATE DATABASE fixture_source');
    await root.query('CREATE DATABASE fixture_unrelated');
    await unrelated.connect();
    await unrelated.query('CREATE TABLE public.keep_me (id integer PRIMARY KEY); INSERT INTO public.keep_me VALUES (1)');
    await catalog.connect();
    await verifyCatalogBootstrap(root,catalog);
    await target.connect();
    await verifyRdsAdmin(target,'fixture_target','bocapro_data_admin');
    await assertFreshTarget(target,'keeper_app');
    await target.query('BEGIN');
    try {
      await target.query('CREATE ROLE keeper_app NOLOGIN');
      let roleRejected = false;
      try { await assertFreshTarget(target,'keeper_app'); } catch { roleRejected = true; }
      check(roleRejected);
    } finally { await target.query('ROLLBACK'); }
    await assertFreshTarget(target,'keeper_app');
    const catalogTables = await catalog.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    check(catalogTables.rows[0].n === 0);
    await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:sourceUrl});
    await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:targetUrl});
    await source.connect(); await concurrent.connect();
    await source.query(`INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('fixture-one','Fixture','fixture-one@example.invalid',false,now(),now())`);
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await source.query('SELECT pg_export_snapshot() id');
    const snapshot: string = snapshotResult.rows[0].id;
    const before = await counts(source);
    await concurrent.query(`INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('fixture-two','Fixture','fixture-two@example.invalid',false,now(),now())`);
    await command(['pg_dump','--format=custom','--schema=public','--no-owner','--no-acl',`--snapshot=${snapshot}`,`--file=${temp}/source.dump`],{PGDATABASE:'fixture_source',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres'});
    await source.query('COMMIT');
    await command(['pg_restore','--data-only','--schema=public','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=fixture_target',`${temp}/source.dump`],{PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'bocapro_data_admin',PGOPTIONS:'-c session_replication_role=replica'});
    await verifyRdsAdmin(target,'fixture_target','bocapro_data_admin');
    await verifyForeignKeys(target);
    compareCounts(before,await counts(target));
    check(before.user === '1');
    for (const [name,value] of [['old',Buffer.alloc(32,1).toString('base64')],['new',Buffer.alloc(32,2).toString('base64')]] as const) { await writeFile(`${temp}/${name}`,value,{mode:0o600}); }
    const rotation = await command(['bun','/app/scripts/aws-migration/src/cli.ts','rotate-target','--old-key-file',`${temp}/old`,'--new-key-file',`${temp}/new`],{DATABASE_URL:targetUrl});
    check(rotation.includes('Keeper AWS target rotation completed'));
    await verifyForeignKeys(target);
    const finalTarget = await counts(target);
    check(finalTarget.user === '1');
    const finalSource = await counts(source);
    check(finalSource.user === '2');
    await target.query('BEGIN');
    const passwordResult = await target.query('SELECT quote_literal($1) p',['synthetic-runtime-only']);
    await grantRuntimeRole(target,'keeper_app','fixture_target',passwordResult.rows[0].p,Object.keys(finalTarget).filter(key => !(key in before)));
    await target.query('COMMIT');
    await verifyRuntimeRole(target,'keeper_app','fixture_target');
    const runtime = new Client({connectionString:'postgresql://keeper_app:synthetic-runtime-only@127.0.0.1:5432/fixture_target'});
    try {
      await runtime.connect();
      const permissions = await runtime.query("SELECT current_user usr, has_schema_privilege(current_user,'public','CREATE') can_create, current_setting('session_replication_role') replication_mode, has_table_privilege(current_user,'public.aws_migration_key_rotation_receipt','SELECT') can_read_receipt");
      check(permissions.rows[0].usr === 'keeper_app' && !permissions.rows[0].can_create && permissions.rows[0].replication_mode === 'origin' && !permissions.rows[0].can_read_receipt);
    } finally { await runtime.end(); }
    await verifyRestrictedBackup(catalog,target,temp);
    await verifyRejectedForeignKey(target);
    const canary = await unrelated.query('SELECT count(*)::int n FROM public.keep_me');
    check(canary.rows[0].n === 1);
    const catalogAfter = await catalog.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    check(catalogAfter.rows[0].n === 0);
    process.stdout.write('Fixture passed: empty-target bootstrap, rejected dirty target and existing role, reviewed migrations, snapshot, restore without disable-triggers, rotation, keeper_app boundaries, restricted backup and backup restore under non-super RDS admin; full dump and invalid foreign key rejected; unrelated database untouched.\n');
  } finally { await Promise.allSettled([source.end(),target.end(),concurrent.end(),root.end(),catalog.end(),unrelated.end()]); await rm(temp,{recursive:true,force:true}); }
};
fixture().catch((error:unknown) => { if(error instanceof Error){process.stderr.write(error.stack ?? error.message);} process.exitCode=1; });
