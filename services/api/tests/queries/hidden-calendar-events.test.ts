import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
import { getEvent } from "../../src/queries/get-event";
import { getEventCount } from "../../src/queries/get-event-count";
import { findFreeTime } from "../../src/queries/find-free-time";
import type { KeeperDatabase } from "../../src/types";

const USER_ID = "user-hidden-calendars";
const ACCOUNT_ID = "00000000-0000-4000-8000-00000000aa01";
const VISIBLE_CALENDAR_ID = "00000000-0000-4000-8000-00000000c001";
const HIDDEN_CALENDAR_ID = "00000000-0000-4000-8000-00000000c002";
const PAUSED_CALENDAR_ID = "00000000-0000-4000-8000-00000000c003";
const VISIBLE_EVENT_ID = "00000000-0000-4000-8000-00000000e001";
const HIDDEN_EVENT_ID = "00000000-0000-4000-8000-00000000e002";
const PAUSED_EVENT_ID = "00000000-0000-4000-8000-00000000e003";

const WINDOW = {
  from: new Date("2027-05-10T00:00:00.000Z"),
  to: new Date("2027-05-11T00:00:00.000Z"),
};

const DDL = `
create table calendar_accounts (
  "id" uuid primary key,
  "provider" text not null,
  "userId" text not null
);
create table calendars (
  "id" uuid primary key,
  "accountId" uuid not null,
  "userId" text not null,
  "name" text not null,
  "url" text,
  "calendarType" text not null default 'source',
  "capabilities" text[] not null default '{"pull"}',
  "hidden" boolean not null default false,
  "disabled" boolean not null default false
);
create table event_states (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "availability" text,
  "description" text,
  "endTime" timestamptz not null,
  "exceptionDates" text,
  "isAllDay" boolean,
  "location" text,
  "recurrenceId" timestamptz,
  "recurrenceRule" text,
  "sourceEventUid" text,
  "startTime" timestamptz not null,
  "startTimeZone" text,
  "title" text
);
create table user_events (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "userId" text not null,
  "sourceEventUid" text,
  "title" text,
  "description" text,
  "location" text,
  "availability" text,
  "isAllDay" boolean,
  "startTime" timestamptz not null,
  "endTime" timestamptz not null,
  "startTimeZone" text
);
`;

const client = new PGlite();
const database = drizzle(client) as unknown as KeeperDatabase;

const insertCalendar = async (
  calendarId: string,
  name: string,
  hidden: boolean,
  disabled: boolean,
): Promise<void> => {
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url", "hidden", "disabled")
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [calendarId, ACCOUNT_ID, USER_ID, name, null, hidden, disabled],
  );
};

const insertEvent = async (eventId: string, calendarId: string, title: string): Promise<void> => {
  await client.query(
    `insert into event_states (
      "id", "calendarId", "availability", "isAllDay", "startTime", "endTime", "title"
    ) values ($1, $2, 'busy', false, $3, $4, $5)`,
    [
      eventId,
      calendarId,
      "2027-05-10T10:00:00.000Z",
      "2027-05-10T11:00:00.000Z",
      title,
    ],
  );
};

beforeAll(async () => {
  await client.exec(DDL);
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [ACCOUNT_ID, "google", USER_ID],
  );
  await insertCalendar(VISIBLE_CALENDAR_ID, "Visible", false, false);
  await insertCalendar(HIDDEN_CALENDAR_ID, "Hidden", true, false);
  await insertCalendar(PAUSED_CALENDAR_ID, "Paused", false, true);
  await insertEvent(VISIBLE_EVENT_ID, VISIBLE_CALENDAR_ID, "Visible meeting");
  await insertEvent(HIDDEN_EVENT_ID, HIDDEN_CALENDAR_ID, "Hidden meeting");
  await insertEvent(PAUSED_EVENT_ID, PAUSED_CALENDAR_ID, "Paused meeting");
});

const listTitles = async (): Promise<string[]> => {
  const events = await getEventsInRange(database, USER_ID, WINDOW);
  return events.map((event) => event.title ?? "").toSorted();
};

describe("hidden calendar events", () => {
  it("excludes hidden calendars from range reads used by /api/events and /api/v1/events", async () => {
    expect(await listTitles()).toEqual(["Paused meeting", "Visible meeting"]);
  });

  it("excludes hidden calendars from event count", async () => {
    const count = await getEventCount(database, USER_ID, WINDOW);

    expect(count).toBe(2);
  });

  it("does not treat hidden-calendar events as busy for free-time", async () => {
    const range = {
      from: new Date("2027-05-10T10:00:00.000Z"),
      to: new Date("2027-05-10T11:00:00.000Z"),
    };
    const options = {
      durationMinutes: 30,
      ignoreAllDayEvents: false,
      limit: 10,
      timezone: "Etc/UTC",
      workingHours: null,
    };

    const hiddenOnly = await findFreeTime(
      database,
      USER_ID,
      range,
      options,
      { calendarId: [HIDDEN_CALENDAR_ID] },
    );
    const allVisible = await findFreeTime(database, USER_ID, range, options);

    expect(hiddenOnly.slots).toEqual([
      {
        durationMinutes: 60,
        end: "2027-05-10T11:00:00.000Z",
        start: "2027-05-10T10:00:00.000Z",
      },
    ]);
    expect(allVisible.slots).toEqual([]);
  });

  it("returns null for a single-event lookup on a hidden calendar", async () => {
    const hidden = await getEvent(database, USER_ID, HIDDEN_EVENT_ID);
    const visible = await getEvent(database, USER_ID, VISIBLE_EVENT_ID);

    expect(hidden).toBeNull();
    expect(visible?.title).toBe("Visible meeting");
  });

  it("keeps already-ingested events on a paused calendar", async () => {
    const paused = await getEvent(database, USER_ID, PAUSED_EVENT_ID);

    expect(paused?.title).toBe("Paused meeting");
  });
});
