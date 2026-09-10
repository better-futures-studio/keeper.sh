import {
  calendarSnapshotsTable,
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import type { database as contextDatabase } from "@/context";

const CALENDAR_HIDDEN_MESSAGE = "Calendar is hidden";
const EMPTY_LIST_COUNT = 0;

const visibleCalendarCondition = eq(calendarsTable.hidden, false);

const FRESH_INGEST_STATE = {
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  storedEventCount: null,
  syncToken: null,
} as const;

type MappingMutationClient = Pick<typeof contextDatabase, "delete">;
type HiddenCalendarDataClient = Pick<typeof contextDatabase, "delete" | "select" | "update">;

interface CalendarVisibilityTransition {
  newlyHiddenIds: string[];
  newlyVisibleIds: string[];
}

const removeMappingsForCalendars = async (
  client: MappingMutationClient,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === EMPTY_LIST_COUNT) {
    return;
  }

  await client
    .delete(sourceDestinationMappingsTable)
    .where(or(
      inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds),
      inArray(sourceDestinationMappingsTable.destinationCalendarId, calendarIds),
    ));
};

/*
 * Ingested rows only. user_events are created through Keeper, and event_states
 * on other calendars are destinations we pushed to — neither is this calendar's
 * source snapshot.
 */
const purgeIngestedCalendarData = async (
  client: HiddenCalendarDataClient,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === EMPTY_LIST_COUNT) {
    return;
  }

  await client
    .delete(eventStatesTable)
    .where(inArray(eventStatesTable.calendarId, calendarIds));
  await client
    .delete(calendarSnapshotsTable)
    .where(inArray(calendarSnapshotsTable.calendarId, calendarIds));
};

const resetCalendarIngestState = async (
  client: HiddenCalendarDataClient,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === EMPTY_LIST_COUNT) {
    return;
  }

  await client
    .delete(calendarSnapshotsTable)
    .where(inArray(calendarSnapshotsTable.calendarId, calendarIds));
  await client
    .update(calendarsTable)
    .set({ ...FRESH_INGEST_STATE })
    .where(inArray(calendarsTable.id, calendarIds));
};

const hiddenTransitionCalendarIds = (
  calendarId: string,
  previousHidden: boolean,
  nextHidden: boolean,
): CalendarVisibilityTransition => {
  if (previousHidden === nextHidden) {
    return { newlyHiddenIds: [], newlyVisibleIds: [] };
  }
  if (nextHidden) {
    return { newlyHiddenIds: [calendarId], newlyVisibleIds: [] };
  }
  return { newlyHiddenIds: [], newlyVisibleIds: [calendarId] };
};

const applyCalendarVisibilityTransition = async (
  client: HiddenCalendarDataClient,
  transition: CalendarVisibilityTransition,
): Promise<void> => {
  await purgeIngestedCalendarData(client, transition.newlyHiddenIds);
  await removeMappingsForCalendars(client, transition.newlyHiddenIds);
  await resetCalendarIngestState(client, transition.newlyVisibleIds);
};

const applyHiddenFieldTransition = async (
  client: HiddenCalendarDataClient,
  calendarId: string,
  previousHidden: boolean | null,
  nextHidden: unknown,
): Promise<void> => {
  if (previousHidden === null || (nextHidden !== true && nextHidden !== false)) {
    return;
  }

  await applyCalendarVisibilityTransition(
    client,
    hiddenTransitionCalendarIds(calendarId, previousHidden, nextHidden),
  );
};

const readCalendarHidden = async (
  client: HiddenCalendarDataClient,
  calendarId: string,
  userId: string,
): Promise<boolean | null> => {
  const [row] = await client
    .select({ hidden: calendarsTable.hidden })
    .from(calendarsTable)
    .where(and(
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.userId, userId),
    ))
    .limit(1);

  return row?.hidden ?? null;
};

export {
  applyCalendarVisibilityTransition,
  applyHiddenFieldTransition,
  CALENDAR_HIDDEN_MESSAGE,
  FRESH_INGEST_STATE,
  hiddenTransitionCalendarIds,
  purgeIngestedCalendarData,
  readCalendarHidden,
  removeMappingsForCalendars,
  resetCalendarIngestState,
  visibleCalendarCondition,
};
export type {
  CalendarVisibilityTransition,
  HiddenCalendarDataClient,
  MappingMutationClient,
};
