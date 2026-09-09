import { EVENTS_CHANGED_EVENT } from "@keeper.sh/data-schemas/client";
import { broadcastService } from "@/context";

/** Tells each user's open dashboards that their event states just changed. */
const notifyEventsChanged = (userIds: Iterable<string>): void => {
  for (const userId of userIds) {
    broadcastService.emit(userId, EVENTS_CHANGED_EVENT, {});
  }
};

export { notifyEventsChanged };
