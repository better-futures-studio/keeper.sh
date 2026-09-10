import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "../../../src/types/api";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.setup";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.$calendarId";

const ACCOUNT_ID = "account-1";
const CALENDAR_ID = "calendar-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { setupCaptured, calendarCaptured } = vi.hoisted(() => ({
  setupCaptured: { component: null } as CapturedRoute,
  calendarCaptured: { component: null } as CapturedRoute,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (id: string) => (options: { component: () => React.ReactElement }) => {
    if (id.includes("setup")) {
      setupCaptured.component = options.component;
    } else {
      calendarCaptured.component = options.component;
    }
    return {
      useParams: () =>
        id.includes("setup") ? { accountId: ACCOUNT_ID } : { accountId: ACCOUNT_ID, calendarId: CALENDAR_ID },
      useSearch: () => ({ step: "destinations", id: "calendar-1,calendar-2,calendar-3", index: 0 }),
    };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => null,
  useCanGoBack: () => false,
  useRouter: () => ({ history: { back: () => null } }),
}));

function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "calendar-1",
    name: "Calendar",
    calendarType: "google",
    capabilities: ["pull", "push"],
    accountId: ACCOUNT_ID,
    provider: "google",
    providerName: "Google",
    providerIcon: null,
    displayName: null,
    email: null,
    accountLabel: "Google",
    accountIdentifier: null,
    needsReauthentication: false,
    includeInIcalFeed: false,
    unavailableSince: null,
    disabled: false,
    providerMissingSince: null,
    hidden: false,
    ...overrides,
  };
}

const sources: CalendarSource[] = [
  makeSource({ id: "calendar-1", name: "Origin Calendar" }),
  makeSource({ id: "calendar-2", name: "Visible Target" }),
  makeSource({ id: "calendar-3", name: "Hidden Target", hidden: true }),
];

const account: CalendarAccount = {
  id: ACCOUNT_ID,
  provider: "google",
  providerName: "Google",
  providerIcon: null,
  displayName: "Work",
  email: null,
  accountLabel: "Work",
  accountIdentifier: null,
  authType: "oauth",
  needsReauthentication: false,
  calendarCount: 3,
  calendarsRefreshedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const calendarDetail: CalendarDetail = {
  id: CALENDAR_ID,
  name: "Origin Calendar",
  originalName: null,
  calendarType: "google",
  capabilities: ["pull", "push"],
  provider: "google",
  providerName: "Google",
  providerIcon: null,
  url: null,
  calendarUrl: null,
  customEventName: "",
  excludeAllDayEvents: false,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  treatFullDayTimedEventsAsAllDay: false,
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  disabled: false,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  markEventsAsPrivate: true,
  providerMissingSince: null,
  destinationIds: [],
  sourceIds: [],
  unavailableSince: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("swr", () => {
  const useSWR = (key: string) => {
    if (key === "/api/sources") {
      return { data: sources, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    if (key === `/api/accounts/${ACCOUNT_ID}`) {
      return { data: account, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    if (key === `/api/sources/${CALENDAR_ID}`) {
      return { data: calendarDetail, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    if (key?.endsWith("/destinations")) {
      return { data: { destinationIds: [] }, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    return { data: undefined, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
  };
  return {
    default: useSWR,
    preload: () => Promise.resolve(undefined),
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("../../../src/hooks/use-entitlements", () => ({
  canAddMore: () => true,
  useEntitlements: () => ({ data: { canUseEventFilters: true, mappings: { current: 0, limit: null } } }),
  useMutateEntitlements: () => ({ adjustMappingCount: () => {}, revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

vi.mock("../../../src/features/dashboard/components/reauth/use-reauth-accounts", () => ({
  useReauthAccounts: () => [],
}));

describe("mapping pickers exclude hidden calendars", () => {
  it("does not offer a hidden calendar as a wizard destination", () => {
    const Page = setupCaptured.component;
    if (!Page) throw new Error("Setup route did not register a component");
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain("Visible Target");
    expect(markup).not.toContain("Hidden Target");
  });

  it("does not offer a hidden calendar as a destination on the calendar detail page", () => {
    const Page = calendarCaptured.component;
    if (!Page) throw new Error("Calendar detail route did not register a component");
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain("Visible Target");
    expect(markup).not.toContain("Hidden Target");
  });
});
