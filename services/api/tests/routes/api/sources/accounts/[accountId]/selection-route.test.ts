import { describe, expect, it } from "vitest";
import { handlePutAccountCalendarSelectionRoute } from "../../../../../../src/routes/api/sources/accounts/[accountId]/selection-route";
import type { ApplyAccountCalendarSelectionResult } from "../../../../../../src/utils/calendar-selection";

const readJson = (response: Response): Promise<unknown> => response.json();

const okResult = (
  visible: string[],
  hidden: string[],
): ApplyAccountCalendarSelectionResult => ({
  kind: "ok",
  selection: { hidden, visible },
});

describe("handlePutAccountCalendarSelectionRoute", () => {
  it("returns 400 when accountId is missing", async () => {
    const response = await handlePutAccountCalendarSelectionRoute(
      { body: { calendarIds: [] }, params: {}, userId: "user-1" },
      { applySelection: () => Promise.resolve(okResult([], [])) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when calendarIds is missing", async () => {
    const response = await handlePutAccountCalendarSelectionRoute(
      { body: {}, params: { accountId: "account-1" }, userId: "user-1" },
      { applySelection: () => Promise.resolve(okResult([], [])) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when the account is not the user's", async () => {
    const response = await handlePutAccountCalendarSelectionRoute(
      {
        body: { calendarIds: ["cal-1"] },
        params: { accountId: "account-1" },
        userId: "user-1",
      },
      { applySelection: () => Promise.resolve({ kind: "account-not-found" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 when a calendar id is not on the account", async () => {
    const response = await handlePutAccountCalendarSelectionRoute(
      {
        body: { calendarIds: ["cal-missing"] },
        params: { accountId: "account-1" },
        userId: "user-1",
      },
      { applySelection: () => Promise.resolve({ kind: "unknown-calendar-ids" }) },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "Some calendar IDs do not belong to this account",
    });
  });

  it("returns visible and hidden ids on success", async () => {
    const response = await handlePutAccountCalendarSelectionRoute(
      {
        body: { calendarIds: ["cal-1"] },
        params: { accountId: "account-1" },
        userId: "user-1",
      },
      {
        applySelection: (userId, accountId, calendarIds) => {
          expect({ userId, accountId, calendarIds }).toEqual({
            accountId: "account-1",
            calendarIds: ["cal-1"],
            userId: "user-1",
          });
          return Promise.resolve(okResult(["cal-1"], ["cal-2"]));
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      hidden: ["cal-2"],
      visible: ["cal-1"],
    });
  });
});
