import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { revalidateEventsOnChange } from "../../src/lib/swr";
import { bumpEventsVersion } from "../../src/state/events";
import { mountHook } from "../helpers/mount-hook";

const settle = () => React.act(async () => {});

describe("revalidateEventsOnChange", () => {
  it("refetches an /api/events key when the events version bumps", async () => {
    const fetcher = vi.fn(async () => ({ count: 1 }));
    const hook = mountHook(() =>
      useSWR("/api/events/count?swr-test", fetcher, { use: [revalidateEventsOnChange] }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await React.act(async () => {
      bumpEventsVersion();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    hook.unmount();
    await React.act(async () => {
      bumpEventsVersion();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetches every loaded page of an /api/events infinite key", async () => {
    const fetcher = vi.fn(async (key: string) => [key]);
    const hook = mountHook(() =>
      useSWRInfinite((index) => `/api/events?swr-test-page=${index}`, fetcher, {
        initialSize: 2,
        revalidateFirstPage: false,
        use: [revalidateEventsOnChange],
      }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);

    await React.act(async () => {
      bumpEventsVersion();
    });
    expect(fetcher).toHaveBeenCalledTimes(4);

    hook.unmount();
  });

  it("leaves other keys alone", async () => {
    const fetcher = vi.fn(async () => []);
    const hook = mountHook(() =>
      useSWR("/api/sources?swr-test", fetcher, { use: [revalidateEventsOnChange] }),
    );
    await settle();

    await React.act(async () => {
      bumpEventsVersion();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    hook.unmount();
  });
});
