import { useEffect } from "react";
import { subscribeEventsChanged } from "@/lib/events-changed";

export function useOnEventsChanged(revalidate: () => Promise<unknown>): void {
  useEffect(
    () =>
      subscribeEventsChanged(() => {
        void revalidate();
      }),
    [revalidate],
  );
}
