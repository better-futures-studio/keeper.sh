import { describe, expect, it } from "vitest";
import {
  BROADCAST_CHANNEL_ERROR,
  MAX_BROADCAST_CHANNEL_LENGTH,
  resolveBroadcastChannel,
} from "../src/channel";

describe("resolveBroadcastChannel", () => {
  it("keeps the legacy default when the value is omitted", () => {
    expect(resolveBroadcastChannel()).toBe("broadcast");
  });

  it("accepts an explicit AWS-scoped channel", () => {
    expect(resolveBroadcastChannel("keeper:broadcast")).toBe("keeper:broadcast");
  });

  it("accepts the legacy default when it is set explicitly", () => {
    expect(resolveBroadcastChannel("broadcast")).toBe("broadcast");
  });

  it("rejects empty, whitespace, control, and oversized values", () => {
    const rejected = [
      "",
      " ",
      "  broadcast",
      "broadcast ",
      "keeper broadcast",
      "keeper:broadcast\n",
      "keeper:broadcast\u0000",
      ":broadcast",
      "keeper:*",
      "a".repeat(MAX_BROADCAST_CHANNEL_LENGTH + 1),
    ];

    for (const channel of rejected) {
      expect(() => resolveBroadcastChannel(channel)).toThrow(BROADCAST_CHANNEL_ERROR);
    }
  });
});
