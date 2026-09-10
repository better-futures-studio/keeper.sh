import { describe, expect, it } from "vitest";

const SYNC_USER_PATH = `${import.meta.dirname}/../src/sync-user.ts`;

describe("hidden calendars are skipped like paused calendars", () => {
  it("uses the shared syncable predicate for destination reads", async () => {
    const source = await Bun.file(SYNC_USER_PATH).text();

    expect(source).toContain("calendarIsSyncable");
    expect(source).not.toContain("eq(calendarsTable.disabled, false)");
  });
});
