import { describe, expect, it } from "vitest";
import {
  calendarSnapshotsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import {
  applyCalendarVisibilityTransition,
  applyHiddenFieldTransition,
  FRESH_INGEST_STATE,
  hiddenTransitionCalendarIds,
  purgeIngestedCalendarData,
  resetCalendarIngestState,
} from "../../src/utils/calendar-hidden";
import type { HiddenCalendarDataClient } from "../../src/utils/calendar-hidden";

const CAL_A = "019c0000-0000-7000-8000-0000000000a1";
const CAL_B = "019c0000-0000-7000-8000-0000000000b1";

interface MutationState {
  deletedTables: unknown[];
  updates: Record<string, unknown>[];
}

const createMutationClient = (): {
  client: HiddenCalendarDataClient;
  state: MutationState;
} => {
  const state: MutationState = { deletedTables: [], updates: [] };

  const client = {
    delete: (table: unknown) => {
      state.deletedTables.push(table);
      return { where: () => Promise.resolve() };
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  } as unknown as HiddenCalendarDataClient;

  return { client, state };
};

describe("hiddenTransitionCalendarIds", () => {
  it("returns no ids when visibility does not change", () => {
    expect(hiddenTransitionCalendarIds(CAL_A, true, true)).toEqual({
      newlyHiddenIds: [],
      newlyVisibleIds: [],
    });
    expect(hiddenTransitionCalendarIds(CAL_A, false, false)).toEqual({
      newlyHiddenIds: [],
      newlyVisibleIds: [],
    });
  });

  it("names a calendar newly hidden or newly visible", () => {
    expect(hiddenTransitionCalendarIds(CAL_A, false, true)).toEqual({
      newlyHiddenIds: [CAL_A],
      newlyVisibleIds: [],
    });
    expect(hiddenTransitionCalendarIds(CAL_A, true, false)).toEqual({
      newlyHiddenIds: [],
      newlyVisibleIds: [CAL_A],
    });
  });
});

describe("purgeIngestedCalendarData", () => {
  it("does nothing for an empty id list", async () => {
    const { client, state } = createMutationClient();

    await purgeIngestedCalendarData(client, []);

    expect(state.deletedTables).toEqual([]);
  });

  it("deletes event states and snapshots for the calendar", async () => {
    const { client, state } = createMutationClient();

    await purgeIngestedCalendarData(client, [CAL_A, CAL_B]);

    expect(state.deletedTables).toEqual([eventStatesTable, calendarSnapshotsTable]);
  });
});

describe("resetCalendarIngestState", () => {
  it("does nothing for an empty id list", async () => {
    const { client, state } = createMutationClient();

    await resetCalendarIngestState(client, []);

    expect(state).toEqual({ deletedTables: [], updates: [] });
  });

  it("clears the snapshot and restores a fresh ingest cursor", async () => {
    const { client, state } = createMutationClient();

    await resetCalendarIngestState(client, [CAL_A]);

    expect(state.deletedTables).toEqual([calendarSnapshotsTable]);
    expect(state.updates).toEqual([FRESH_INGEST_STATE]);
  });
});

describe("applyCalendarVisibilityTransition", () => {
  it("purges ingested rows and mappings when hiding", async () => {
    const { client, state } = createMutationClient();

    await applyCalendarVisibilityTransition(client, {
      newlyHiddenIds: [CAL_A],
      newlyVisibleIds: [],
    });

    expect(state.deletedTables).toEqual([
      eventStatesTable,
      calendarSnapshotsTable,
      sourceDestinationMappingsTable,
    ]);
    expect(state.updates).toEqual([]);
  });

  it("resets ingest state when showing", async () => {
    const { client, state } = createMutationClient();

    await applyCalendarVisibilityTransition(client, {
      newlyHiddenIds: [],
      newlyVisibleIds: [CAL_A],
    });

    expect(state.deletedTables).toEqual([calendarSnapshotsTable]);
    expect(state.updates).toEqual([FRESH_INGEST_STATE]);
  });
});

describe("applyHiddenFieldTransition", () => {
  it("purges ingested event states when PATCH hides a visible calendar", async () => {
    const { client, state } = createMutationClient();

    await applyHiddenFieldTransition(client, CAL_A, false, true);

    expect(state.deletedTables).toEqual([
      eventStatesTable,
      calendarSnapshotsTable,
      sourceDestinationMappingsTable,
    ]);
  });

  it("resets ingest state when PATCH shows a hidden calendar", async () => {
    const { client, state } = createMutationClient();

    await applyHiddenFieldTransition(client, CAL_A, true, false);

    expect(state.deletedTables).toEqual([calendarSnapshotsTable]);
    expect(state.updates).toEqual([FRESH_INGEST_STATE]);
  });

  it("does nothing when PATCH repeats the current visibility", async () => {
    const { client, state } = createMutationClient();

    await applyHiddenFieldTransition(client, CAL_A, true, true);
    await applyHiddenFieldTransition(client, CAL_A, false, false);
    await applyHiddenFieldTransition(client, CAL_A, null, true);

    expect(state).toEqual({ deletedTables: [], updates: [] });
  });
});
