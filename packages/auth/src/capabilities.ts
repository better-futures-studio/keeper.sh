import { authCapabilitiesSchema } from "@keeper.sh/data-schemas";
import type { AuthCapabilities } from "@keeper.sh/data-schemas";
import {
  isSocialLoginEnabled,
  type SocialLoginProviderId,
} from "./signup-restrictions";

interface ResolveAuthCapabilitiesConfig {
  allowedSignupDomains?: string[];
  commercialMode?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  passkeyRpId?: string;
  passkeyOrigin?: string;
  socialLoginProviders?: readonly SocialLoginProviderId[];
}

const hasOAuthCredentials = (clientId?: string, clientSecret?: string): boolean =>
  Boolean(clientId && clientSecret);

const resolveCredentialMode = (
  commercialMode?: boolean,
): AuthCapabilities["credentialMode"] => {
  if (commercialMode) {
    return "email";
  }

  return "username";
};

const resolveAuthCapabilities = (
  config: ResolveAuthCapabilitiesConfig,
): AuthCapabilities =>
  authCapabilitiesSchema.assert({
    allowedSignupDomains: config.allowedSignupDomains ?? [],
    commercialMode: config.commercialMode ?? false,
    credentialMode: resolveCredentialMode(config.commercialMode),
    requiresEmailVerification: config.commercialMode ?? false,
    socialProviders: {
      google:
        hasOAuthCredentials(config.googleClientId, config.googleClientSecret) &&
        isSocialLoginEnabled("google", config.socialLoginProviders),
      microsoft:
        hasOAuthCredentials(config.microsoftClientId, config.microsoftClientSecret) &&
        isSocialLoginEnabled("microsoft", config.socialLoginProviders),
    },
    supportsChangePassword: true,
    supportsPasskeys: Boolean(
      config.commercialMode && config.passkeyOrigin && config.passkeyRpId,
    ),
    supportsPasswordReset: config.commercialMode ?? false,
  });

export { resolveAuthCapabilities };
export type { ResolveAuthCapabilitiesConfig };
