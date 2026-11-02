import { beforeEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import {
  addConnection,
  createBroadcastService,
  removeConnection,
} from "../src/index";
import { connections } from "../src/state";
import type { Socket } from "../src/types";

type MessageHandler = (channel: string, message: string) => void;

interface FakeSubscriber {
  on: (event: string, handler: MessageHandler) => void;
  subscribe: ReturnType<typeof vi.fn<(channel: string) => Promise<number>>>;
  handler: MessageHandler | null;
}

interface FakeRedis {
  duplicate: ReturnType<typeof vi.fn<() => FakeSubscriber>>;
  publish: ReturnType<typeof vi.fn<(channel: string, message: string) => Promise<number>>>;
  subscriber: FakeSubscriber;
}

const createFakeRedis = (): FakeRedis => {
  const subscriber: FakeSubscriber = {
    handler: null,
    on(event: string, handler: MessageHandler): void {
      if (event === "message") {
        subscriber.handler = handler;
      }
    },
    subscribe: vi.fn((_channel: string) => Promise.resolve(1)),
  };

  return {
    duplicate: vi.fn(() => subscriber),
    publish: vi.fn((_channel: string, _message: string) => Promise.resolve(1)),
    subscriber,
  };
};

const createSocket = (userId: string): Socket & { sent: string[] } => {
  const sent: string[] = [];
  const socket = {
    data: { userId },
    sent,
    send: (message: string) => {
      sent.push(message);
    },
  };
  return socket as Socket & { sent: string[] };
};

const asRedis = (fake: FakeRedis): Redis => fake as unknown as Redis;

const waitForHandler = async (subscriber: FakeSubscriber): Promise<MessageHandler> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (subscriber.handler) {
      return subscriber.handler;
    }
    await Promise.resolve();
  }
  throw new Error("subscriber message handler was not registered");
};

beforeEach(() => {
  connections.clear();
});

describe("createBroadcastService channel selection", () => {
  it("publishes and subscribes on the legacy default when unset", async () => {
    const redis = createFakeRedis();
    const service = createBroadcastService({ redis: asRedis(redis) });
    const socket = createSocket("user-default");
    addConnection("user-default", socket);

    await service.startSubscriber();
    service.emit("user-default", "sync:progress", { seq: 1 });

    expect(redis.publish.mock.calls.map(([channel]) => channel)).toEqual(["broadcast"]);
    expect(redis.subscriber.subscribe.mock.calls.map(([channel]) => channel)).toEqual(["broadcast"]);

    const handler = await waitForHandler(redis.subscriber);
    handler("broadcast", JSON.stringify({
      data: { seq: 1 },
      event: "sync:progress",
      userId: "user-default",
    }));

    expect(socket.sent).toEqual([JSON.stringify({ data: { seq: 1 }, event: "sync:progress" })]);
    removeConnection("user-default", socket);
  });

  it("publishes, subscribes, and dispatches on the configured channel", async () => {
    const redis = createFakeRedis();
    const service = createBroadcastService({
      channel: "keeper:broadcast",
      redis: asRedis(redis),
    });
    const socket = createSocket("user-aws");
    addConnection("user-aws", socket);

    await service.startSubscriber();
    service.emit("user-aws", "sync:complete", { seq: 8 });

    expect(redis.publish).toHaveBeenCalledWith(
      "keeper:broadcast",
      JSON.stringify({ data: { seq: 8 }, event: "sync:complete", userId: "user-aws" }),
    );
    expect(redis.subscriber.subscribe).toHaveBeenCalledWith("keeper:broadcast");

    const handler = await waitForHandler(redis.subscriber);
    handler("keeper:broadcast", JSON.stringify({
      data: { seq: 8 },
      event: "sync:complete",
      userId: "user-aws",
    }));

    expect(socket.sent).toEqual([JSON.stringify({ data: { seq: 8 }, event: "sync:complete" })]);
    removeConnection("user-aws", socket);
  });

  it("does not dispatch a payload that arrived on a different channel", async () => {
    const redis = createFakeRedis();
    const service = createBroadcastService({
      channel: "keeper:broadcast",
      redis: asRedis(redis),
    });
    const socket = createSocket("user-aws");
    addConnection("user-aws", socket);

    await service.startSubscriber();
    const handler = await waitForHandler(redis.subscriber);
    handler("broadcast", JSON.stringify({
      data: { seq: 1 },
      event: "sync:progress",
      userId: "user-aws",
    }));

    expect(socket.sent).toEqual([]);
    removeConnection("user-aws", socket);
  });

  it("rejects an empty channel without touching redis", () => {
    const redis = createFakeRedis();

    expect(() => createBroadcastService({
      channel: "",
      redis: asRedis(redis),
    })).toThrow();
    expect(redis.publish).not.toHaveBeenCalled();
    expect(redis.duplicate).not.toHaveBeenCalled();
  });
});
