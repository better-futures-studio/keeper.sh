import { describe, expect, it, vi } from "vitest";
import { notifyEventsChanged, subscribeEventsChanged } from "../../src/lib/events-changed";

describe("events-changed", () => {
  it("notifies every subscriber until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeEventsChanged(first);
    const unsubscribeSecond = subscribeEventsChanged(second);

    notifyEventsChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    notifyEventsChanged();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
  });
});
