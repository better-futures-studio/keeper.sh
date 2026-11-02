import arkenv from "arkenv";
import { resolveBroadcastChannel } from "@keeper.sh/broadcast";

const schema = {
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  CALENDAR_REDISCOVERY_ENABLED: "boolean?",
  COMMERCIAL_MODE: "boolean?",
  CRON_FLUSH_POOL_MAX: "number?",
  DATABASE_POOL_MAX: "number?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  PUSH_REDUCED_POLLING: "boolean?",
  REDIS_BROADCAST_CHANNEL: "string?",
  REDIS_URL: "string.url",
  WEBHOOK_PUBLIC_URL: "string.url?",
  WORKER_JOB_QUEUE_ENABLED: "boolean?",
} as const;

const loaded = arkenv(schema);

const env = {
  ...loaded,
  REDIS_BROADCAST_CHANNEL: resolveBroadcastChannel(loaded.REDIS_BROADCAST_CHANNEL),
};

export { schema };
export default env;
