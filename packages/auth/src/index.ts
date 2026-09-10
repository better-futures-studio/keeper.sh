import { type } from "arktype";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { signJWT } from "better-auth/crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt as jwtPlugin } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { checkout, polar, portal } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { Resend } from "resend";
import { usernameOnly } from "./plugins/username-only";
import { writeAuthStderr } from "./runtime-environment";
import { resolveAuthCapabilities } from "./capabilities";
import {
  formatSignupDomainLimitMessage,
  isSignupEmailAllowed,
  isSocialLoginEnabled,
  type SocialLoginProviderId,
} from "./signup-restrictions";
import {
  createUnverifiedRegistrationReclaim,
  readSignUpBody,
} from "./unverified-registration-reclaim";
import {
  resolveMcpAuthOptions,
  resolveMcpJwksUrl,
} from "./mcp-config";
import {
  account as accountTable,
  jwks as jwksTable,
  oauthAccessToken as oauthAccessTokenTable,
  oauthClient as oauthClientTable,
  oauthConsent as oauthConsentTable,
  oauthRefreshToken as oauthRefreshTokenTable,
  passkey as passkeyTable,
  session as sessionTable,
  user as userTable,
  verification as verificationTable,
} from "@keeper.sh/database/auth-schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BetterAuthPlugin } from "better-auth";

interface EmailUser {
  email: string;
  name: string;
}

interface SendEmailParams {
  user: EmailUser;
  url: string;
}

interface AuthConfig {
  database: BunSQLDatabase;
  secret: string;
  baseUrl: string;
  allowedSignupDomains?: string[];
  commercialMode?: boolean;
  credentialLoginEnabled?: boolean;
  polarAccessToken?: string;
  polarMode?: "sandbox" | "production";
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  resendApiKey?: string;
  passkeyRpId?: string;
  passkeyRpName?: string;
  passkeyOrigin?: string;
  socialLoginProviders?: readonly SocialLoginProviderId[];
  trustedOrigins?: string[];
  mcpResourceUrl?: string;
  mcpApiBaseUrl?: string;
}

interface KeeperMcpAuthSession {
  scopes: string;
  userId: string | null;
}

interface KeeperMcpAuthApi {
  getMcpSession: (input: { headers: Headers }) => Promise<KeeperMcpAuthSession | null>;
  getMCPProtectedResource: () => Promise<unknown>;
  getMcpOAuthConfig: () => Promise<unknown>;
}

/**
 * Better Auth's oauthProvider plugin adds API methods at runtime.
 * This type predicate verifies the methods exist so we can call them
 * without type assertions.
 */
interface OAuthProviderAuthApi {
  getOAuthServerConfig: (input: { headers: Headers }) => Promise<unknown>;
  getOpenIdConfig: (input: { headers: Headers }) => Promise<unknown>;
}

const hasOAuthProviderApi = (
  api: object,
): api is OAuthProviderAuthApi => {
  if (!("getOAuthServerConfig" in api)) {
    return false;
  }
  if (!("getOpenIdConfig" in api)) {
    return false;
  }
  if (typeof api.getOAuthServerConfig !== "function") {
    return false;
  }
  if (typeof api.getOpenIdConfig !== "function") {
    return false;
  }
  return true;
};

const mcpJwtClaimsSchema = type({
  scope: "string",
  sub: "string",
  "+": "delete",
});

const AUTH_BASE_PATH = "/api/auth";
const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 3600;
const CREDENTIAL_LOGIN_DISABLED_MESSAGE = "Credential login is disabled";

const DISABLED_CREDENTIAL_LOGIN_PATHS = new Set([
  "/change-password",
  "/forget-password",
  "/request-password-reset",
  "/reset-password",
  "/sign-in/email",
  "/sign-in/username",
  "/sign-up/email",
]);

const isDisabledCredentialLoginPath = (path: string): boolean => {
  if (DISABLED_CREDENTIAL_LOGIN_PATHS.has(path)) {
    return true;
  }

  return (
    path.startsWith("/forget-password/") ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/username-only/")
  );
};

const rejectCredentialLogin = (): never => {
  throw new APIError("FORBIDDEN", {
    message: CREDENTIAL_LOGIN_DISABLED_MESSAGE,
  });
};

const readAuthHandlerPath = (url: string): string => {
  const { pathname } = new URL(url);
  if (!pathname.startsWith(AUTH_BASE_PATH)) {
    return pathname;
  }

  const suffix = pathname.slice(AUTH_BASE_PATH.length);
  if (suffix.length === 0) {
    return "/";
  }

  return suffix;
};

const createCredentialLoginDisabledPlugin = (): BetterAuthPlugin => ({
  id: "credential-login-disabled",
  onRequest: (request) => {
    if (!isDisabledCredentialLoginPath(readAuthHandlerPath(request.url))) {
      return Promise.resolve();
    }

    return Promise.resolve({
      response: Response.json(
        { message: CREDENTIAL_LOGIN_DISABLED_MESSAGE },
        { status: 403 },
      ),
    });
  },
});

const assertSignInMethodAvailable = (
  credentialLoginEnabled: boolean,
  socialProviders: { google: boolean; microsoft: boolean },
): void => {
  if (credentialLoginEnabled) {
    return;
  }

  if (socialProviders.google || socialProviders.microsoft) {
    return;
  }

  throw new Error(
    "CREDENTIAL_LOGIN_ENABLED is false but no social login provider is enabled. Configure Google or Microsoft credentials, and include that provider in SOCIAL_LOGIN_PROVIDERS if that list is set.",
  );
};

const resolveCredentialPlugins = (
  commercialMode: boolean,
  credentialLoginEnabled: boolean,
): BetterAuthPlugin[] => {
  const plugins: BetterAuthPlugin[] = [];

  if (!commercialMode && credentialLoginEnabled) {
    plugins.push(usernameOnly());
  }

  if (!credentialLoginEnabled) {
    plugins.push(createCredentialLoginDisabledPlugin());
  }

  return plugins;
};

const createAuth = (config: AuthConfig) => {
  const {
    database,
    secret,
    baseUrl,
    commercialMode = false,
    credentialLoginEnabled = true,
    polarAccessToken,
    polarMode,
    googleClientId,
    googleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    resendApiKey,
    passkeyRpId,
    passkeyRpName,
    passkeyOrigin,
    allowedSignupDomains = [],
    socialLoginProviders,
    trustedOrigins,
    mcpResourceUrl,
    mcpApiBaseUrl,
  } = config;

  const buildResendClient = (): Resend | null => {
    if (resendApiKey) {
      return new Resend(resendApiKey);
    }
    return null;
  };

  const resend = buildResendClient();
  const capabilities = resolveAuthCapabilities({
    allowedSignupDomains,
    commercialMode,
    credentialLoginEnabled,
    googleClientId,
    googleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    passkeyOrigin,
    passkeyRpId,
    socialLoginProviders,
  });

  assertSignInMethodAvailable(credentialLoginEnabled, capabilities.socialProviders);

  const assertSignupEmailAllowed = (email?: string): void => {
    if (isSignupEmailAllowed(email, allowedSignupDomains)) {
      return;
    }

    throw new APIError("FORBIDDEN", {
      message: formatSignupDomainLimitMessage(allowedSignupDomains),
    });
  };

  const plugins = resolveCredentialPlugins(commercialMode, credentialLoginEnabled);

  const buildPolarClient = (): Polar | null => {
    if (polarAccessToken && polarMode) {
      return new Polar({
        accessToken: polarAccessToken,
        server: polarMode,
      });
    }
    return null;
  };

  const polarClient = buildPolarClient();

  if (polarClient) {
    const buildCheckoutSuccessUrl = (): string => {
      if (!baseUrl) {
        return "/dashboard/billing?success=true";
      }
      return new URL("/dashboard/billing?success=true", baseUrl).toString();
    };

    const checkoutSuccessUrl = buildCheckoutSuccessUrl();

    plugins.push(
      polar({
        client: polarClient,
        createCustomerOnSignUp: true,
        use: [
          checkout({
            successUrl: checkoutSuccessUrl,
          }),
          portal(),
        ],
      }),
    );
  }

  if (commercialMode && passkeyRpId && passkeyOrigin) {
    plugins.push(
      passkeyPlugin({
        origin: passkeyOrigin,
        rpID: passkeyRpId,
        rpName: passkeyRpName,
      }),
    );
  }

  const mcpOptions = resolveMcpAuthOptions({
    resourceBaseUrl: mcpResourceUrl,
    webBaseUrl: baseUrl,
  });

  if (mcpOptions) {
    plugins.push(jwtPlugin());
    plugins.push(oauthProvider(mcpOptions.oauthProvider));
  }

  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] = {};

  if (
    googleClientId &&
    googleClientSecret &&
    isSocialLoginEnabled("google", socialLoginProviders)
  ) {
    socialProviders.google = {
      accessType: "offline",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    };
  }

  if (
    microsoftClientId &&
    microsoftClientSecret &&
    isSocialLoginEnabled("microsoft", socialLoginProviders)
  ) {
    socialProviders.microsoft = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      mapProfileToUser: (profile) => ({
        emailVerified: profile.email_verified ?? true,
      }),
      prompt: "consent",
      scope: ["offline_access", "User.Read", "Calendars.ReadWrite"],
    };
  }

  const { applyPendingReclaim, recordPendingReclaim } =
    createUnverifiedRegistrationReclaim(database);

  const sendVerificationEmail = async ({ user, url }: SendEmailParams) => {
    if (!resend) {
      return;
    }
    await resend.emails.send({
      template: {
        id: "email-verification",
        variables: { name: user.name, url },
      },
      to: user.email,
    });
  };

  const sendReclaimVerificationEmail = async (user: EmailUser) => {
    const token = await signJWT(
      { email: user.email.toLowerCase() },
      secret,
      EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    );
    const callbackURL = encodeURIComponent("/");

    await sendVerificationEmail({
      url: `${baseUrl}${AUTH_BASE_PATH}/verify-email?token=${token}&callbackURL=${callbackURL}`,
      user,
    });
  };

  const auth = betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
    },
    basePath: AUTH_BASE_PATH,
    baseURL: baseUrl,
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            assertSignupEmailAllowed(user.email);
            return Promise.resolve({ data: user });
          },
        },
      },
    },
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        account: accountTable,
        jwks: jwksTable,
        oauthAccessToken: oauthAccessTokenTable,
        oauthClient: oauthClientTable,
        oauthConsent: oauthConsentTable,
        oauthRefreshToken: oauthRefreshTokenTable,
        passkey: passkeyTable,
        session: sessionTable,
        user: userTable,
        verification: verificationTable,
      },
    }),
    emailAndPassword: {
      enabled: commercialMode && credentialLoginEnabled,
      onExistingUserSignUp: async ({ user }, request) => {
        if (user.emailVerified) {
          return;
        }

        if (!request) {
          throw new TypeError(
            "Sign-up request is unavailable, cannot capture an unverified registration reclaim",
          );
        }

        const { name, password } = await readSignUpBody(request);

        const recorded = await recordPendingReclaim({ name, password, user });

        if (!recorded) {
          return;
        }

        await sendReclaimVerificationEmail({ email: user.email, name });
      },
      requireEmailVerification: commercialMode,
      sendResetPassword: async ({ user, url }: SendEmailParams) => {
        if (!resend) {
          return;
        }
        await resend.emails.send({
          template: {
            id: "password-reset",
            variables: { name: user.name, url },
          },
          to: user.email,
        });
      },
    },
    emailVerification: {
      afterEmailVerification: applyPendingReclaim,
      autoSignInAfterVerification: true,
      sendVerificationEmail,
    },
    hooks: {
      before: createAuthMiddleware((ctx) => {
        if (!credentialLoginEnabled && isDisabledCredentialLoginPath(ctx.path)) {
          rejectCredentialLogin();
        }
        if (ctx.path === "/username-only/sign-up") {
          assertSignupEmailAllowed();
        }
        return Promise.resolve();
      }),
    },
    onAPIError: {
      onError(error: unknown) {
        if (typeof error !== "object" || error === null) {
          return;
        }
        if (!("body" in error) || typeof error.body !== "object" || error.body === null) {
          return;
        }
        if (!("message" in error.body) || typeof error.body.message !== "string") {
          return;
        }

        if (error.body.message.toLowerCase().includes("invalid origin")) {
          writeAuthStderr(
            "A request has failed due to an origin mismatch. If this was meant to be a valid request, please set the `TRUSTED_ORIGINS` environment variable to include the origin you intend on accessing Keeper from.\n\nThis should be a comma-delimited array of values, for more information please refer to the documentation on GitHub. https://github.com/ridafkih/keeper.sh#accessing-keeper-from-non-localhost-urls",
          );
        }
      },
    },
    plugins,
    secret,
    socialProviders,
    trustedOrigins,
    user: {
      deleteUser: {
        enabled: false,
      },
    },
  });

  if (mcpOptions) {
    const resourceClient = oauthProviderResourceClient();
    const resourceActions = resourceClient.getActions();
    const jwksUrl = resolveMcpJwksUrl(baseUrl, mcpApiBaseUrl);

    if (!hasOAuthProviderApi(auth.api)) {
      throw new Error("OAuth provider plugin did not register expected API methods");
    }

    const oauthApi = auth.api;

    Object.assign(auth.api, {
      getMCPProtectedResource: () =>
        resourceActions.getProtectedResourceMetadata(
          mcpOptions.protectedResourceMetadata,
        ),
      getMcpOAuthConfig: () =>
        oauthApi.getOAuthServerConfig({
          headers: new Headers(),
        }),
      getMcpSession: async ({ headers }: { headers: Headers }) => {
        const authorization = headers.get("authorization");

        if (!authorization?.startsWith("Bearer ")) {
          return null;
        }

        const accessToken = authorization.slice("Bearer ".length).trim();

        if (accessToken.length === 0) {
          return null;
        }

        const jwt = await resourceActions.verifyAccessToken(accessToken, {
          jwksUrl,
          verifyOptions: {
            audience: mcpOptions.oauthProvider.validAudiences,
            issuer: `${baseUrl}/api/auth`,
          },
        });

        const claims = mcpJwtClaimsSchema(jwt);

        if (claims instanceof type.errors) {
          throw new TypeError(`Invalid JWT claims: ${claims.summary}`);
        }

        return {
          scopes: claims.scope,
          userId: claims.sub,
        };
      },
    } satisfies KeeperMcpAuthApi);
  }

  return { auth, capabilities, polarClient: polarClient ?? null };
};

type KeeperMcpEnabledAuth<TAuth = ReturnType<typeof betterAuth>> = TAuth & {
  api: KeeperMcpAuthApi;
};

const isKeeperMcpEnabledAuth = <TAuth extends { api: object }>(
  auth: TAuth,
): auth is TAuth & { api: KeeperMcpAuthApi } => {
  if (!("getMcpSession" in auth.api)) {
    return false;
  }
  if (!("getMCPProtectedResource" in auth.api)) {
    return false;
  }
  if (!("getMcpOAuthConfig" in auth.api)) {
    return false;
  }
  return true;
};

type AuthResult = ReturnType<typeof createAuth>;

export {
  createAuth,
  hasOAuthProviderApi,
  isKeeperMcpEnabledAuth,
};
export { resolveAuthCapabilities } from "./capabilities";
export {
  parseAllowedSignupDomains,
  parseSocialLoginProviders,
} from "./signup-restrictions";
export {
  KEEPER_API_DEFAULT_SCOPE,
  KEEPER_API_DESTINATION_SCOPE,
  KEEPER_API_EVENT_SCOPE,
  KEEPER_API_MAPPING_SCOPE,
  KEEPER_API_READ_SCOPE,
  KEEPER_API_RESOURCE_SCOPES,
  KEEPER_API_SCOPES,
  KEEPER_API_SOURCE_SCOPE,
  KEEPER_API_SYNC_SCOPE,
} from "./mcp-config";
export type {
  AuthConfig,
  AuthResult,
  KeeperMcpAuthApi,
  KeeperMcpAuthSession,
  KeeperMcpEnabledAuth,
};
