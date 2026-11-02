import { randomBytes } from "node:crypto";

const FEED_TOKEN_PREFIX = "feed_";
const FEED_TOKEN_BYTES = 32;
const FEED_TOKEN_PATTERN = /^feed_[0-9a-f]{64}$/;

const generateFeedToken = (): string =>
  FEED_TOKEN_PREFIX + randomBytes(FEED_TOKEN_BYTES).toString("hex");

export {
  FEED_TOKEN_PATTERN,
  FEED_TOKEN_PREFIX,
  generateFeedToken,
};
