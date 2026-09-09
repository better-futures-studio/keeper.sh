import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { notifyEventsChanged } from "../../src/lib/events-changed";
import { useOnEventsChanged } from "../../src/hooks/use-on-events-changed";
import { mountHook } from "../helpers/mount-hook";

describe("useOnEventsChanged", () => {
  it("revalidates on each notification while mounted", () => {
    const revalidate = vi.fn(() => Promise.resolve());
    const hook = mountHook(() => useOnEventsChanged(revalidate));

    expect(revalidate).not.toHaveBeenCalled();

    React.act(() => {
      notifyEventsChanged();
    });
    expect(revalidate).toHaveBeenCalledTimes(1);

    hook.unmount();
    React.act(() => {
      notifyEventsChanged();
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
