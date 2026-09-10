import { describe, expect, it } from "vitest";
import {
  formatAllowedSignupDomainsHint,
  getEnabledSocialProviders,
  offersSeparateSignup,
  resolveCredentialField,
  resolveSignupPath,
  supportsPasskeys,
  type AuthCapabilities,
} from "../../src/lib/auth-capabilities";

const emailCapabilities: AuthCapabilities = {
  allowedSignupDomains: [],
  commercialMode: true,
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: {
    google: true,
    microsoft: false,
  },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

describe("resolveCredentialField", () => {
  it("returns email field metadata for commercial auth", () => {
    expect(resolveCredentialField(emailCapabilities)).toEqual({
      autoComplete: "email",
      id: "email",
      label: "Email",
      name: "email",
      placeholder: "johndoe+keeper@example.com",
      type: "email",
    });
  });

  it("returns username field metadata for non-commercial auth", () => {
    expect(resolveCredentialField({
      ...emailCapabilities,
      credentialMode: "username",
    })).toEqual({
      autoComplete: "username",
      id: "username",
      label: "Username",
      name: "username",
      placeholder: "johndoe",
      type: "text",
    });
  });
});

describe("getEnabledSocialProviders", () => {
  it("returns only enabled social providers", () => {
    expect(getEnabledSocialProviders(emailCapabilities)).toEqual(["google"]);
  });
});

describe("supportsPasskeys", () => {
  it("returns false when passkeys are disabled", () => {
    expect(supportsPasskeys({
      ...emailCapabilities,
      supportsPasskeys: false,
    })).toBe(false);
  });
});

describe("offersSeparateSignup", () => {
  it("is true when credential login is available", () => {
    expect(offersSeparateSignup(emailCapabilities)).toBe(true);
    expect(offersSeparateSignup({
      ...emailCapabilities,
      credentialMode: "username",
    })).toBe(true);
  });

  it("is false when credential login is disabled", () => {
    expect(offersSeparateSignup({
      ...emailCapabilities,
      credentialMode: "none",
    })).toBe(false);
  });
});

describe("resolveSignupPath", () => {
  it("keeps /register when credential login is available", () => {
    expect(resolveSignupPath(emailCapabilities)).toBe("/register");
  });

  it("sends sign-up traffic to /login when credential login is disabled", () => {
    expect(resolveSignupPath({
      ...emailCapabilities,
      credentialMode: "none",
    })).toBe("/login");
  });
});

describe("formatAllowedSignupDomainsHint", () => {
  it("returns null when no domains are configured", () => {
    expect(formatAllowedSignupDomainsHint([])).toBeNull();
  });

  it("names a single allowed domain", () => {
    expect(formatAllowedSignupDomainsHint(["heyjet.ai"])).toBe(
      "Sign-ups are limited to @heyjet.ai accounts",
    );
  });

  it("joins multiple domains with a comma", () => {
    expect(formatAllowedSignupDomainsHint(["heyjet.ai", "example.com"])).toBe(
      "Sign-ups are limited to @heyjet.ai, @example.com accounts",
    );
  });
});
