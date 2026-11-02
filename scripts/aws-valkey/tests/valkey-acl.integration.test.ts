import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import {
  addConnection,
  createBroadcastService,
  removeConnection,
} from "../../../packages/broadcast/src/index";
import { connections } from "../../../packages/broadcast/src/state";
import type { Socket } from "../../../packages/broadcast/src/types";
import {
  KEEPER_DATABASE,
  KEEPER_USERNAME,
  SYNTHETIC_KEEPER_PASSWORD,
  SYNTHETIC_TENANT_PASSWORD,
  TENANT_DATABASE,
  TENANT_USERNAME,
} from "../acl";
import { send, startValkeyFixture } from "../server";
import type { ValkeyFixture } from "../server";

const COMMAND_TIMEOUT_MS = 5000;
const JOB_WAIT_MS = 15_000;
const SUBSCRIBE_WAIT_MS = 5000;
const CONNECT_TIMEOUT_MS = 2000;
const LOCK_TTL_SECONDS = 30;
const RELEASE_SCRIPT = `
local holder = redis.call('GET', KEYS[1])
if holder == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;
const CROSS_DB_SCRIPT = `
redis.call('SELECT', tonumber(ARGV[1]))
return redis.call('GET', KEYS[1])
`;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isDenied = (error: unknown): boolean =>
  /NOPERM|NOAUTH|WRONGPASS|ERR ACL failure|no permissions|invalid username-password|Authentication required/i.test(
    errorMessage(error),
  );

const isTlsVerificationFailure = (error: unknown): boolean =>
  /unable to verify|self-signed|UNABLE_TO_VERIFY|unable to get local issuer|certificate/i.test(
    errorMessage(error),
  );

const rejectDenied = async (operation: () => Promise<unknown>): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    expect(isDenied(error)).toBe(true);
    return;
  }
  throw new Error("expected Valkey to deny the command");
};

const buildUrl = (
  username: string,
  password: string,
  host: string,
  port: number,
  database: number,
): string =>
  `rediss://${username}:${encodeURIComponent(password)}@${host}:${String(port)}/${String(database)}`;

const connectFromUrl = async (
  url: string,
  authorityPem: string,
  host: string,
): Promise<Redis> => {
  const client = new Redis(url, {
    commandTimeout: COMMAND_TIMEOUT_MS,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    tls: {
      ca: authorityPem,
      rejectUnauthorized: true,
      servername: host,
    },
  });
  client.on("error", () => null);
  await client.connect();
  return client;
};

const connectAndCaptureFailure = async (client: Redis): Promise<unknown> => {
  let emitted: unknown = null;
  client.on("error", (error: unknown) => {
    emitted = error;
  });
  try {
    await client.connect();
    await client.ping();
    return emitted;
  } catch (error) {
    if (emitted) {
      return emitted;
    }
    return error;
  }
};

const waitFor = async (
  probe: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(label);
};

interface Runtime {
  clients: Redis[];
  fixture: ValkeyFixture;
  keeper: Redis;
  tenant: Redis;
}

const state: { runtime: Runtime | null } = { runtime: null };

const runtime = (): Runtime => {
  if (!state.runtime) {
    throw new Error("Valkey fixture was not started");
  }
  return state.runtime;
};

describe("Valkey 9.1 TLS ACL fixture", () => {
  beforeAll(async () => {
    const fixture = await startValkeyFixture();
    const keeper = await connectFromUrl(
      buildUrl(
        KEEPER_USERNAME,
        SYNTHETIC_KEEPER_PASSWORD,
        fixture.host,
        fixture.port,
        KEEPER_DATABASE,
      ),
      fixture.authorityPem,
      fixture.host,
    );
    const tenant = await connectFromUrl(
      buildUrl(
        TENANT_USERNAME,
        SYNTHETIC_TENANT_PASSWORD,
        fixture.host,
        fixture.port,
        TENANT_DATABASE,
      ),
      fixture.authorityPem,
      fixture.host,
    );
    state.runtime = { clients: [keeper, tenant], fixture, keeper, tenant };
  }, 120_000);

  afterAll(async () => {
    const current = state.runtime;
    if (!current) {
      return;
    }
    for (const client of current.clients) {
      client.disconnect();
    }
    await current.fixture.stop();
  });

  it("connects ioredis over rediss with username, password, DB1 and verified TLS", async () => {
    const { keeper } = runtime();
    expect(keeper.options.username).toBe(KEEPER_USERNAME);
    expect(keeper.options.db).toBe(KEEPER_DATABASE);
    expect(keeper.options.tls).toBeDefined();
    expect(keeper.options.tls?.rejectUnauthorized).not.toBe(false);

    const written = await keeper.set("probe:identity", "keeper-db1", "EX", LOCK_TTL_SECONDS);
    expect(written).toBe("OK");
    expect(await keeper.get("probe:identity")).toBe("keeper-db1");
  });

  it("rejects a client that does not trust the fixture CA", async () => {
    const { fixture } = runtime();
    const untrusted = new Redis(
      buildUrl(
        KEEPER_USERNAME,
        SYNTHETIC_KEEPER_PASSWORD,
        fixture.host,
        fixture.port,
        KEEPER_DATABASE,
      ),
      {
        commandTimeout: COMMAND_TIMEOUT_MS,
        connectTimeout: CONNECT_TIMEOUT_MS,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        tls: {
          rejectUnauthorized: true,
          servername: fixture.host,
        },
      },
    );
    try {
      const failure = await connectAndCaptureFailure(untrusted);
      expect(isTlsVerificationFailure(failure)).toBe(true);
    } finally {
      untrusted.disconnect();
    }
  });

  it("rejects the wrong password", async () => {
    const { fixture } = runtime();
    const wrong = new Redis(
      buildUrl(
        KEEPER_USERNAME,
        "synthetic-wrong-password",
        fixture.host,
        fixture.port,
        KEEPER_DATABASE,
      ),
      {
        commandTimeout: COMMAND_TIMEOUT_MS,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        tls: {
          ca: fixture.authorityPem,
          rejectUnauthorized: true,
          servername: fixture.host,
        },
      },
    );
    try {
      const failure = await connectAndCaptureFailure(wrong);
      expect(isDenied(failure)).toBe(true);
    } finally {
      wrong.disconnect();
    }
  });

  it("denies SELECT of DB0 and DB2", async () => {
    const { keeper } = runtime();
    await rejectDenied(() => keeper.select(0));
    await rejectDenied(() => keeper.select(2));
    expect(await keeper.ping()).toBe("PONG");
  });

  it("keeps a DB2 tenant from reading DB1 keys", async () => {
    const { keeper, tenant } = runtime();
    await keeper.set("shared-name", "keeper-secret", "EX", LOCK_TTL_SECONDS);
    expect(await tenant.get("shared-name")).toBeNull();
    await rejectDenied(() => tenant.select(KEEPER_DATABASE));
  });

  it("denies cross-database access from Lua", async () => {
    const { keeper, tenant } = runtime();
    await keeper.set("lua-source", "db1-value", "EX", LOCK_TTL_SECONDS);
    await rejectDenied(() => keeper.eval(CROSS_DB_SCRIPT, 1, "lua-source", "0"));
    await rejectDenied(() => keeper.eval(CROSS_DB_SCRIPT, 1, "lua-source", "2"));
    await rejectDenied(() => tenant.eval(CROSS_DB_SCRIPT, 1, "lua-source", "1"));
  });

  it("denies FLUSHALL, SWAPDB and SCRIPT FLUSH", async () => {
    const { keeper } = runtime();
    await rejectDenied(() => keeper.flushall());
    await rejectDenied(() => keeper.swapdb(KEEPER_DATABASE, TENANT_DATABASE));
    await rejectDenied(() => send(keeper, "script", ["FLUSH"]));
  });

  it("publishes and subscribes on keeper:broadcast and denies other channels", async () => {
    const { clients, keeper } = runtime();
    connections.clear();
    const sent: string[] = [];
    const socket = {
      data: { userId: "fixture-user" },
      send: (message: string) => {
        sent.push(message);
      },
    } as Socket;
    addConnection("fixture-user", socket);

    const service = createBroadcastService({
      channel: "keeper:broadcast",
      redis: keeper,
    });
    await service.startSubscriber();
    service.emit("fixture-user", "sync:progress", { seq: 4 });
    await waitFor(
      () => sent.length === 1,
      SUBSCRIBE_WAIT_MS,
      "keeper:broadcast subscriber did not receive the payload",
    );
    expect(sent).toEqual([JSON.stringify({ data: { seq: 4 }, event: "sync:progress" })]);

    await rejectDenied(() => keeper.publish("broadcast", "legacy"));
    await rejectDenied(() => keeper.publish("other:channel", "nope"));
    const deniedSubscriber = keeper.duplicate();
    clients.push(deniedSubscriber);
    await deniedSubscriber.connect();
    await rejectDenied(() => deniedSubscriber.subscribe("broadcast"));
    removeConnection("fixture-user", socket);
    connections.clear();
  });

  it("runs lock, signaling and BullMQ add/process/complete on DB1", async () => {
    const { clients, fixture, keeper } = runtime();
    const lockKey = "sync:lock:fixture";
    const signalKey = "pending:signal:fixture";
    expect(await keeper.set(lockKey, "holder-1", "EX", LOCK_TTL_SECONDS, "NX")).toBe("OK");
    expect(await keeper.set(lockKey, "holder-2", "EX", LOCK_TTL_SECONDS, "NX")).toBeNull();
    expect(await keeper.eval(RELEASE_SCRIPT, 1, lockKey, "holder-1")).toBe(1);
    expect(await keeper.get(lockKey)).toBeNull();

    const waiter = keeper.duplicate();
    clients.push(waiter);
    await waiter.connect();
    const pending = waiter.blpop(signalKey, 5);
    await keeper.rpush(signalKey, "calendar-1");
    expect(await pending).toEqual([signalKey, "calendar-1"]);

    const connection = {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      tls: {
        ca: fixture.authorityPem,
        rejectUnauthorized: true,
        servername: fixture.host,
      },
      url: buildUrl(
        KEEPER_USERNAME,
        SYNTHETIC_KEEPER_PASSWORD,
        fixture.host,
        fixture.port,
        KEEPER_DATABASE,
      ),
    };
    const queueName = `keeper-valkey-probe-${String(Date.now())}`;
    const queue = new Queue(queueName, { connection });
    const processed: string[] = [];
    const worker = new Worker(
      queueName,
      (job) => {
        processed.push(String(job.data.marker));
        return Promise.resolve({ ok: true });
      },
      { connection },
    );
    try {
      const completed = new Promise<void>((resolve, reject) => {
        worker.on("completed", () => {
          resolve();
        });
        worker.on("failed", (_job, error) => {
          reject(error);
        });
      });
      await queue.add("probe", { marker: "complete-me" });
      await Promise.race([
        completed,
        Bun.sleep(JOB_WAIT_MS).then(() => {
          throw new Error("BullMQ job did not complete");
        }),
      ]);
      expect(processed).toEqual(["complete-me"]);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
