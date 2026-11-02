import type { Client } from 'pg';
import { check, quote } from './guards';
interface ForeignKey {
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  source_columns: string[];
  target_columns: string[];
  match_type: string;
}
const sqlName = (name: string) => {
  check(/^[a-z][a-z0-9_]*$/.test(name));
  return quote(name);
};
// Only trusted, validated target constraints are checked. Historical NOT VALID
// Constraints retain the reviewed migration's deliberate compatibility state.
const verifyForeignKeys = async (client: Client) => {
  const mode = await client.query("SELECT current_setting('session_replication_role') mode");
  check(mode.rows[0].mode === 'origin');
  const keys = await client.query<ForeignKey>(`
    SELECT ns.nspname source_schema, src.relname source_table,
           nt.nspname target_schema, dst.relname target_table,
           fk.confmatchtype match_type,
           array_agg(sa.attname::text ORDER BY cols.ordinality) source_columns,
           array_agg(ta.attname::text ORDER BY cols.ordinality) target_columns
    FROM pg_constraint fk
    JOIN pg_class src ON src.oid=fk.conrelid
    JOIN pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_class dst ON dst.oid=fk.confrelid
    JOIN pg_namespace nt ON nt.oid=dst.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) WITH ORDINALITY cols(source_att,target_att,ordinality)
    JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=cols.source_att
    JOIN pg_attribute ta ON ta.attrelid=dst.oid AND ta.attnum=cols.target_att
    WHERE fk.contype='f' AND fk.convalidated AND ns.nspname='public'
    GROUP BY fk.oid,ns.nspname,src.relname,nt.nspname,dst.relname,fk.confmatchtype
  `);
  for (const key of keys.rows) {
    check(['s','f'].includes(key.match_type));
    const nonNull = key.source_columns.map(column => `child.${quote(column)} IS NOT NULL`);
    const equality = key.source_columns.map((column,index) => {
      const targetColumn = key.target_columns[index]; check(targetColumn);
      return `parent.${quote(targetColumn)} = child.${quote(column)}`;
    });
    let violation = `(${nonNull.join(' AND ')}) AND NOT EXISTS (SELECT 1 FROM ${quote(key.target_schema)}.${quote(key.target_table)} parent WHERE ${equality.join(' AND ')})`;
    if (key.match_type === 'f') {
      violation = `(${violation}) OR ((${nonNull.join(' OR ')}) AND NOT (${nonNull.join(' AND ')}))`;
    }
    const result = await client.query<{violated:boolean}>(`SELECT EXISTS (SELECT 1 FROM ${quote(key.source_schema)}.${quote(key.source_table)} child WHERE ${violation}) violated`);
    const [row] = result.rows; check(row); check(!row.violated);
  }
  return keys.rows.length;
};
const verifyRdsAdmin = async (client: Client, database: string, username: string) => {
  const result = await client.query(`SELECT current_database() db,current_user usr,inet_server_port() port,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) is_super,
    (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) createdb,
    (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) createrole,
    pg_has_role(current_user,'rds_superuser','MEMBER') rds_member,
    has_parameter_privilege(current_user,'session_replication_role','SET') can_set,
    current_setting('session_replication_role') replication_mode`);
  const [info] = result.rows;
  check(info.db === database && info.usr === username && info.port === 5432);
  check(!info.is_super && info.createdb && info.createrole && info.rds_member && info.can_set);
  check(info.replication_mode === 'origin');
};
const ensureAppDatabase = async (client: Client, name: string) => {
  const ident = sqlName(name);
  check(!['postgres','template0','template1'].includes(name));
  const catalog = await client.query('SELECT current_database() db');
  check(catalog.rows[0].db === 'postgres');
  const existing = await client.query('SELECT datname FROM pg_database WHERE datname=$1',[name]);
  if (existing.rows.length === 0) {
    await client.query(`CREATE DATABASE ${ident}`);
  }
};
const assertFreshTarget = async (client: Client, runtimeRole: string) => {
  sqlName(runtimeRole);
  const tableResult = await client.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
  check(tableResult.rows[0].n === 0);
  const roleResult = await client.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[runtimeRole]);
  check(roleResult.rows[0].n === 0);
};
const grantRuntimeRole = async (client: Client, runtimeRole: string, database: string, passwordLiteral: string, receipts: string[]) => {
  const roleIdent = sqlName(runtimeRole);
  const databaseIdent = sqlName(database);
  check(/^E?'[\s\S]*'$/.test(passwordLiteral));
  await client.query(`CREATE ROLE ${roleIdent} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${passwordLiteral}`);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON DATABASE ${databaseIdent} FROM PUBLIC; GRANT CONNECT ON DATABASE ${databaseIdent} TO ${roleIdent}; GRANT USAGE ON SCHEMA public TO ${roleIdent}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleIdent}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent}`);
  for (const receipt of receipts) {
    await client.query(`REVOKE ALL ON TABLE public.${sqlName(receipt)} FROM ${roleIdent}`);
  }
};
const verifyRuntimeRole = async (client: Client, runtimeRole: string, database: string) => {
  sqlName(runtimeRole); sqlName(database);
  const result = await client.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    pg_has_role($1,'rds_superuser','MEMBER') rds_super,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rds_iam') AND pg_has_role($1,'rds_iam','MEMBER') rds_iam,
    has_schema_privilege($1,'public','CREATE') can_create,
    has_database_privilege($1,$2,'CREATE') db_create
    FROM pg_roles r WHERE r.rolname=$1`,[runtimeRole,database]);
  const [info] = result.rows;
  check(info);
  check(!info.rolsuper && !info.rolcreatedb && !info.rolcreaterole && !info.rolreplication && !info.rolbypassrls);
  check(!info.rds_super && !info.rds_iam && !info.can_create && !info.db_create);
};
export {verifyForeignKeys, verifyRdsAdmin, ensureAppDatabase, assertFreshTarget, grantRuntimeRole, verifyRuntimeRole};
