import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Redis, { Command } from "ioredis";
import { keeperAclSetuserArgs, tenantAclSetuserArgs } from "./acl";
import { VALKEY_IMAGE } from "./image";
import { createFixtureCertificates } from "./tls";

const READY_ATTEMPTS = 60;
const READY_DELAY_MS = 250;
const COMMAND_TIMEOUT_MS = 5000;
const DOCKER_SUCCESS = 0;
const TLS_PORT = 6379;

interface ValkeyFixture {
  authorityPem: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const ignoreCleanupFailure = (): null => null;

const runDocker = async (args: string[]): Promise<{ errorOutput: string; output: string }> => {
  const processResult = Bun.spawn(["docker", ...args], { stderr: "pipe", stdout: "pipe" });
  const [output, errorOutput, exitCode] = await Promise.all([
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
    processResult.exited,
  ]);
  if (exitCode !== DOCKER_SUCCESS) {
    throw new Error(`docker ${args[0] ?? "command"} failed: ${errorOutput || output}`);
  }
  return { errorOutput, output };
};

const send = (client: Redis, command: string, args: string[]): Promise<unknown> =>
  Promise.resolve(
    client.sendCommand(new Command(command, args, { replyEncoding: "utf8" })),
  );

const parsePublishedPort = (mapping: string): number => {
  const match = /:(\d+)\s*$/.exec(mapping.trim());
  if (!match?.[1]) {
    throw new Error("docker did not publish a host port for the Valkey fixture");
  }
  return Number(match[1]);
};

const createBootstrapClient = (host: string, port: number, authorityPem: string): Redis =>
  new Redis({
    commandTimeout: COMMAND_TIMEOUT_MS,
    host,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    port,
    tls: {
      ca: authorityPem,
      rejectUnauthorized: true,
      servername: host,
    },
  });

const waitUntilReady = async (host: string, port: number, authorityPem: string): Promise<Redis> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const client = createBootstrapClient(host, port, authorityPem);
    try {
      await client.connect();
      await client.ping();
      return client;
    } catch (error) {
      lastError = error;
      client.disconnect();
      await sleep(READY_DELAY_MS);
    }
  }
  throw new Error(`Valkey fixture did not accept TLS connections: ${errorMessage(lastError)}`);
};

const configureUsers = async (bootstrap: Redis): Promise<void> => {
  await send(bootstrap, "acl", ["SETUSER", ...keeperAclSetuserArgs()]);
  await send(bootstrap, "acl", ["SETUSER", ...tenantAclSetuserArgs()]);
  await send(bootstrap, "acl", ["SETUSER", "default", "off"]);
};

const startValkeyFixture = async (): Promise<ValkeyFixture> => {
  const directory = await mkdtemp(join(tmpdir(), "keeper-valkey-fixture-"));
  let container = "";
  try {
    const certificates = await createFixtureCertificates(directory);
    const name = `keeper-valkey-fixture-${String(process.pid)}-${String(Date.now())}`;
    await runDocker([
      "run",
      "-d",
      "--name",
      name,
      "-p",
      "127.0.0.1::6379",
      "-v",
      `${directory}:/tls:ro`,
      VALKEY_IMAGE,
      "--tls-port",
      String(TLS_PORT),
      "--port",
      "0",
      "--bind",
      "0.0.0.0",
      "--tls-cert-file",
      "/tls/server.crt",
      "--tls-key-file",
      "/tls/server.key",
      "--tls-ca-cert-file",
      "/tls/ca.crt",
      "--tls-auth-clients",
      "no",
      "--protected-mode",
      "no",
      "--appendonly",
      "no",
      "--save",
      "",
    ]);
    container = name;
    const published = await runDocker(["port", container, `${String(TLS_PORT)}/tcp`]);
    const port = parsePublishedPort(published.output);
    const bootstrap = await waitUntilReady(certificates.host, port, certificates.authorityPem);
    try {
      await configureUsers(bootstrap);
    } finally {
      bootstrap.disconnect();
    }
    return {
      authorityPem: certificates.authorityPem,
      host: certificates.host,
      port,
      stop: async () => {
        if (container.length > 0) {
          await runDocker(["rm", "-f", container]).catch(ignoreCleanupFailure);
        }
        await rm(directory, { force: true, recursive: true });
      },
    };
  } catch (error) {
    if (container.length > 0) {
      await runDocker(["rm", "-f", container]).catch(ignoreCleanupFailure);
    }
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
};

export { createBootstrapClient, send, startValkeyFixture };
export type { ValkeyFixture };
