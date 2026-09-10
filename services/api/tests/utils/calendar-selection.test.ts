import { describe, expect, it } from "vitest";
import { applyAccountCalendarSelection } from "../../src/utils/calendar-selection";
import type { SelectionClient } from "../../src/utils/calendar-selection";

interface CalendarRow {
  hidden: boolean;
  id: string;
}

const ACCOUNT_ID = "019c0000-0000-7000-8000-0000000000aa";
const CAL_VISIBLE = "019c0000-0000-7000-8000-000000000001";
const CAL_HIDDEN = "019c0000-0000-7000-8000-000000000002";

const createMockClient = (options: {
  accountExists: boolean;
  calendars: CalendarRow[];
}) => {
  const state = {
    mappingDeletes: [] as string[][],
    updates: [] as { hidden: boolean; ids?: unknown }[],
  };

  const transaction = {
    delete: () => ({
      where: () => {
        state.mappingDeletes.push(options.calendars.map(({ id }) => id));
        return Promise.resolve();
      },
    }),
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if ("hidden" in fields) {
            return Promise.resolve(options.calendars);
          }
          if (options.accountExists) {
            return {
              limit: () => Promise.resolve([{ id: ACCOUNT_ID }]),
            };
          }

          return {
            limit: () => Promise.resolve([]),
          };
        },
      }),
    }),
    update: () => ({
      set: (values: { hidden: boolean }) => ({
        where: () => {
          state.updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };

  const client = {
    delete: transaction.delete,
    select: transaction.select,
    transaction: (callback: (inner: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    update: transaction.update,
  } as unknown as SelectionClient;

  return { client, state };
};

describe("applyAccountCalendarSelection", () => {
  it("returns account-not-found when the account is not the user's", async () => {
    const { client } = createMockClient({ accountExists: false, calendars: [] });

    const result = await applyAccountCalendarSelection(client, "user-1", ACCOUNT_ID, [CAL_VISIBLE]);

    expect(result).toEqual({ kind: "account-not-found" });
  });

  it("returns unknown-calendar-ids when an id is not on the account", async () => {
    const { client } = createMockClient({
      accountExists: true,
      calendars: [{ hidden: false, id: CAL_VISIBLE }],
    });

    const result = await applyAccountCalendarSelection(
      client,
      "user-1",
      ACCOUNT_ID,
      [CAL_VISIBLE, "missing"],
    );

    expect(result).toEqual({ kind: "unknown-calendar-ids" });
  });

  it("marks listed calendars visible, hides the rest, and drops mappings for newly hidden ones", async () => {
    const { client, state } = createMockClient({
      accountExists: true,
      calendars: [
        { hidden: false, id: CAL_VISIBLE },
        { hidden: false, id: CAL_HIDDEN },
      ],
    });

    const result = await applyAccountCalendarSelection(client, "user-1", ACCOUNT_ID, [CAL_VISIBLE]);

    expect(result).toEqual({
      kind: "ok",
      selection: { hidden: [CAL_HIDDEN], visible: [CAL_VISIBLE] },
    });
    expect(state.updates).toEqual([{ hidden: false }, { hidden: true }]);
    expect(state.mappingDeletes).toHaveLength(1);
  });

  it("does not drop mappings for calendars that were already hidden", async () => {
    const { client, state } = createMockClient({
      accountExists: true,
      calendars: [
        { hidden: false, id: CAL_VISIBLE },
        { hidden: true, id: CAL_HIDDEN },
      ],
    });

    const result = await applyAccountCalendarSelection(client, "user-1", ACCOUNT_ID, [CAL_VISIBLE]);

    expect(result).toEqual({
      kind: "ok",
      selection: { hidden: [CAL_HIDDEN], visible: [CAL_VISIBLE] },
    });
    expect(state.mappingDeletes).toEqual([]);
  });
});
