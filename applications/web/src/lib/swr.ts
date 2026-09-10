import type { ScopedMutator } from "swr";
import type { CalendarSource } from "@/types/api";
import { apiFetch } from "./fetcher";

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

/** PATCHes a calendar's `hidden` flag and updates the shared `/api/sources` cache to match. */
export function setCalendarHidden(
  globalMutate: ScopedMutator,
  calendarId: string,
  hidden: boolean,
) {
  const applyHidden = (current: CalendarSource[] | undefined): CalendarSource[] =>
    (current ?? []).map((calendar) => (calendar.id === calendarId ? { ...calendar, hidden } : calendar));

  return globalMutate<CalendarSource[]>(
    "/api/sources",
    async (current) => {
      await apiFetch(`/api/sources/${calendarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      return applyHidden(current);
    },
    {
      optimisticData: applyHidden,
      rollbackOnError: true,
      revalidate: false,
    },
  );
}
