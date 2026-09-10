import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "../../../src/types/api";
import { mountComponent } from "../../helpers/mount-component";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.index";

const ACCOUNT_ID = "account-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, apiFetchMock, fetcherMock, globalMutateMock } = vi.hoisted(() => {
  const capturedRoute: CapturedRoute = { component: null };
  return {
    captured: capturedRoute,
    apiFetchMock: vi.fn(async () => new Response(null, { status: 200 })),
    fetcherMock: vi.fn(),
    // Mirrors SWR's real `mutate(key, updater, opts)`: it must actually invoke the
    // updater so the apiFetch call inside it (see setCalendarHidden) runs.
    globalMutateMock: vi.fn(async (_key: string, updater?: unknown) => {
      if (typeof updater === "function") return updater(undefined);
      return undefined;
    }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return { useParams: () => ({ accountId: ACCOUNT_ID }) };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => null,
  useCanGoBack: () => false,
  useRouter: () => ({ history: { back: () => null } }),
}));

const account: CalendarAccount = {
  id: ACCOUNT_ID,
  provider: "outlook",
  providerName: "Outlook",
  providerIcon: null,
  displayName: "Work Account",
  email: null,
  accountLabel: "Work Account",
  accountIdentifier: "account-identifier",
  authType: "oauth",
  needsReauthentication: false,
  calendarCount: 2,
  calendarsRefreshedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "cal-1",
    name: "Calendar",
    calendarType: "outlook",
    capabilities: ["pull"],
    accountId: ACCOUNT_ID,
    provider: "outlook",
    providerName: "Outlook",
    providerIcon: null,
    displayName: null,
    email: null,
    accountLabel: "Work Account",
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

function makeDetail(overrides: Partial<CalendarDetail> = {}): CalendarDetail {
  return {
    id: "cal-1",
    name: "Calendar",
    originalName: null,
    calendarType: "outlook",
    capabilities: ["pull"],
    provider: "outlook",
    providerName: "Outlook",
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
    ...overrides,
  };
}

let sources: CalendarSource[] = [];

vi.mock("swr", () => {
  const useSWR = (key: string) => {
    if (key === `/api/accounts/${ACCOUNT_ID}`) {
      return { data: account, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    if (key === "/api/accounts") {
      return { data: [], error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    if (key === "/api/sources") {
      return { data: sources, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
    }
    return { data: undefined, error: undefined, isLoading: false, mutate: () => Promise.resolve(undefined) };
  };
  return {
    default: useSWR,
    preload: () => Promise.resolve(undefined),
    useSWRConfig: () => ({ mutate: globalMutateMock }),
  };
});

vi.mock("../../../src/lib/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/fetcher")>();
  return { ...actual, apiFetch: apiFetchMock, fetcher: fetcherMock };
});

function renderMarkup(): string {
  const Page = captured.component;
  if (!Page) throw new Error("Account route did not register a component");
  return renderToStaticMarkup(<Page />);
}

describe("account page: calendar visibility", () => {
  it("lists visible calendars with a Hide action and collapses hidden ones", () => {
    sources = [
      makeSource({ id: "cal-visible", name: "Visible Calendar", hidden: false }),
      makeSource({ id: "cal-hidden", name: "Hidden Calendar", hidden: true }),
    ];

    const markup = renderMarkup();

    expect(markup).toContain("Visible Calendar");
    expect(markup).toContain("Hide");
    expect(markup).toContain("Hidden calendars (1)");
    expect(markup).toContain("Hidden Calendar");
    expect(markup).toContain("Show");
  });

  it("hides a mapping-free calendar immediately with a PATCH, no confirmation needed", async () => {
    sources = [makeSource({ id: "cal-visible", name: "Visible Calendar", hidden: false })];
    fetcherMock.mockResolvedValue(makeDetail({ id: "cal-visible", destinationIds: [], sourceIds: [] }));
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Account route did not register a component");
    const mounted = await mountComponent(<Page />);

    const hideButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Hide",
    );
    if (!hideButton) throw new Error("Hide button not found");

    await mounted.click(hideButton);
    await mounted.flush(); // let the async mapping check + PATCH settle

    expect(fetcherMock).toHaveBeenCalledWith("/api/sources/cal-visible");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/sources/cal-visible",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hidden: true }) }),
    );

    await mounted.unmount();
  });

  it("confirms before hiding a calendar that has mappings, and does not PATCH until confirmed", async () => {
    sources = [makeSource({ id: "cal-mapped", name: "Mapped Calendar", hidden: false })];
    fetcherMock.mockResolvedValue(makeDetail({ id: "cal-mapped", destinationIds: ["cal-other"], sourceIds: [] }));
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Account route did not register a component");
    const mounted = await mountComponent(<Page />);

    const hideButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Hide",
    );
    if (!hideButton) throw new Error("Hide button not found");

    await mounted.click(hideButton);
    await mounted.flush();

    expect(apiFetchMock).not.toHaveBeenCalled();
    // The confirmation modal portals into document.body, outside the mounted container.
    expect(document.body.textContent).toContain("Hiding removes its mappings");

    // The modal portals outside `mounted.container`; exclude the row's own Hide button.
    const confirmButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Hide" && !mounted.container.contains(button),
    );
    if (!confirmButton) throw new Error("Confirm button not found");

    await mounted.click(confirmButton);
    await mounted.flush();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/sources/cal-mapped",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hidden: true }) }),
    );

    await mounted.unmount();
  });

  it("shows a hidden calendar with a PATCH", async () => {
    sources = [makeSource({ id: "cal-hidden", name: "Hidden Calendar", hidden: true })];
    apiFetchMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Account route did not register a component");
    const mounted = await mountComponent(<Page />);

    const showButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.textContent?.endsWith("Show"),
    );
    if (!showButton) throw new Error("Show button not found");

    await mounted.click(showButton);
    await mounted.flush();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/sources/cal-hidden",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hidden: false }) }),
    );

    await mounted.unmount();
  });
});
