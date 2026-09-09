import { useEffect } from "react";
import { useStore } from "jotai";
import type { Key, Middleware, ScopedMutator } from "swr";
import { eventsVersionAtom } from "@/state/events";

/**
 * Revalidate all account and source caches.
 * Use after creating, updating, or deleting accounts/sources.
 */
export function invalidateAccountsAndSources(
  globalMutate: ScopedMutator,
  ...additionalKeys: string[]
) {
  return Promise.all([
    globalMutate("/api/accounts"),
    globalMutate("/api/sources"),
    ...additionalKeys.map((key) => globalMutate(key)),
  ]);
}

const EVENTS_KEY_PREFIX = "/api/events";

const resolveFirstKey = (key: Key): unknown => {
  if (typeof key !== "function") return key;
  try {
    return (key as (index: number, previous: null) => unknown)(0, null);
  } catch {
    return null;
  }
};

/** Refetches every /api/events reader through its own bound mutate, which is the only path that forces infinite pages. */
export const revalidateEventsOnChange: Middleware = (useSWRNext) => (key, fetcher, config) => {
  const swr = useSWRNext(key, fetcher, config);
  const store = useStore();
  const firstKey = resolveFirstKey(key);
  const isEventsKey = typeof firstKey === "string" && firstKey.startsWith(EVENTS_KEY_PREFIX);
  const { mutate } = swr;

  useEffect(() => {
    if (!isEventsKey) return;
    return store.sub(eventsVersionAtom, () => {
      void mutate();
    });
  }, [isEventsKey, mutate, store]);

  return swr;
};
