import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { database as contextDatabase } from "@/context";
import { applyCalendarVisibilityTransition } from "./calendar-hidden";

const EMPTY_LIST_COUNT = 0;

type SelectionClient = Pick<typeof contextDatabase, "delete" | "select" | "update" | "transaction">;

interface AccountCalendarSelection {
  hidden: string[];
  visible: string[];
}

type ApplyAccountCalendarSelectionResult =
  | { kind: "ok"; selection: AccountCalendarSelection }
  | { kind: "account-not-found" }
  | { kind: "unknown-calendar-ids" };

const uniqueIds = (calendarIds: string[]): string[] => [...new Set(calendarIds)];

const applyAccountCalendarSelection = (
  client: SelectionClient,
  userId: string,
  accountId: string,
  calendarIds: string[],
): Promise<ApplyAccountCalendarSelectionResult> => {
  const visibleIds = uniqueIds(calendarIds);

  return client.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ id: calendarAccountsTable.id })
      .from(calendarAccountsTable)
      .where(and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ))
      .limit(1);

    if (!account) {
      return { kind: "account-not-found" as const };
    }

    const accountCalendars = await transaction
      .select({
        hidden: calendarsTable.hidden,
        id: calendarsTable.id,
      })
      .from(calendarsTable)
      .where(and(
        eq(calendarsTable.accountId, accountId),
        eq(calendarsTable.userId, userId),
      ));

    const accountCalendarIds = new Set(accountCalendars.map(({ id }) => id));
    const unknownIds = visibleIds.filter((calendarId) => !accountCalendarIds.has(calendarId));
    if (unknownIds.length > EMPTY_LIST_COUNT) {
      return { kind: "unknown-calendar-ids" as const };
    }

    const visibleIdSet = new Set(visibleIds);
    const hiddenIds = accountCalendars
      .filter(({ id }) => !visibleIdSet.has(id))
      .map(({ id }) => id);
    const newlyHiddenIds = accountCalendars
      .filter(({ hidden, id }) => !visibleIdSet.has(id) && !hidden)
      .map(({ id }) => id);
    const newlyVisibleIds = accountCalendars
      .filter(({ hidden, id }) => visibleIdSet.has(id) && hidden)
      .map(({ id }) => id);

    if (visibleIds.length > EMPTY_LIST_COUNT) {
      await transaction
        .update(calendarsTable)
        .set({ hidden: false })
        .where(and(
          eq(calendarsTable.accountId, accountId),
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, visibleIds),
        ));
    }

    if (hiddenIds.length > EMPTY_LIST_COUNT) {
      await transaction
        .update(calendarsTable)
        .set({ hidden: true })
        .where(and(
          eq(calendarsTable.accountId, accountId),
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, hiddenIds),
        ));
    }

    await applyCalendarVisibilityTransition(transaction, {
      newlyHiddenIds,
      newlyVisibleIds,
    });

    return {
      kind: "ok" as const,
      selection: { hidden: hiddenIds, visible: visibleIds },
    };
  });
};

export { applyAccountCalendarSelection };
export type { AccountCalendarSelection, ApplyAccountCalendarSelectionResult, SelectionClient };
