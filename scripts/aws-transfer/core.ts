import type { Client } from 'pg';
import {check, quote} from './guards';
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(AWS_|PATH$|HOME$)/.test(key))) as Record<string,string>;
const command = async (args: string[], env: Record<string,string> = {}) => {
  const child = Bun.spawn(args, { env: {...baseEnv,...env}, stdout: 'pipe', stderr: 'pipe' });
  const [stdout] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  check(await child.exited === 0); return stdout;
};
const aws = async (args: string[]): Promise<Record<string,unknown>> => JSON.parse(await command(['aws', ...args, '--output', 'json']) || '{}');
const counts = async (client: Client) => {
  const tables = await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result: Record<string,string> = {};
  for (const {tablename} of tables.rows) {
    const response = await client.query<{count:string}>(`SELECT count(*)::text AS count FROM public.${quote(tablename)}`);
    const [row] = response.rows; check(row); result[tablename] = row.count;
  }
  return result;
};
export {command, aws, counts};
