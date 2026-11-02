# AWS target rotation CLI

Offline helper for the copied Keeper database after the Railway compromise. It re-encrypts CalDAV passwords onto a new `ENCRYPTION_KEY`, regenerates iCal feed tokens, deletes imported calendar push channels, and invalidates session, JWT, API, and locally issued OAuth material on the AWS staging copy. It does not talk to Railway, AWS APIs, or production.

This directory is the only owner of that workflow. Do not import it from app code.

The copied source had two `ical_feeds` rows and 31 `calendar_push_channels` rows. Those are rotated or deleted with the encryption-key receipt. There were no CalDAV credential rows in that copy; re-encryption still runs and is a no-op when the table is empty.

## Safety

- `DATABASE_URL` comes from the environment or `--database-url-file` (mode `0600` only). Connection strings are rejected on the command line.
- `rotate-target` requires `application_name=keeper-aws-staging` on the connection **or** `--confirm-target keeper-aws-staging`.
- Old and new encryption keys are read from mode `0600` files as base64 32-byte `tweetnacl` secretbox keys. Identical or wrong-length keys are rejected.
- Secrets, emails, tokens, passwords, and database error details are never printed.
- CalDAV ciphertext is decrypted with the old key for every row before any update. A wrong old key aborts the transaction with no partial writes. Zero CalDAV rows is valid.
- User, calendar, event, sync, iCal feed, mapping, and passkey rows are counted before and after; a count change aborts.
- A receipt keyed by key fingerprints (not the keys) makes a rerun with the same fingerprints a no-op. Different fingerprints fail closed.

This repo's `packages/database/drizzle.config.ts` does not set `casing`. Generated columns are quoted camelCase (`encryptedPassword`). The CLI inspects `information_schema` and binds to the names that actually exist, accepting snake_case if that is the live layout and refusing ambiguous or missing required columns.

## Commands

From the repository root (preferred; uses the workspace `pg` / `tweetnacl` install):

```bash
bun scripts/aws-migration/src/cli.ts audit
bun scripts/aws-migration/src/cli.ts rotate-target \
  --old-key-file /secure/old-encryption-key \
  --new-key-file /secure/new-encryption-key
```

From this directory, `bun run audit` / `bun run rotate-target` set `NODE_PATH` to the workspace `node_modules`.

Optional: `--database-url-file /secure/database-url` instead of `DATABASE_URL`, and `--confirm-target keeper-aws-staging` when the connection does not already carry that `application_name`.

Tests (run from this directory; do not pass `DATABASE_URL` into the test process):

```bash
bun run test
```

An isolated Postgres integration test runs only when `AWS_MIGRATION_TEST_DATABASE_URL` or `KEEPER_TEST_DATABASE_URL` is set. Unit tests always cover crypto, validation, receipts, and transaction rollback.

## Rotation effects

On a confirmed target, in one transaction with an advisory lock:

- Re-encrypt every `caldav_credentials` password with the existing `nonce:ciphertext` secretbox format from `packages/database/src/encryption.ts`. External CalDAV passwords themselves are unchanged and still need a user-side rotation. An empty table still records the receipt.
- Regenerate every `ical_feeds.token` with `feed_` plus 32 cryptographic random bytes as hex, matching `services/api/src/utils/ical-feed-tokens.ts`. Feed ids, settings, and `ical_feed_calendars` membership rows stay. `legacyAlias` is set to false so old `/ical/:userId` URLs are rejected.
- Delete imported `calendar_push_channels` rows (ephemeral provider registrations and `secretHash` values) so old webhook callbacks are not accepted. Calendar accounts, calendars, event mappings, source-destination mappings, and event states stay.
- Set `needsReauthentication` on credential-backed `calendar_accounts` (`authType` oauth or caldav, resolved from the live camelCase or snake_case column). Unauthenticated ICS subscriptions (`authType` none) keep their current reauth flag. When present, `oauth_credentials` are still marked.
- Replace NOT NULL provider `accessToken` / `refreshToken` values on `oauth_credentials` with empty strings.
- Preserve `account` rows (OAuth login links) but null `accessToken`, `refreshToken`, and `idToken`. Never touch `password` hashes.
- Delete `session`, `verification`, `jwks`, `oauth_access_token`, `oauth_refresh_token`, and `api_tokens` when those tables exist.
- Null imported `oauth_application.clientSecret` values and disable those client rows. Client rows are kept.
- Keep `passkey` rows. Passkey public keys are not secrets.
- Optional auth and feed tables that are absent are reported and skipped. Essential `user`, `calendar_accounts`, `calendars`, `caldav_credentials`, and `event_states` tables must exist.

`audit` prints row counts for the essential tables plus optional auth, iCal feed, push-channel, mapping, and passkey tables, and a `ical_feeds_legacy_alias` status. `rotate-target` prints the same preserved counts and the feed-token / push-channel effect counts.

## Limitations

- New iCal feed URLs replace the leaked tokens. Users must resubscribe every feed client. Legacy aliases are turned off.
- Calendar push channels must be re-registered by the running app after users reauthenticate provider accounts.
- Passkeys are not removed.
- Public MCP clients that never stored a client secret are not disabled.
- Users must reconnect Google/Outlook/CalDAV accounts after rotation.
- This tool does not copy data, provision AWS, or rotate `BETTER_AUTH_SECRET` / provider client secrets in the environment.
