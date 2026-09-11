import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const OPERATOR_NAME = "Boca Pro";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured } = vi.hoisted(() => ({
  captured: {
    privacy: { component: null } as CapturedRoute,
    terms: { component: null } as CapturedRoute,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: { component: () => React.ReactElement }) => {
    if (path === "/(legal)/privacy") {
      captured.privacy.component = options.component;
    }

    if (path === "/(legal)/terms") {
      captured.terms.component = options.component;
    }

    return {
      useRouteContext: () => ({
        runtimeConfig: {
          commercialMode: false,
          operatorName: OPERATOR_NAME,
          polarProMonthlyProductId: null,
          polarProYearlyProductId: null,
        },
      }),
    };
  },
}));

import "../../src/routes/(legal)/privacy";
import "../../src/routes/(legal)/terms";

describe("legal pages", () => {
  it("renders the operator name on the privacy page", () => {
    const Page = captured.privacy.component;
    if (!Page) throw new Error("Privacy route did not register a component");

    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain(OPERATOR_NAME);
    expect(markup).toContain(`${OPERATOR_NAME} administrators`);
  });

  it("renders the operator name on the terms page", () => {
    const Page = captured.terms.component;
    if (!Page) throw new Error("Terms route did not register a component");

    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain(OPERATOR_NAME);
    expect(markup).toContain(`${OPERATOR_NAME} administrator`);
  });
});
