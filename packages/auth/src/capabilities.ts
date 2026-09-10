import { authCapabilitiesSchema } from "@keeper.sh/data-schemas";
import type { AuthCapabilities } from "@keeper.sh/data-schemas";
import {
  isSocialLoginEnabled,
  type SocialLoginProviderId,
} from "./signup-restrictions";

interface ResolveAuthCapabilitiesConfig {
  allowedSignupDomains?: string[];
  commercialMode?: boolean;
  credentialLoginEnabled?: boolean;
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
  credentialLoginEnabled = true,
): AuthCapabilities["credentialMode"] => {
  if (!credentialLoginEnabled) {
    return "none";
  }

  if (commercialMode) {
    return "email";
  }

  return "username";
};

const resolveAuthCapabilities = (
  config: ResolveAuthCapabilitiesConfig,
): AuthCapabilities => {
  const credentialLoginEnabled = config.credentialLoginEnabled ?? true;
  const commercialMode = config.commercialMode ?? false;

  return authCapabilitiesSchema.assert({
    allowedSignupDomains: config.allowedSignupDomains ?? [],
    commercialMode,
    credentialMode: resolveCredentialMode(commercialMode, credentialLoginEnabled),
    requiresEmailVerification: commercialMode,
    socialProviders: {
      google:
        hasOAuthCredentials(config.googleClientId, config.googleClientSecret) &&
        isSocialLoginEnabled("google", config.socialLoginProviders),
      microsoft:
        hasOAuthCredentials(config.microsoftClientId, config.microsoftClientSecret) &&
        isSocialLoginEnabled("microsoft", config.socialLoginProviders),
    },
    supportsChangePassword: credentialLoginEnabled,
    supportsPasskeys: Boolean(
      commercialMode && config.passkeyOrigin && config.passkeyRpId,
    ),
    supportsPasswordReset: commercialMode && credentialLoginEnabled,
  });
};

export { resolveAuthCapabilities };
export type { ResolveAuthCapabilitiesConfig };
