// Local synthetic fixture only. Does not import or bypass the production driver.
import { Client } from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { command, counts } from './core';
import { check, compareCounts } from './guards';
const verifyRestrictedBackup = async (root: Client, target: Client, temp: string) => {
  await root.query('CREATE DATABASE fixture_backup_restore');
  await target.query("CREATE ROLE fixture_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-fixture-only'");
  await target.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON DATABASE fixture_target FROM PUBLIC; GRANT CONNECT ON DATABASE fixture_target TO fixture_app; GRANT USAGE ON SCHEMA public TO fixture_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fixture_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_app; REVOKE ALL ON TABLE public.aws_migration_key_rotation_receipt FROM fixture_app');
  const backupEnv = {PATH:process.env.PATH ?? '',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'fixture_app',PGDATABASE:'fixture_target',PGPASSWORD:'synthetic-fixture-only'};
  const denied = Bun.spawn(['pg_dump','--format=custom','--no-owner','--no-acl',`--file=${temp}/denied.dump`],{env:backupEnv,stdout:'pipe',stderr:'pipe'});
  const [,deniedError] = await Promise.all([new Response(denied.stdout).text(),new Response(denied.stderr).text()]);
  check(await denied.exited !== 0);
  check(deniedError.includes('permission denied'));
  await command(['pg_dump','--format=custom','--schema=public','--exclude-table=public.aws_migration_key_rotation_receipt','--no-owner','--no-acl',`--file=${temp}/backup.dump`],backupEnv);
  await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:'postgresql://postgres@127.0.0.1:5432/fixture_backup_restore'});
  await command(['pg_restore','--data-only','--schema=public','--disable-triggers','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=fixture_backup_restore',`${temp}/backup.dump`],{PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres'});
  const restored = new Client({connectionString:'postgresql://postgres@127.0.0.1:5432/fixture_backup_restore'});
  try {
    await restored.connect();
    const restoredCounts = await counts(restored);
    const targetCounts = await counts(target);
    const expected = Object.fromEntries(Object.entries(targetCounts).filter(([name]) => name !== 'aws_migration_key_rotation_receipt'));
    compareCounts(expected,restoredCounts);
    check(!('aws_migration_key_rotation_receipt' in restoredCounts));
    const history = await restored.query("SELECT to_regclass('drizzle.__drizzle_migrations') history");
    check(history.rows[0].history === 'drizzle.__drizzle_migrations');
  } finally { await restored.end(); }
};
const fixture = async () => {
  const sourceUrl = 'postgresql://postgres@127.0.0.1:5432/fixture_source';
  const targetUrl = 'postgresql://postgres@127.0.0.1:5432/fixture_target?application_name=keeper-aws-staging';
  const root = new Client({connectionString:'postgresql://postgres@127.0.0.1:5432/postgres'});
  await root.connect();
  await root.query('CREATE DATABASE fixture_source');
  await root.query('CREATE DATABASE fixture_target');
  const source = new Client({connectionString:sourceUrl});
  const target = new Client({connectionString:targetUrl});
  const concurrent = new Client({connectionString:sourceUrl});
  const temp = await mkdtemp('/tmp/keeper-fixture-');
  try {
    await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:sourceUrl});
    await command(['bun','/app/packages/database/scripts/migrate.ts'],{DATABASE_URL:targetUrl});
    await source.connect(); await target.connect(); await concurrent.connect();
    await source.query(`INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('fixture-one','Fixture','fixture-one@example.invalid',false,now(),now())`);
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await source.query('SELECT pg_export_snapshot() id');
    const snapshot: string = snapshotResult.rows[0].id;
    const before = await counts(source);
    await concurrent.query(`INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('fixture-two','Fixture','fixture-two@example.invalid',false,now(),now())`);
    await command(['pg_dump','--format=custom','--schema=public','--no-owner','--no-acl',`--snapshot=${snapshot}`,`--file=${temp}/source.dump`],{PGDATABASE:'fixture_source',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres'});
    await source.query('COMMIT');
    await command(['pg_restore','--data-only','--schema=public','--disable-triggers','--no-owner','--no-acl','--single-transaction','--exit-on-error','--dbname=fixture_target',`${temp}/source.dump`],{PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres'});
    compareCounts(before,await counts(target));
    check(before.user === '1');
    for (const [name,value] of [['old',Buffer.alloc(32,1).toString('base64')],['new',Buffer.alloc(32,2).toString('base64')]] as const) { await writeFile(`${temp}/${name}`,value,{mode:0o600}); }
    const rotation = await command(['bun','/app/scripts/aws-migration/src/cli.ts','rotate-target','--old-key-file',`${temp}/old`,'--new-key-file',`${temp}/new`],{DATABASE_URL:targetUrl});
    check(rotation.includes('Keeper AWS target rotation completed'));
    const finalTarget = await counts(target);
    check(finalTarget.user === '1');
    const finalSource = await counts(source);
    check(finalSource.user === '2');
    await verifyRestrictedBackup(root,target,temp);
    process.stdout.write('Fixture passed: reviewed migrations, snapshot, restore, rotation, restricted backup and backup restore; full database dump rejected.\n');
  } finally { await Promise.allSettled([source.end(),target.end(),concurrent.end(),root.end()]); await rm(temp,{recursive:true,force:true}); }
};
fixture().catch(() => { process.stderr.write('Synthetic fixture failed; no production connections used.\n'); process.exitCode=1; });
