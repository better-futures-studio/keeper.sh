import { encodeBase64 } from "tweetnacl-util";
import { describe, expect, it } from "bun:test";
import { encryptPassword } from "../../../packages/database/src/encryption";
import { KEY_BYTE_LENGTH, fingerprintKey } from "../src/crypto";
import { MigrationError } from "../src/errors";
import { FEED_TOKEN_PATTERN } from "../src/ical-feed-tokens";
import { rotateTarget } from "../src/rotate";
import { UNAUTHENTICATED_CALENDAR_AUTH_TYPE } from "../src/schema";
import {
  CAMEL_CASE_LAYOUT,
  SNAKE_CASE_LAYOUT,
  createMockClient,
} from "./mock-client";

const keyFromByte = (value: number): string =>
  encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(value));

const OLD_KEY = keyFromByte(21);
const NEW_KEY = keyFromByte(22);
const COUNTS = {
  user: 2,
  calendar_accounts: 2,
  calendars: 3,
  event_states: 8,
  sync_status: 3,
  caldav_credentials: 2,
  oauth_credentials: 2,
  account: 2,
  session: 4,
  verification: 1,
  jwks: 1,
  oauth_application: 1,
  oauth_access_token: 3,
  oauth_refresh_token: 2,
  api_tokens: 2,
  ical_feeds: 2,
  ical_feed_settings: 2,
  ical_feed_calendars: 3,
  calendar_push_channels: 31,
  event_mappings: 4,
  source_destination_mappings: 1,
  passkey: 2,
};

const ICAL_FEEDS = [{ id: "feed-1" }, { id: "feed-2" }];

const keys = {
  oldKey: OLD_KEY,
  newKey: NEW_KEY,
  oldFingerprint: fingerprintKey(OLD_KEY),
  newFingerprint: fingerprintKey(NEW_KEY),
};

describe("rotate-target transaction", () => {
  it("decrypts every CalDAV row before issuing updates and commits once", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: COUNTS,
      caldav: [
        { id: "row-a", ciphertext: encryptPassword("alpha", OLD_KEY) },
        { id: "row-b", ciphertext: encryptPassword("beta", OLD_KEY) },
      ],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });

    expect(report.alreadyCompleted).toBe(false);
    expect(report.effects.caldavReencrypted).toBe(2);
    expect(report.effects.icalFeedTokensRotated).toBe(2);
    expect(report.effects.calendarPushChannelsDeleted).toBe(31);
    expect(report.effects.sessionsInvalidated).toBe(4);
    expect(report.effects.apiTokensInvalidated).toBe(2);
    expect(report.effects.oauthCredentialsCleared).toBe(2);
    expect(report.effects.accountProviderTokensCleared).toBe(2);
    expect(report.effects.calendarAccountsMarkedReauth).toBe(2);
    expect(report.preserved.users).toBe(2);
    expect(report.preserved.eventStates).toBe(8);
    expect(report.preserved.icalFeeds).toBe(2);
    expect(report.preserved.icalFeedSettings).toBe(2);
    expect(report.preserved.icalFeedCalendars).toBe(3);
    expect(report.preserved.eventMappings).toBe(4);
    expect(report.preserved.sourceDestinationMappings).toBe(1);
    expect(report.preserved.passkeys).toBe(2);

    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(sql[0]).toBe("BEGIN");
    expect(sql.some((statement) => statement.includes("pg_advisory_xact_lock"))).toBe(
      true,
    );
    const firstCalDavUpdate = sql.findIndex((statement) =>
      statement.startsWith('UPDATE "caldav_credentials"'),
    );
    const calDavSelect = sql.findIndex((statement) =>
      statement.includes("AS ciphertext"),
    );
    expect(calDavSelect).toBeGreaterThan(-1);
    expect(firstCalDavUpdate).toBeGreaterThan(calDavSelect);
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.some((statement) => statement === "ROLLBACK")).toBe(false);
    expect(
      sql.some((statement) => statement.includes('"password"')),
    ).toBe(false);
    const feedUpdates = recorded.filter((entry) =>
      entry.sql.replaceAll(/\s+/g, " ").startsWith('UPDATE "ical_feeds"'),
    );
    expect(feedUpdates).toHaveLength(2);
    const mintedTokens = feedUpdates.map((entry) => String(entry.values[0] ?? ""));
    expect(new Set(mintedTokens).size).toBe(2);
    for (const token of mintedTokens) {
      expect(token).toMatch(FEED_TOKEN_PATTERN);
    }
    expect(
      sql.some((statement) => statement.includes('"legacyAlias"') && statement.includes("FALSE")),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.startsWith('DELETE FROM "calendar_push_channels"')),
    ).toBe(true);
    const calendarAccountUpdate = sql.find((statement) =>
      statement.startsWith('UPDATE "calendar_accounts"'),
    );
    expect(calendarAccountUpdate).toContain('"needsReauthentication"');
    expect(calendarAccountUpdate).toContain('"authType"');
    expect(calendarAccountUpdate).toContain("IS DISTINCT FROM");
    expect(calendarAccountUpdate).not.toContain('"auth_type"');
    const calendarAccountUpdateQuery = recorded.find((entry) =>
      entry.sql.replaceAll(/\s+/g, " ").startsWith('UPDATE "calendar_accounts"'),
    );
    expect(calendarAccountUpdateQuery?.values).toEqual([
      UNAUTHENTICATED_CALENDAR_AUTH_TYPE,
    ]);
    expect(
      sql.some(
        (statement) =>
          statement.includes('"passkey"')
          && (statement.startsWith("UPDATE") || statement.startsWith("DELETE")),
      ),
    ).toBe(false);
    expect(
      sql.some(
        (statement) =>
          statement.includes('"ical_feed_settings"')
          && (statement.startsWith("UPDATE") || statement.startsWith("DELETE")),
      ),
    ).toBe(false);
    expect(
      sql.some(
        (statement) =>
          statement.includes('"ical_feed_calendars"')
          && (statement.startsWith("UPDATE") || statement.startsWith("DELETE")),
      ),
    ).toBe(false);
    expect(
      sql.some(
        (statement) =>
          statement.includes('"event_mappings"')
          && (statement.startsWith("UPDATE") || statement.startsWith("DELETE")),
      ),
    ).toBe(false);
  });

  it("rolls back with no CalDAV updates when the old key is wrong", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: COUNTS,
      caldav: [
        { id: "row-a", ciphertext: encryptPassword("alpha", NEW_KEY) },
      ],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    await expect(
      rotateTarget(client, { keys, targetConfirmedBy: "application_name" }),
    ).rejects.toThrow(MigrationError);

    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(sql.some((statement) => statement.startsWith("UPDATE"))).toBe(false);
    expect(sql.at(-1)).toBe("ROLLBACK");
    expect(sql.some((statement) => statement === "COMMIT")).toBe(false);
  });

  it("replays a matching receipt without mutating CalDAV rows", async () => {
    const ciphertext = encryptPassword("alpha", NEW_KEY);
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: COUNTS,
      caldav: [{ id: "row-a", ciphertext }],
      icalFeeds: ICAL_FEEDS,
      receipts: [
        {
          old_key_fingerprint: keys.oldFingerprint,
          new_key_fingerprint: keys.newFingerprint,
        },
      ],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });
    expect(report.alreadyCompleted).toBe(true);
    expect(report.effects.caldavReencrypted).toBe(0);
    expect(report.effects.icalFeedTokensRotated).toBe(0);
    expect(report.effects.calendarPushChannelsDeleted).toBe(0);
    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(sql.some((statement) => statement.startsWith("UPDATE"))).toBe(false);
    expect(sql.some((statement) => statement.startsWith("DELETE"))).toBe(false);
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("fails closed when a receipt exists for different fingerprints", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: COUNTS,
      caldav: [],
      receipts: [
        {
          old_key_fingerprint: "sha256:other-old",
          new_key_fingerprint: "sha256:other-new",
        },
      ],
    });

    await expect(
      rotateTarget(client, { keys, targetConfirmedBy: "confirm-target" }),
    ).rejects.toThrow(/different key fingerprints/);
    expect(recorded.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("binds snake_case columns when that is the live layout", async () => {
    const { client, recorded } = createMockClient({
      columns: SNAKE_CASE_LAYOUT,
      counts: COUNTS,
      caldav: [{ id: "row-a", ciphertext: encryptPassword("alpha", OLD_KEY) }],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    await rotateTarget(client, { keys, targetConfirmedBy: "confirm-target" });
    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(
      sql.some((statement) => statement.includes('"encrypted_password"')),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.includes('"needs_reauthentication"')),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.includes('"auth_type"')),
    ).toBe(true);
    expect(
      sql.some(
        (statement) =>
          statement.startsWith('UPDATE "calendar_accounts"')
          && statement.includes('"auth_type"')
          && statement.includes("IS DISTINCT FROM"),
      ),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.includes('"access_token"')),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.includes('"legacy_alias"')),
    ).toBe(true);
  });

  it("rotates iCal feeds and deletes push channels when CalDAV has zero rows", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: { ...COUNTS, caldav_credentials: 0 },
      caldav: [],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });
    expect(report.alreadyCompleted).toBe(false);
    expect(report.effects.caldavReencrypted).toBe(0);
    expect(report.effects.icalFeedTokensRotated).toBe(2);
    expect(report.effects.calendarPushChannelsDeleted).toBe(31);
    expect(report.preserved.passkeys).toBe(2);
    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.some((statement) => statement.startsWith('UPDATE "ical_feeds"'))).toBe(
      true,
    );
  });

  it("skips missing iCal feed and push channel tables", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT.filter(
        (column) =>
          column.table_name !== "ical_feeds"
          && column.table_name !== "calendar_push_channels",
      ),
      counts: COUNTS,
      caldav: [{ id: "row-a", ciphertext: encryptPassword("alpha", OLD_KEY) }],
      receipts: [],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });
    expect(report.effects.icalFeedTokensRotated).toBe(0);
    expect(report.effects.calendarPushChannelsDeleted).toBe(0);
    expect(report.missingOptionalTables).toEqual(
      expect.arrayContaining(["ical_feeds", "calendar_push_channels"]),
    );
    const sql = recorded.map((entry) => entry.sql.replaceAll(/\s+/g, " "));
    expect(sql.some((statement) => statement.includes('"ical_feeds"') && statement.startsWith("UPDATE"))).toBe(false);
    expect(sql.some((statement) => statement.includes("calendar_push_channels"))).toBe(
      false,
    );
  });

  it("marks oauth and caldav accounts for reauth and leaves ICS none subscriptions", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: { ...COUNTS, calendar_accounts: 3 },
      calendarAccounts: [
        { id: "oauth-1", authType: "oauth" },
        { id: "caldav-1", authType: "caldav" },
        { id: "ics-1", authType: UNAUTHENTICATED_CALENDAR_AUTH_TYPE },
      ],
      caldav: [{ id: "row-a", ciphertext: encryptPassword("alpha", OLD_KEY) }],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });
    expect(report.effects.calendarAccountsMarkedReauth).toBe(2);
    expect(report.preserved.calendarAccounts).toBe(3);
    const calendarAccountUpdate = recorded.find((entry) =>
      entry.sql.replaceAll(/\s+/g, " ").startsWith('UPDATE "calendar_accounts"'),
    );
    const sql = calendarAccountUpdate?.sql.replaceAll(/\s+/g, " ") ?? "";
    expect(sql).toContain('"authType" IS DISTINCT FROM');
    expect(sql).toContain("WHERE");
    expect(calendarAccountUpdate?.values).toEqual([
      UNAUTHENTICATED_CALENDAR_AUTH_TYPE,
    ]);
  });

  it("does not mark ICS none accounts when they are the only calendar accounts", async () => {
    const { client, recorded } = createMockClient({
      columns: CAMEL_CASE_LAYOUT,
      counts: { ...COUNTS, calendar_accounts: 2 },
      calendarAccounts: [
        { id: "ics-1", authType: UNAUTHENTICATED_CALENDAR_AUTH_TYPE },
        { id: "ics-2", authType: UNAUTHENTICATED_CALENDAR_AUTH_TYPE },
      ],
      caldav: [{ id: "row-a", ciphertext: encryptPassword("alpha", OLD_KEY) }],
      icalFeeds: ICAL_FEEDS,
      receipts: [],
    });

    const report = await rotateTarget(client, {
      keys,
      targetConfirmedBy: "confirm-target",
    });
    expect(report.effects.calendarAccountsMarkedReauth).toBe(0);
    expect(report.preserved.calendarAccounts).toBe(2);
    expect(report.effects.oauthCredentialsCleared).toBe(2);
    expect(report.effects.sessionsInvalidated).toBe(4);
    const calendarAccountUpdate = recorded.find((entry) =>
      entry.sql.replaceAll(/\s+/g, " ").startsWith('UPDATE "calendar_accounts"'),
    );
    expect(calendarAccountUpdate?.values).toEqual([
      UNAUTHENTICATED_CALENDAR_AUTH_TYPE,
    ]);
  });
});
