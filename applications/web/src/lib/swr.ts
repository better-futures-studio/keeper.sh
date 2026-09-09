import type { ScopedMutator } from "swr";
import { notifyEventsChanged } from "./events-changed";

/** Revalidate accounts, sources, and every mounted events reader; use after any account or source change. */
export function invalidateCalendarData(
  globalMutate: ScopedMutator,
  ...additionalKeys: string[]
) {
  notifyEventsChanged();
  return Promise.all([
    globalMutate("/api/accounts"),
    globalMutate("/api/sources"),
    ...additionalKeys.map((key) => globalMutate(key)),
  ]);
}
