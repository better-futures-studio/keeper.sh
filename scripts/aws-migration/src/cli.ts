import {
  applicationNameFromUrl,
  confirmRotationTarget,
  loadKeyPair,
  parseArgs,
  resolveDatabaseUrl,
  TARGET_MARKER,
} from "./config";
import { publicErrorMessage } from "./errors";
import { runAudit } from "./audit";
import {
  closeDatabase,
  connectDatabase,
  readApplicationName,
  TOOL_APPLICATION_NAME,
} from "./postgres";
import { rotateTarget } from "./rotate";
import type { AuditReport, RotationReport } from "./types";

const writeLines = (lines: string[]): void => {
  process.stdout.write(`${lines.join("\n")}\n`);
};

const formatOptionalCount = (value: number | "missing"): string => {
  if (value === "missing") {
    return "missing";
  }
  return String(value);
};

const markerLabel = (present: boolean): string => {
  if (present) {
    return "present";
  }
  return "absent";
};

const missingTablesLine = (tables: string[]): string => {
  if (tables.length === 0) {
    return "Optional tables missing: none";
  }
  return `Optional tables missing: ${tables.join(", ")}`;
};

const rotationHeadline = (alreadyCompleted: boolean): string => {
  if (alreadyCompleted) {
    return "Keeper AWS target rotation already completed for these key fingerprints";
  }
  return "Keeper AWS target rotation completed";
};

const unsetApplicationName = (applicationName: string): string => {
  if (applicationName) {
    return applicationName;
  }
  return "(unset)";
};

const printAudit = (report: AuditReport): void => {
  writeLines([
    "Keeper AWS migration audit",
    `application_name: ${unsetApplicationName(report.applicationName)}`,
    `target marker ${TARGET_MARKER}: ${markerLabel(report.targetMarkerPresent)}`,
    "",
    "Essential counts",
    `  user: ${report.essential.user}`,
    `  calendar_accounts: ${report.essential.calendar_accounts}`,
    `  calendars: ${report.essential.calendars}`,
    `  caldav_credentials: ${report.essential.caldav_credentials}`,
    `  event_states: ${report.essential.event_states}`,
    "",
    "Optional counts",
    `  oauth_credentials: ${formatOptionalCount(report.optional.oauth_credentials)}`,
    `  account: ${formatOptionalCount(report.optional.account)}`,
    `  session: ${formatOptionalCount(report.optional.session)}`,
    `  verification: ${formatOptionalCount(report.optional.verification)}`,
    `  jwks: ${formatOptionalCount(report.optional.jwks)}`,
    `  oauth_application: ${formatOptionalCount(report.optional.oauth_application)}`,
    `  oauth_access_token: ${formatOptionalCount(report.optional.oauth_access_token)}`,
    `  oauth_refresh_token: ${formatOptionalCount(report.optional.oauth_refresh_token)}`,
    `  api_tokens: ${formatOptionalCount(report.optional.api_tokens)}`,
    `  sync_status: ${formatOptionalCount(report.optional.sync_status)}`,
    `  ical_feeds: ${formatOptionalCount(report.optional.ical_feeds)}`,
    `  ical_feed_settings: ${formatOptionalCount(report.optional.ical_feed_settings)}`,
    `  ical_feed_calendars: ${formatOptionalCount(report.optional.ical_feed_calendars)}`,
    `  calendar_push_channels: ${formatOptionalCount(report.optional.calendar_push_channels)}`,
    `  event_mappings: ${formatOptionalCount(report.optional.event_mappings)}`,
    `  source_destination_mappings: ${formatOptionalCount(report.optional.source_destination_mappings)}`,
    `  passkey: ${formatOptionalCount(report.optional.passkey)}`,
    "",
    "Statuses",
    ...Object.entries(report.statuses).map(
      ([name, count]) => `  ${name}: ${count}`,
    ),
    "",
    missingTablesLine(report.missingOptionalTables),
  ]);
};

const printRotation = (report: RotationReport): void => {
  writeLines([
    rotationHeadline(report.alreadyCompleted),
    `confirmed by: ${report.targetConfirmedBy}`,
    `old key fingerprint: ${report.oldKeyFingerprint}`,
    `new key fingerprint: ${report.newKeyFingerprint}`,
    "",
    "Effects",
    `  caldav_credentials re-encrypted: ${report.effects.caldavReencrypted}`,
    `  ical_feeds tokens rotated: ${report.effects.icalFeedTokensRotated}`,
    `  calendar_push_channels deleted: ${report.effects.calendarPushChannelsDeleted}`,
    `  calendar_accounts marked needs_reauthentication: ${report.effects.calendarAccountsMarkedReauth}`,
    `  oauth_credentials provider tokens cleared: ${report.effects.oauthCredentialsCleared}`,
    `  account provider tokens cleared: ${report.effects.accountProviderTokensCleared}`,
    `  sessions invalidated: ${report.effects.sessionsInvalidated}`,
    `  verifications invalidated: ${report.effects.verificationsInvalidated}`,
    `  jwks rows invalidated: ${report.effects.jwksInvalidated}`,
    `  oauth access tokens invalidated: ${report.effects.oauthAccessTokensInvalidated}`,
    `  oauth refresh tokens invalidated: ${report.effects.oauthRefreshTokensInvalidated}`,
    `  api tokens invalidated: ${report.effects.apiTokensInvalidated}`,
    `  oauth client secrets cleared: ${report.effects.oauthClientSecretsCleared}`,
    `  oauth clients disabled: ${report.effects.oauthClientsDisabled}`,
    "",
    "Preserved row counts",
    `  user: ${report.preserved.users}`,
    `  calendar_accounts: ${report.preserved.calendarAccounts}`,
    `  calendars: ${report.preserved.calendars}`,
    `  event_states: ${report.preserved.eventStates}`,
    `  sync_status: ${report.preserved.syncStatuses}`,
    `  ical_feeds: ${report.preserved.icalFeeds}`,
    `  ical_feed_settings: ${report.preserved.icalFeedSettings}`,
    `  ical_feed_calendars: ${report.preserved.icalFeedCalendars}`,
    `  event_mappings: ${report.preserved.eventMappings}`,
    `  source_destination_mappings: ${report.preserved.sourceDestinationMappings}`,
    `  passkey: ${report.preserved.passkeys}`,
    "",
    missingTablesLine(report.missingOptionalTables),
    "",
    "CalDAV passwords were re-encrypted; users must still rotate the external CalDAV password itself.",
    "Provider OAuth links were preserved; users must reauthenticate those accounts.",
    "iCal feed URLs changed; subscribers must resubscribe. Legacy feed aliases are rejected.",
    "Calendar push channels were deleted so old provider callbacks are not accepted.",
    "Passkeys were kept; public keys are not secrets.",
  ]);
};

const resolveApplicationName = async (
  databaseUrl: string,
  queries: Awaited<ReturnType<typeof connectDatabase>>["queries"],
): Promise<string> => {
  const fromUrl = applicationNameFromUrl(databaseUrl);
  const fromSession = await readApplicationName(queries);
  if (fromUrl && fromUrl.length > 0) {
    return fromUrl;
  }
  return fromSession;
};

const run = async (
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> => {
  const args = parseArgs(argv);
  const databaseUrl = await resolveDatabaseUrl(env, args.databaseUrlFile);
  const { client, queries } = await connectDatabase(databaseUrl);
  try {
    const applicationName = await resolveApplicationName(databaseUrl, queries);
    await queries.query("SELECT set_config('application_name', $1, false)", [
      TOOL_APPLICATION_NAME,
    ]);
    if (args.command === "audit") {
      printAudit(await runAudit(queries, applicationName));
      return 0;
    }
    const targetConfirmedBy = confirmRotationTarget(
      applicationName,
      args.confirmTarget,
    );
    const keys = await loadKeyPair(args.oldKeyFile, args.newKeyFile);
    printRotation(
      await rotateTarget(queries, {
        keys,
        targetConfirmedBy,
      }),
    );
    return 0;
  } finally {
    await closeDatabase(client);
  }
};

const main = async (): Promise<void> => {
  const exitCode = await run(process.argv.slice(2), process.env);
  process.exitCode = exitCode;
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${publicErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export { run };
