import { describe, expect, it } from "bun:test";
import { runAudit } from "../src/audit";
import { inspectSchema } from "../src/schema";
import { CAMEL_CASE_LAYOUT, createMockClient } from "./mock-client";

describe("audit", () => {
  it("reports counts and statuses without selecting secrets", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: {
        user: 4,
        calendar_accounts: 5,
        calendars: 7,
        caldav_credentials: 2,
        event_states: 11,
        session: 3,
        oauth_credentials: 2,
        oauth_application: 1,
        ical_feeds: 2,
        ical_feed_settings: 2,
        ical_feed_calendars: 3,
        calendar_push_channels: 31,
        event_mappings: 4,
        source_destination_mappings: 1,
        passkey: 2,
      },
      caldav: [],
      receipts: [],
    });

    const report = await runAudit(client, "keeper-aws-staging");
    expect(report.targetMarkerPresent).toBe(true);
    expect(report.essential.user).toBe(4);
    expect(report.essential.event_states).toBe(11);
    expect(report.optional.session).toBe(3);
    expect(report.optional.ical_feeds).toBe(2);
    expect(report.optional.calendar_push_channels).toBe(31);
    expect(report.optional.passkey).toBe(2);
    expect(report.optional.event_mappings).toBe(4);
    expect(report.statuses.ical_feeds_legacy_alias).toBe(2);
    expect(report.missingOptionalTables).toEqual([]);
    expect(
      recorded.every((entry) =>
        !entry.sql.includes("SELECT")
        || entry.sql.includes("count(*)")
        || entry.sql.includes("information_schema"),
      ),
    ).toBe(true);
    expect(recorded.some((entry) => entry.sql.includes("email"))).toBe(false);
    expect(recorded.some((entry) => entry.sql.includes('"token"'))).toBe(false);
    expect(recorded.some((entry) => entry.sql.includes('"secretHash"'))).toBe(false);
    expect(recorded.some((entry) => entry.sql.includes('"publicKey"'))).toBe(false);
  });

  it("reports optional auth tables that are missing", async () => {
    const { client } = createMockClient({
      columns: CAMEL_CASE_LAYOUT.filter(
        (column) =>
          column.table_name === "user"
          || column.table_name === "calendar_accounts"
          || column.table_name === "calendars"
          || column.table_name === "caldav_credentials"
          || column.table_name === "event_states",
      ),
      counts: {
        user: 1,
        calendar_accounts: 1,
        calendars: 1,
        caldav_credentials: 0,
        event_states: 0,
      },
      caldav: [],
      receipts: [],
    });
    const schema = await inspectSchema(client);
    expect(schema.missingOptionalTables).toContain("session");
    expect(schema.missingOptionalTables).toContain("jwks");
    const report = await runAudit(client, "other");
    expect(report.optional.session).toBe("missing");
    expect(report.optional.ical_feeds).toBe("missing");
    expect(report.optional.calendar_push_channels).toBe("missing");
    expect(report.optional.passkey).toBe("missing");
    expect(report.targetMarkerPresent).toBe(false);
  });
});
