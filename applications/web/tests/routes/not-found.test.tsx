import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { NotFoundState } from "../../src/components/ui/shells/not-found";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }) => <a href={to}>{children}</a>,
}));

describe("the not-found page", () => {
  const { document } = parseHTML(`<body>${renderToStaticMarkup(<NotFoundState />)}</body>`);

  it("leads with the page heading", () => {
    expect(document.querySelector("h2")?.textContent).toBe("Page not found");
  });

  it("stays out of the index", () => {
    expect(document.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
  });

  it("points visitors at login", () => {
    const hrefs = [...document.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual(["/login"]);
  });
});
