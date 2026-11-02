import arkenv from "arkenv";
import { resolveBroadcastChannel } from "@keeper.sh/broadcast";

const schema = {
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  DATABASE_POOL_MAX: "number?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  REDIS_BROADCAST_CHANNEL: "string?",
  REDIS_URL: "string.url",
  WORKER_CONCURRENCY: "string?",
} as const;

const loaded = arkenv(schema);

const env = {
  ...loaded,
  REDIS_BROADCAST_CHANNEL: resolveBroadcastChannel(loaded.REDIS_BROADCAST_CHANNEL),
};

export { schema };
export default env;
