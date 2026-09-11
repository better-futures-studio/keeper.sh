import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarSource } from "../../../src/types/api";
import { mountComponent } from "../../helpers/mount-component";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.setup";

const ACCOUNT_ID = "account-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, navigateMock, apiFetchMock, globalMutateMock } = vi.hoisted(() => {
  const capturedRoute: CapturedRoute = { component: null };
  return {
    captured: capturedRoute,
    navigateMock: vi.fn(),
    apiFetchMock: vi.fn(async () => new Response(null, { status: 200 })),
    globalMutateMock: vi.fn(async () => undefined),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return {
      useParams: () => ({ accountId: ACCOUNT_ID }),
      useSearch: () => ({ step: "select", id: undefined, index: undefined }),
    };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
  useCanGoBack: () => false,
  useRouter: () => ({ history: { back: () => null } }),
}));

const sources: CalendarSource[] = [
  makeSource({ id: "cal-1", name: "Work", providerName: "Google" }),
  makeSource({ id: "cal-2", name: "Personal", providerName: "Google" }),
];

vi.mock("swr", () => {
  const useSWR = (key: string) => {
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
  return { ...actual, apiFetch: apiFetchMock };
});

function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "cal-1",
    name: "Calendar",
    calendarType: "google",
    capabilities: ["pull"],
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
    eventColor: null,
    eventCategoryName: null,
    ...overrides,
  };
}

function renderMarkup(): string {
  const Page = captured.component;
  if (!Page) throw new Error("Setup route did not register a component");
  return renderToStaticMarkup(<Page />);
}

describe("account setup: choose calendars to import", () => {
  it("renders every calendar checked by default", () => {
    const markup = renderMarkup();

    expect(markup).toContain("Choose calendars to import");
    expect(markup).toContain("Work");
    expect(markup).toContain("Personal");
    const checkedCount = (markup.match(/role="checkbox" aria-checked="true"/g) ?? []).length;
    expect(checkedCount).toBe(2);
  });

  it("PUTs the checked calendar ids to the account selection endpoint and advances the wizard", async () => {
    apiFetchMock.mockClear();
    globalMutateMock.mockClear();
    navigateMock.mockClear();

    const Page = captured.component;
    if (!Page) throw new Error("Setup route did not register a component");

    const mounted = await mountComponent(<Page />);
    const checkboxes = mounted.container.querySelectorAll('[role="checkbox"]');
    expect(checkboxes.length).toBe(2);

    // Uncheck the second calendar ("Personal") before continuing.
    await mounted.click(checkboxes[1]);

    const continueButton = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Continue"),
    );
    if (!continueButton) throw new Error("Continue button not found");
    await mounted.click(continueButton);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sources/accounts/${ACCOUNT_ID}/selection`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ calendarIds: ["cal-1"] });

    expect(globalMutateMock).toHaveBeenCalledWith("/api/sources");
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const navArgs = navigateMock.mock.calls[0][0];
    expect(navArgs.search).toEqual({ step: "rename", id: "cal-1" });

    await mounted.unmount();
  });
});
