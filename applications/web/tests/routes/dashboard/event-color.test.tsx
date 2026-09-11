import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarAccount, CalendarDetail } from "../../../src/types/api";
import { mountComponent } from "../../helpers/mount-component";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.$calendarId";

const ACCOUNT_ID = "account-1";
const CALENDAR_ID = "calendar-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, apiFetchMock, fetcherMock } = vi.hoisted(() => {
  const capturedRoute: CapturedRoute = { component: null };
  return {
    captured: capturedRoute,
    apiFetchMock: vi.fn(async () => new Response(null, { status: 200 })),
    fetcherMock: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return { useParams: () => ({ accountId: ACCOUNT_ID, calendarId: CALENDAR_ID }) };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useCanGoBack: () => false,
  useNavigate: () => () => null,
  useRouter: () => ({ history: { back: () => null } }),
}));

const account: CalendarAccount = {
  accountIdentifier: "account-identifier",
  accountLabel: "Work Account",
  authType: "oauth",
  calendarCount: 1,
  calendarsRefreshedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Work Account",
  email: null,
  id: ACCOUNT_ID,
  needsReauthentication: false,
  provider: "google",
  providerIcon: null,
  providerName: "Google",
};

function makeCalendar(overrides: Partial<CalendarDetail> = {}): CalendarDetail {
  return {
    calendarType: "google",
    calendarUrl: null,
    capabilities: ["push"],
    createdAt: "2026-01-01T00:00:00.000Z",
    customEventName: "",
    destinationIds: [],
    disabled: false,
    excludeAllDayEvents: false,
    excludeEventDescription: false,
    excludeEventLocation: false,
    excludeEventName: false,
    excludeFocusTime: false,
    excludeOutOfOffice: false,
    id: CALENDAR_ID,
    ingestFailureCount: 0,
    ingestLastFailureAt: null,
    markEventsAsPrivate: false,
    name: "Team Calendar",
    originalName: "Team Calendar",
    provider: "google",
    providerIcon: null,
    providerMissingSince: null,
    providerName: "Google",
    sourceIds: [],
    syncFutureRange: "12_months",
    syncHistoricRange: "12_months",
    treatFullDayTimedEventsAsAllDay: false,
    unavailableSince: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: null,
    eventColor: null,
    eventCategoryName: null,
    ...overrides,
  };
}

const swrData = new Map<string, unknown>();

vi.mock("swr", () => {
  const useSWR = (key: string) => ({
    data: swrData.get(key),
    error: undefined,
    isLoading: false,
    mutate: () => Promise.resolve(undefined),
  });
  return {
    default: useSWR,
    preload: () => Promise.resolve(undefined),
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("../../../src/hooks/use-entitlements", () => ({
  canAddMore: () => true,
  useEntitlements: () => ({ data: { canUseEventFilters: true } }),
  useMutateEntitlements: () => () => Promise.resolve(undefined),
}));

vi.mock("../../../src/lib/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/fetcher")>();
  return { ...actual, apiFetch: apiFetchMock, fetcher: fetcherMock };
});

function seed(calendar: CalendarDetail) {
  swrData.clear();
  swrData.set(`/api/accounts/${ACCOUNT_ID}`, account);
  swrData.set(`/api/accounts`, []);
  swrData.set(`/api/sources/${CALENDAR_ID}`, calendar);
  swrData.set("/api/sources", []);
}

function renderPage(calendar: CalendarDetail): string {
  seed(calendar);
  const Page = captured.component;
  if (!Page) throw new Error("Calendar detail route did not register a component");
  return renderToStaticMarkup(<Page />);
}

describe("calendar detail page: event color", () => {
  it("renders the 11 Google swatches plus Default for a Google destination", () => {
    const markup = renderPage(makeCalendar({ provider: "google", capabilities: ["push"] }));

    expect(markup).toContain("Event color");
    expect(markup).toContain('aria-label="Default"');
    expect(markup).toContain('aria-label="Lavender"');
    expect(markup).toContain('aria-label="Tomato"');
    expect(markup).not.toContain("Category name");
  });

  it("renders the category input and 25 Outlook swatches plus Default for an Outlook destination", () => {
    const markup = renderPage(
      makeCalendar({ provider: "outlook", calendarType: "outlook", capabilities: ["push"] }),
    );

    expect(markup).toContain("Event color");
    expect(markup).toContain('aria-label="Category name"');
    expect(markup).toContain('aria-label="Red"');
    expect(markup).toContain('aria-label="Dark Maroon"');
    expect(markup).toContain("Outlook colors events by category.");
  });

  it("suppresses its own reauth sentence when the account needs reauthentication, relying on the standing banner", () => {
    swrData.clear();
    swrData.set(`/api/accounts/${ACCOUNT_ID}`, { ...account, needsReauthentication: true });
    swrData.set("/api/accounts", [{ ...account, needsReauthentication: true }]);
    swrData.set(
      `/api/sources/${CALENDAR_ID}`,
      makeCalendar({ provider: "outlook", calendarType: "outlook", capabilities: ["push"] }),
    );
    swrData.set("/api/sources", []);

    const Page = captured.component;
    if (!Page) throw new Error("Calendar detail route did not register a component");
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain("Reconnect 1 Account");
    expect(markup).not.toContain("Outlook colors events by category.");
  });

  it("renders nothing for a CalDAV destination", () => {
    const markup = renderPage(
      makeCalendar({ provider: "caldav", calendarType: "caldav", capabilities: ["push"] }),
    );

    expect(markup).not.toContain("Event color");
  });

  it("renders nothing when the calendar isn't a destination", () => {
    const markup = renderPage(makeCalendar({ provider: "google", capabilities: ["pull"] }));

    expect(markup).not.toContain("Event color");
  });

  it("sends a PATCH with the swatch value when a Google color is selected", async () => {
    seed(makeCalendar({ provider: "google", capabilities: ["push"] }));
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Calendar detail route did not register a component");
    const mounted = await mountComponent(<Page />);

    const swatch = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Tomato",
    );
    if (!swatch) throw new Error("Tomato swatch not found");

    await mounted.click(swatch);
    await mounted.flush();

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/sources/${CALENDAR_ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventColor: "11" }) }),
    );

    await mounted.unmount();
  });

  it("sends null when Default is selected", async () => {
    seed(makeCalendar({ provider: "google", capabilities: ["push"], eventColor: "3" }));
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Calendar detail route did not register a component");
    const mounted = await mountComponent(<Page />);

    const defaultButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Default",
    );
    if (!defaultButton) throw new Error("Default swatch not found");

    await mounted.click(defaultButton);
    await mounted.flush();

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/sources/${CALENDAR_ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventColor: null }) }),
    );

    await mounted.unmount();
  });

  it("sends a PATCH with the preset value when an Outlook color is selected", async () => {
    seed(makeCalendar({ provider: "outlook", calendarType: "outlook", capabilities: ["push"] }));
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Calendar detail route did not register a component");
    const mounted = await mountComponent(<Page />);

    const swatch = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Dark Maroon",
    );
    if (!swatch) throw new Error("Dark Maroon swatch not found");

    await mounted.click(swatch);
    await mounted.flush();

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/sources/${CALENDAR_ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventColor: "preset24" }) }),
    );

    await mounted.unmount();
  });
});
