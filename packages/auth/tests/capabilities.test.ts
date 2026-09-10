import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { describe, expect, it } from "vitest";
import { resolveAuthCapabilities } from "../src/capabilities";
import { createAuth } from "../src/index";
import { parseSocialLoginProviders } from "../src/signup-restrictions";

describe("resolveAuthCapabilities", () => {
  it("uses username auth in non-commercial mode while preserving configured socials", () => {
    const capabilities = resolveAuthCapabilities({
      commercialMode: false,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      passkeyOrigin: "https://keeper.sh",
      passkeyRpId: "keeper.sh",
    });

    expect(capabilities).toEqual({
      allowedSignupDomains: [],
      commercialMode: false,
      credentialMode: "username",
      requiresEmailVerification: false,
      socialProviders: {
        google: true,
        microsoft: true,
      },
      supportsChangePassword: true,
      supportsPasskeys: false,
      supportsPasswordReset: false,
    });
  });

  it("enables email auth, passkeys, and configured socials in commercial mode", () => {
    const capabilities = resolveAuthCapabilities({
      commercialMode: true,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      passkeyOrigin: "https://keeper.sh",
      passkeyRpId: "keeper.sh",
    });

    expect(capabilities).toEqual({
      allowedSignupDomains: [],
      commercialMode: true,
      credentialMode: "email",
      requiresEmailVerification: true,
      socialProviders: {
        google: true,
        microsoft: true,
      },
      supportsChangePassword: true,
      supportsPasskeys: true,
      supportsPasswordReset: true,
    });
  });

  it("reports only listed social login providers even when both credentials are present", () => {
    const capabilities = resolveAuthCapabilities({
      commercialMode: false,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      socialLoginProviders: ["google"],
    });

    expect(capabilities.socialProviders).toEqual({
      google: true,
      microsoft: false,
    });
  });

  it("surfaces allowedSignupDomains when configured", () => {
    const capabilities = resolveAuthCapabilities({
      allowedSignupDomains: ["heyjet.ai", "example.com"],
    });

    expect(capabilities.allowedSignupDomains).toEqual(["heyjet.ai", "example.com"]);
  });

  it("does not register an unlisted social provider on the auth instance", () => {
    const { auth, capabilities } = createAuth({
      baseUrl: "http://localhost:3000",
      database: {} as BunSQLDatabase,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      secret: "test-secret-for-social-login-filter",
      socialLoginProviders: ["google"],
    });

    expect(capabilities.socialProviders).toEqual({
      google: true,
      microsoft: false,
    });
    expect(auth.options.socialProviders?.google).toBeDefined();
    expect(auth.options.socialProviders?.microsoft).toBeUndefined();
  });
});

describe("parseSocialLoginProviders", () => {
  it("fails fast on unknown provider names", () => {
    expect(() => parseSocialLoginProviders("google,apple")).toThrow(
      'Invalid SOCIAL_LOGIN_PROVIDERS value "apple". Allowed values: google, microsoft.',
    );
  });
});
