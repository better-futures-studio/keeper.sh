import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { applyAccountCalendarSelection } from "@/utils/calendar-selection";
import { handlePutAccountCalendarSelectionRoute } from "./selection-route";

const PUT = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePutAccountCalendarSelectionRoute(
      { body: payload, params, userId },
      {
        applySelection: (selectionUserId, accountId, calendarIds) =>
          applyAccountCalendarSelection(database, selectionUserId, accountId, calendarIds),
      },
    );
  }),
);

export { PUT };
