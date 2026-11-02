import { describe, expect, it } from "bun:test";
import {
  FEED_TOKEN_PATTERN,
  FEED_TOKEN_PREFIX,
  generateFeedToken,
} from "../src/ical-feed-tokens";

describe("generateFeedToken", () => {
  it("mints an opaque prefixed token", () => {
    const token = generateFeedToken();
    expect(token).toMatch(FEED_TOKEN_PATTERN);
    expect(token.startsWith(FEED_TOKEN_PREFIX)).toBe(true);
  });

  it("takes no caller input a token could be derived from", () => {
    expect(generateFeedToken).toHaveLength(0);
  });

  it("never repeats a token across a thousand draws", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateFeedToken()));
    expect(tokens.size).toBe(1000);
  });

  it("does not mint api-token-namespaced values", () => {
    expect(generateFeedToken().startsWith("kpr_")).toBe(false);
  });
});
