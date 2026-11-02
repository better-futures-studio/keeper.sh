type QueryResultRow = Record<string, unknown>;

interface QueryResult<Row = QueryResultRow> {
  rowCount: number | null;
  rows: Row[];
}

interface QueryClient {
  query: <Row = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>;
}

interface ResolvedColumn {
  drizzleName: string;
  sqlName: string;
}

interface ResolvedTable {
  tableName: string;
  columns: Record<string, ResolvedColumn>;
  present: true;
}

interface MissingTable {
  tableName: string;
  present: false;
}

type TableResolution = ResolvedTable | MissingTable;

interface EssentialResolution {
  user: ResolvedTable;
  calendar_accounts: ResolvedTable;
  calendars: ResolvedTable;
  caldav_credentials: ResolvedTable;
  event_states: ResolvedTable;
}

interface OptionalResolution {
  oauth_credentials: TableResolution;
  account: TableResolution;
  session: TableResolution;
  verification: TableResolution;
  jwks: TableResolution;
  oauth_application: TableResolution;
  oauth_access_token: TableResolution;
  oauth_refresh_token: TableResolution;
  api_tokens: TableResolution;
  sync_status: TableResolution;
  ical_feeds: TableResolution;
  ical_feed_settings: TableResolution;
  ical_feed_calendars: TableResolution;
  calendar_push_channels: TableResolution;
  event_mappings: TableResolution;
  source_destination_mappings: TableResolution;
  passkey: TableResolution;
}

interface SchemaResolution {
  essential: EssentialResolution;
  optional: OptionalResolution;
  missingOptionalTables: string[];
}

interface KeyPair {
  oldKey: string;
  newKey: string;
  oldFingerprint: string;
  newFingerprint: string;
}

interface RotationEffects {
  caldavReencrypted: number;
  icalFeedTokensRotated: number;
  calendarPushChannelsDeleted: number;
  calendarAccountsMarkedReauth: number;
  oauthCredentialsCleared: number;
  accountProviderTokensCleared: number;
  sessionsInvalidated: number;
  verificationsInvalidated: number;
  jwksInvalidated: number;
  oauthAccessTokensInvalidated: number;
  oauthRefreshTokensInvalidated: number;
  apiTokensInvalidated: number;
  oauthClientSecretsCleared: number;
  oauthClientsDisabled: number;
}

interface PreservationCounts {
  users: number;
  calendarAccounts: number;
  calendars: number;
  eventStates: number;
  syncStatuses: number;
  icalFeeds: number;
  icalFeedSettings: number;
  icalFeedCalendars: number;
  eventMappings: number;
  sourceDestinationMappings: number;
  passkeys: number;
}

interface RotationReport {
  alreadyCompleted: boolean;
  targetConfirmedBy: "application_name" | "confirm-target";
  oldKeyFingerprint: string;
  newKeyFingerprint: string;
  effects: RotationEffects;
  missingOptionalTables: string[];
  preserved: PreservationCounts;
}

interface AuditCounts {
  user: number;
  calendar_accounts: number;
  calendars: number;
  caldav_credentials: number;
  event_states: number;
}

interface AuditOptionalCounts {
  oauth_credentials: number | "missing";
  account: number | "missing";
  session: number | "missing";
  verification: number | "missing";
  jwks: number | "missing";
  oauth_application: number | "missing";
  oauth_access_token: number | "missing";
  oauth_refresh_token: number | "missing";
  api_tokens: number | "missing";
  sync_status: number | "missing";
  ical_feeds: number | "missing";
  ical_feed_settings: number | "missing";
  ical_feed_calendars: number | "missing";
  calendar_push_channels: number | "missing";
  event_mappings: number | "missing";
  source_destination_mappings: number | "missing";
  passkey: number | "missing";
}

interface AuditReport {
  applicationName: string;
  targetMarkerPresent: boolean;
  essential: AuditCounts;
  optional: AuditOptionalCounts;
  statuses: Record<string, number>;
  missingOptionalTables: string[];
}

export type {
  AuditCounts,
  AuditOptionalCounts,
  AuditReport,
  EssentialResolution,
  KeyPair,
  MissingTable,
  OptionalResolution,
  PreservationCounts,
  QueryClient,
  QueryResult,
  QueryResultRow,
  ResolvedColumn,
  ResolvedTable,
  RotationEffects,
  RotationReport,
  SchemaResolution,
  TableResolution,
};
