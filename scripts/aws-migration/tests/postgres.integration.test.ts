import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { encodeBase64 } from "tweetnacl-util";
import { describe, expect, it } from "bun:test";
import { encryptPassword } from "../../../packages/database/src/encryption";
import {
  KEY_BYTE_LENGTH,
  decryptCalDavPassword,
  fingerprintKey,
} from "../src/crypto";
import { FEED_TOKEN_PATTERN } from "../src/ical-feed-tokens";
import { wrapQueryClient } from "../src/postgres";
import { rotateTarget } from "../src/rotate";

const TEST_DATABASE_URL =
  process.env.AWS_MIGRATION_TEST_DATABASE_URL
  ?? process.env.KEEPER_TEST_DATABASE_URL;

const oldKey = encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(41));
const newKey = encodeBase64(new Uint8Array(KEY_BYTE_LENGTH).fill(42));

const rotationKeys = {
  oldKey,
  newKey,
  oldFingerprint: fingerprintKey(oldKey),
  newFingerprint: fingerprintKey(newKey),
};

interface FixtureIds {
  userId: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  feedIds: string[];
  membershipId: string;
  mappingId: string;
  sourceMappingId: string;
  passkeyId: string;
}

const createIsolatedUrl = async (adminUrl: string): Promise<string> => {
  const name = `aws_mig_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  parsed.searchParams.set("application_name", "keeper-aws-staging");
  return parsed.toString();
};

const dropIsolatedDatabase = async (
  adminUrl: string,
  isolatedUrl: string,
): Promise<void> => {
  const name = new URL(isolatedUrl).pathname.slice(1);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
};

const applySharedSchema = async (client: Client): Promise<FixtureIds> => {
  await client.query(`
    CREATE TABLE "user" (id text PRIMARY KEY);
    CREATE TABLE calendar_accounts (
      id uuid PRIMARY KEY,
      "needsReauthentication" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE calendars (id uuid PRIMARY KEY);
    CREATE TABLE event_states (id uuid PRIMARY KEY);
    CREATE TABLE caldav_credentials (
      id uuid PRIMARY KEY,
      "encryptedPassword" text NOT NULL
    );
    CREATE TABLE oauth_credentials (
      id uuid PRIMARY KEY,
      "accessToken" text NOT NULL,
      "refreshToken" text NOT NULL,
      "needsReauthentication" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE account (
      id text PRIMARY KEY,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      password text
    );
    CREATE TABLE session (id text PRIMARY KEY);
    CREATE TABLE api_tokens (id uuid PRIMARY KEY);
    CREATE TABLE ical_feeds (
      id uuid PRIMARY KEY,
      "userId" text NOT NULL,
      name text NOT NULL,
      token text NOT NULL UNIQUE,
      "isDefault" boolean NOT NULL DEFAULT false,
      "legacyAlias" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE ical_feed_settings (
      "userId" text PRIMARY KEY
    );
    CREATE TABLE ical_feed_calendars (
      id uuid PRIMARY KEY,
      "feedId" uuid NOT NULL,
      "calendarId" uuid NOT NULL
    );
    CREATE TABLE calendar_push_channels (
      id uuid PRIMARY KEY,
      "secretHash" text NOT NULL,
      "providerChannelId" text
    );
    CREATE TABLE event_mappings (
      id uuid PRIMARY KEY,
      "calendarId" uuid NOT NULL,
      "destinationEventUid" text NOT NULL,
      "startTime" timestamptz NOT NULL,
      "endTime" timestamptz NOT NULL,
      "eventStateId" uuid
    );
    CREATE TABLE source_destination_mappings (
      id uuid PRIMARY KEY,
      "sourceCalendarId" uuid NOT NULL,
      "destinationCalendarId" uuid NOT NULL
    );
    CREATE TABLE passkey (
      id text PRIMARY KEY,
      "publicKey" text NOT NULL,
      "userId" text NOT NULL
    );
  `);

  const userId = "user-1";
  const accountId = randomUUID();
  const calendarId = randomUUID();
  const eventId = randomUUID();
  const feedIds = [randomUUID(), randomUUID()];
  const [feedId, secondFeedId] = feedIds;
  const membershipId = randomUUID();
  const mappingId = randomUUID();
  const sourceMappingId = randomUUID();
  const passkeyId = "passkey-1";
  if (!feedId || !secondFeedId) {
    throw new Error("failed to allocate feed ids");
  }

  await client.query(`INSERT INTO "user" (id) VALUES ($1)`, [userId]);
  await client.query(
    `INSERT INTO calendar_accounts (id) VALUES ($1)`,
    [accountId],
  );
  await client.query(`INSERT INTO calendars (id) VALUES ($1)`, [calendarId]);
  await client.query(`INSERT INTO event_states (id) VALUES ($1)`, [eventId]);
  await client.query(
    `INSERT INTO oauth_credentials (id, "accessToken", "refreshToken")
     VALUES ($1, $2, $3)`,
    [randomUUID(), "a", "b"],
  );
  await client.query(
    `INSERT INTO account (id, "accessToken", "refreshToken", "idToken", password)
     VALUES ('acct-1', 'a', 'b', 'c', 'h')`,
  );
  await client.query(`INSERT INTO session (id) VALUES ('session-1')`);
  await client.query(`INSERT INTO api_tokens (id) VALUES ($1)`, [randomUUID()]);
  await client.query(
    `INSERT INTO ical_feeds (id, "userId", name, token, "isDefault", "legacyAlias")
     VALUES
       ($1, $3, 'Default', 'old-feed-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true, true),
       ($2, $3, 'Work', 'old-feed-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', false, false)`,
    [feedId, secondFeedId, userId],
  );
  await client.query(
    `INSERT INTO ical_feed_settings ("userId") VALUES ($1)`,
    [userId],
  );
  await client.query(
    `INSERT INTO ical_feed_calendars (id, "feedId", "calendarId") VALUES ($1, $2, $3)`,
    [membershipId, feedId, calendarId],
  );
  await client.query(
    `INSERT INTO calendar_push_channels (id, "secretHash", "providerChannelId")
     VALUES ($1, $2, $3), ($4, $5, $6)`,
    [
      randomUUID(),
      "hash-1",
      "provider-channel-1",
      randomUUID(),
      "hash-2",
      "provider-channel-2",
    ],
  );
  await client.query(
    `INSERT INTO event_mappings
      (id, "calendarId", "destinationEventUid", "startTime", "endTime", "eventStateId")
     VALUES ($1, $2, 'uid-1', now(), now(), $3)`,
    [mappingId, calendarId, eventId],
  );
  await client.query(
    `INSERT INTO source_destination_mappings
      (id, "sourceCalendarId", "destinationCalendarId")
     VALUES ($1, $2, $2)`,
    [sourceMappingId, calendarId],
  );
  await client.query(
    `INSERT INTO passkey (id, "publicKey", "userId") VALUES ($1, $2, $3)`,
    [passkeyId, "passkey-public-key", userId],
  );

  return {
    userId,
    accountId,
    calendarId,
    eventId,
    feedIds: [feedId, secondFeedId],
    membershipId,
    mappingId,
    sourceMappingId,
    passkeyId,
  };
};

const readFeedSnapshot = async (client: Client) => {
  const feeds = await client.query<{
    id: string;
    name: string;
    token: string;
    legacyAlias: boolean;
    userId: string;
  }>(
    `SELECT id::text AS id, name, token, "legacyAlias" AS "legacyAlias", "userId" AS "userId"
     FROM ical_feeds
     ORDER BY id`,
  );
  const memberships = await client.query<{ id: string; feedId: string }>(
    `SELECT id::text AS id, "feedId"::text AS "feedId" FROM ical_feed_calendars`,
  );
  const settings = await client.query<{ userId: string }>(
    `SELECT "userId" AS "userId" FROM ical_feed_settings`,
  );
  const mappings = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM event_mappings`,
  );
  const sourceMappings = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM source_destination_mappings`,
  );
  const passkeys = await client.query<{ id: string; publicKey: string }>(
    `SELECT id, "publicKey" AS "publicKey" FROM passkey`,
  );
  const pushChannels = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM calendar_push_channels`,
  );
  return {
    feeds: feeds.rows,
    memberships: memberships.rows,
    settings: settings.rows,
    mappings: mappings.rows,
    sourceMappings: sourceMappings.rows,
    passkeys: passkeys.rows,
    pushChannelCount: pushChannels.rows[0]?.count ?? 0,
  };
};

const assertFeedsRotated = (
  before: Awaited<ReturnType<typeof readFeedSnapshot>>,
  after: Awaited<ReturnType<typeof readFeedSnapshot>>,
): void => {
  expect(after.feeds).toHaveLength(before.feeds.length);
  expect(after.feeds.map((row) => row.id)).toEqual(before.feeds.map((row) => row.id));
  expect(after.feeds.map((row) => row.name)).toEqual(before.feeds.map((row) => row.name));
  expect(after.feeds.map((row) => row.userId)).toEqual(
    before.feeds.map((row) => row.userId),
  );
  const tokens = after.feeds.map((row) => row.token);
  expect(new Set(tokens).size).toBe(tokens.length);
  for (const [index, feed] of after.feeds.entries()) {
    expect(feed.token).toMatch(FEED_TOKEN_PATTERN);
    expect(feed.token).not.toBe(before.feeds[index]?.token);
    expect(feed.legacyAlias).toBe(false);
  }
  expect(after.memberships).toEqual(before.memberships);
  expect(after.settings).toEqual(before.settings);
  expect(after.mappings).toEqual(before.mappings);
  expect(after.sourceMappings).toEqual(before.sourceMappings);
  expect(after.passkeys).toEqual(before.passkeys);
  expect(after.pushChannelCount).toBe(0);
};

describe.skipIf(!TEST_DATABASE_URL)("isolated Postgres rotation", () => {
  it("re-encrypts CalDAV rows and rotates iCal feeds without touching preserved rows", async () => {
    const adminUrl = TEST_DATABASE_URL as string;
    const isolatedUrl = await createIsolatedUrl(adminUrl);
    const client = new Client({ connectionString: isolatedUrl });
    await client.connect();
    try {
      const ids = await applySharedSchema(client);
      await client.query(
        `INSERT INTO caldav_credentials (id, "encryptedPassword") VALUES ($1, $2)`,
        [randomUUID(), encryptPassword("alpha", oldKey)],
      );
      const before = await readFeedSnapshot(client);

      const report = await rotateTarget(wrapQueryClient(client), {
        keys: rotationKeys,
        targetConfirmedBy: "application_name",
      });
      expect(report.alreadyCompleted).toBe(false);
      expect(report.effects.caldavReencrypted).toBe(1);
      expect(report.effects.icalFeedTokensRotated).toBe(2);
      expect(report.effects.calendarPushChannelsDeleted).toBe(2);
      expect(report.effects.sessionsInvalidated).toBe(1);
      expect(report.effects.apiTokensInvalidated).toBe(1);
      expect(report.preserved.users).toBe(1);
      expect(report.preserved.calendarAccounts).toBe(1);
      expect(report.preserved.calendars).toBe(1);
      expect(report.preserved.eventStates).toBe(1);
      expect(report.preserved.icalFeeds).toBe(2);
      expect(report.preserved.icalFeedSettings).toBe(1);
      expect(report.preserved.icalFeedCalendars).toBe(1);
      expect(report.preserved.eventMappings).toBe(1);
      expect(report.preserved.sourceDestinationMappings).toBe(1);
      expect(report.preserved.passkeys).toBe(1);

      const caldav = await client.query<{ ciphertext: string }>(
        `SELECT "encryptedPassword" AS ciphertext FROM caldav_credentials`,
      );
      const ciphertext = caldav.rows[0]?.ciphertext ?? "";
      expect(decryptCalDavPassword(ciphertext, newKey)).toBe("alpha");

      const oauth = await client.query<{
        access: string;
        refresh: string;
        reauth: boolean;
      }>(
        `SELECT "accessToken" AS access, "refreshToken" AS refresh,
                "needsReauthentication" AS reauth
         FROM oauth_credentials`,
      );
      expect(oauth.rows[0]).toEqual({
        access: "",
        refresh: "",
        reauth: true,
      });

      const accountRow = await client.query<{
        access: string | null;
        password: string | null;
      }>(
        `SELECT "accessToken" AS access, password FROM account`,
      );
      expect(accountRow.rows[0]?.access).toBeNull();
      expect(accountRow.rows[0]?.password).toBe("h");

      const sessions = await client.query(`SELECT count(*)::int AS count FROM session`);
      expect(sessions.rows[0]?.count).toBe(0);

      const after = await readFeedSnapshot(client);
      assertFeedsRotated(before, after);
      const [defaultFeedId] = ids.feedIds;
      if (!defaultFeedId) {
        throw new Error("expected a default iCal feed id");
      }
      expect(after.feeds.map((row) => row.id).toSorted()).toEqual(
        ids.feedIds.toSorted(),
      );
      expect(after.memberships).toEqual([
        { id: ids.membershipId, feedId: defaultFeedId },
      ]);
      expect(after.mappings).toEqual([{ id: ids.mappingId }]);
      expect(after.sourceMappings).toEqual([{ id: ids.sourceMappingId }]);
      expect(after.settings).toEqual([{ userId: ids.userId }]);
      expect(after.passkeys).toEqual([
        { id: ids.passkeyId, publicKey: "passkey-public-key" },
      ]);

      const replay = await rotateTarget(wrapQueryClient(client), {
        keys: rotationKeys,
        targetConfirmedBy: "application_name",
      });
      expect(replay.alreadyCompleted).toBe(true);
      expect(replay.effects.icalFeedTokensRotated).toBe(0);
      expect(replay.effects.calendarPushChannelsDeleted).toBe(0);
      const replayed = await readFeedSnapshot(client);
      expect(replayed.feeds.map((row) => row.token)).toEqual(
        after.feeds.map((row) => row.token),
      );
      expect(replayed.feeds.every((row) => row.legacyAlias === false)).toBe(true);
      expect(replayed.pushChannelCount).toBe(0);
      expect(replayed.passkeys).toEqual(after.passkeys);
    } finally {
      await client.end();
      await dropIsolatedDatabase(adminUrl, isolatedUrl);
    }
  });

  it("records a receipt with zero CalDAV rows and still rotates feed tokens", async () => {
    const adminUrl = TEST_DATABASE_URL as string;
    const isolatedUrl = await createIsolatedUrl(adminUrl);
    const client = new Client({ connectionString: isolatedUrl });
    await client.connect();
    try {
      await applySharedSchema(client);
      const before = await readFeedSnapshot(client);
      const report = await rotateTarget(wrapQueryClient(client), {
        keys: rotationKeys,
        targetConfirmedBy: "application_name",
      });
      expect(report.alreadyCompleted).toBe(false);
      expect(report.effects.caldavReencrypted).toBe(0);
      expect(report.effects.icalFeedTokensRotated).toBe(2);
      expect(report.effects.calendarPushChannelsDeleted).toBe(2);
      const after = await readFeedSnapshot(client);
      assertFeedsRotated(before, after);

      const replay = await rotateTarget(wrapQueryClient(client), {
        keys: rotationKeys,
        targetConfirmedBy: "application_name",
      });
      expect(replay.alreadyCompleted).toBe(true);
      expect(replay.effects.caldavReencrypted).toBe(0);
      const replayed = await readFeedSnapshot(client);
      expect(replayed.feeds.map((row) => row.token)).toEqual(
        after.feeds.map((row) => row.token),
      );
    } finally {
      await client.end();
      await dropIsolatedDatabase(adminUrl, isolatedUrl);
    }
  });
});
