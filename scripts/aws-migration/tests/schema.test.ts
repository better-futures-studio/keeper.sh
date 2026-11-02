import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthRefreshToken,
  passkey,
  session,
  user,
  verification,
} from "../../../packages/database/src/database/auth-schema";
import {
  apiTokensTable,
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarPushChannelsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  icalFeedCalendarsTable,
  icalFeedSettingsTable,
  icalFeedsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "../../../packages/database/src/database/schema";
import {
  ESSENTIAL_TABLES,
  OPTIONAL_TABLES,
  UNAUTHENTICATED_CALENDAR_AUTH_TYPE,
  resolveColumnName,
} from "../src/schema";
import { MigrationError } from "../src/errors";
import { toSnakeCase } from "../src/sql";

describe("schema inventory", () => {
  it("tracks essential tables from schema.ts", () => {
    expect(getTableName(user)).toBe("user");
    expect(getTableName(calendarAccountsTable)).toBe("calendar_accounts");
    expect(getTableName(calendarsTable)).toBe("calendars");
    expect(getTableName(caldavCredentialsTable)).toBe("caldav_credentials");
    expect(getTableName(eventStatesTable)).toBe("event_states");
    expect(Object.keys(getTableColumns(caldavCredentialsTable))).toEqual(
      expect.arrayContaining([...ESSENTIAL_TABLES.caldav_credentials]),
    );
    expect(ESSENTIAL_TABLES.calendar_accounts).toContain("authType");
    expect(Object.keys(getTableColumns(calendarAccountsTable))).toEqual(
      expect.arrayContaining([...ESSENTIAL_TABLES.calendar_accounts]),
    );
    expect(getTableColumns(calendarAccountsTable).authType).toBeDefined();
    expect(UNAUTHENTICATED_CALENDAR_AUTH_TYPE).toBe("none");
  });

  it("tracks optional auth, feed, mapping, and passkey tables", () => {
    expect(getTableName(session)).toBe("session");
    expect(getTableName(account)).toBe("account");
    expect(getTableName(verification)).toBe("verification");
    expect(getTableName(jwks)).toBe("jwks");
    expect(getTableName(oauthClient)).toBe("oauth_application");
    expect(getTableName(oauthAccessToken)).toBe("oauth_access_token");
    expect(getTableName(oauthRefreshToken)).toBe("oauth_refresh_token");
    expect(Object.keys(getTableColumns(oauthCredentialsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.oauth_credentials]),
    );
    expect(Object.keys(getTableColumns(apiTokensTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.api_tokens]),
    );
    expect(Object.keys(getTableColumns(account))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.account]),
    );
    expect(Object.keys(getTableColumns(jwks))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.jwks]),
    );
    expect(getTableName(icalFeedsTable)).toBe("ical_feeds");
    expect(getTableName(icalFeedSettingsTable)).toBe("ical_feed_settings");
    expect(getTableName(icalFeedCalendarsTable)).toBe("ical_feed_calendars");
    expect(getTableName(calendarPushChannelsTable)).toBe("calendar_push_channels");
    expect(getTableName(eventMappingsTable)).toBe("event_mappings");
    expect(getTableName(sourceDestinationMappingsTable)).toBe(
      "source_destination_mappings",
    );
    expect(getTableName(passkey)).toBe("passkey");
    expect(Object.keys(getTableColumns(icalFeedsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.ical_feeds]),
    );
    expect(Object.keys(getTableColumns(icalFeedSettingsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.ical_feed_settings]),
    );
    expect(Object.keys(getTableColumns(icalFeedCalendarsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.ical_feed_calendars]),
    );
    expect(Object.keys(getTableColumns(calendarPushChannelsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.calendar_push_channels]),
    );
    expect(Object.keys(getTableColumns(eventMappingsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.event_mappings]),
    );
    expect(Object.keys(getTableColumns(sourceDestinationMappingsTable))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.source_destination_mappings]),
    );
    expect(Object.keys(getTableColumns(passkey))).toEqual(
      expect.arrayContaining([...OPTIONAL_TABLES.passkey]),
    );
  });
});

describe("column layout binding", () => {
  it("uses snake_case when that is the live layout", () => {
    expect(
      resolveColumnName(
        "caldav_credentials",
        "encryptedPassword",
        new Set(["encrypted_password"]),
      ),
    ).toBe("encrypted_password");
    expect(toSnakeCase("authType")).toBe("auth_type");
    expect(toSnakeCase("needsReauthentication")).toBe("needs_reauthentication");
    expect(
      resolveColumnName("calendar_accounts", "authType", new Set(["auth_type"])),
    ).toBe("auth_type");
    expect(
      resolveColumnName("calendar_accounts", "authType", new Set(["authType"])),
    ).toBe("authType");
    expect(toSnakeCase("legacyAlias")).toBe("legacy_alias");
    expect(toSnakeCase("secretHash")).toBe("secret_hash");
  });

  it("uses the Drizzle camelCase name when that is the live layout", () => {
    expect(
      resolveColumnName(
        "caldav_credentials",
        "encryptedPassword",
        new Set(["encryptedPassword"]),
      ),
    ).toBe("encryptedPassword");
  });

  it("fails closed on missing or ambiguous layouts", () => {
    expect(() =>
      resolveColumnName("caldav_credentials", "encryptedPassword", new Set()),
    ).toThrow(MigrationError);
    expect(() =>
      resolveColumnName(
        "caldav_credentials",
        "encryptedPassword",
        new Set(["encryptedPassword", "encrypted_password"]),
      ),
    ).toThrow(/Ambiguous/);
  });
});
