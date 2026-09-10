import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { Route as RegisterRoute } from "../../src/routes/(auth)/register";

type RouteOptions = { options: Record<string, unknown> };

const registerRoute = RegisterRoute as unknown as RouteOptions;

const emailCapabilities = {
  allowedSignupDomains: [],
  commercialMode: true,
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: { google: true, microsoft: false },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

const noneCapabilities = {
  ...emailCapabilities,
  credentialMode: "none",
  supportsChangePassword: false,
  supportsPasswordReset: false,
};

const runRegisterLoader = async (
  body: unknown,
  search: Record<string, string> = {},
) => {
  const loader = registerRoute.options.loader as (args: unknown) => Promise<unknown>;
  return loader({
    context: {
      fetchApi: async () => body,
    },
    search,
  });
};

const captureThrow = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected the loader to throw");
};

describe("register route loader", () => {
  it("redirects to login and keeps the query string when credential login is off", async () => {
    const search = {
      client_id: "mcp-client",
      redirect: "/dashboard",
    };

    const thrown = await captureThrow(() => runRegisterLoader(noneCapabilities, search));

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/login");
    expect((thrown as { options: { search: Record<string, string> } }).options.search).toEqual(
      search,
    );
  });

  it("still renders registration when credential login is email", async () => {
    await expect(runRegisterLoader(emailCapabilities)).resolves.toEqual(emailCapabilities);
  });

  it("still renders registration when credential login is username", async () => {
    const usernameCapabilities = {
      ...emailCapabilities,
      credentialMode: "username",
    };

    await expect(runRegisterLoader(usernameCapabilities)).resolves.toEqual(usernameCapabilities);
  });
});
