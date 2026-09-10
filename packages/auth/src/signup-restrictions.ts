const SOCIAL_LOGIN_PROVIDER_IDS = ["google", "microsoft"] as const;

type SocialLoginProviderId = (typeof SOCIAL_LOGIN_PROVIDER_IDS)[number];

const isSocialLoginProviderId = (value: string): value is SocialLoginProviderId =>
  SOCIAL_LOGIN_PROVIDER_IDS.some((provider) => provider === value);

const parseCommaSeparatedList = (value?: string): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parseAllowedSignupDomains = (value?: string): string[] => {
  const domains = new Set<string>();

  for (const entry of parseCommaSeparatedList(value)) {
    const domain = entry.toLowerCase().replace(/^@/, "");
    if (domain.length === 0) {
      continue;
    }
    domains.add(domain);
  }

  return [...domains];
};

const parseSocialLoginProviders = (value?: string): SocialLoginProviderId[] => {
  const entries = parseCommaSeparatedList(value);
  if (entries.length === 0) {
    return [];
  }

  const providers: SocialLoginProviderId[] = [];
  const seen = new Set<SocialLoginProviderId>();

  for (const entry of entries) {
    const provider = entry.toLowerCase();
    if (!isSocialLoginProviderId(provider)) {
      throw new Error(
        `Invalid SOCIAL_LOGIN_PROVIDERS value "${entry}". Allowed values: google, microsoft.`,
      );
    }

    if (seen.has(provider)) {
      continue;
    }

    seen.add(provider);
    providers.push(provider);
  }

  return providers;
};

const isSocialLoginEnabled = (
  provider: SocialLoginProviderId,
  socialLoginProviders?: readonly SocialLoginProviderId[],
): boolean => {
  if (!socialLoginProviders || socialLoginProviders.length === 0) {
    return true;
  }

  return socialLoginProviders.includes(provider);
};

const readEmailDomain = (email?: string): string | null => {
  if (!email) {
    return null;
  }

  const separator = email.lastIndexOf("@");
  if (separator === -1) {
    return null;
  }

  const domain = email.slice(separator + 1).trim().toLowerCase();
  if (domain.length === 0) {
    return null;
  }

  return domain;
};

const formatSignupDomainLimitMessage = (domains: readonly string[]): string =>
  `Sign-ups are limited to ${domains.join(", ")}`;

const isSignupEmailAllowed = (
  email: string | undefined,
  allowedSignupDomains: readonly string[],
): boolean => {
  if (allowedSignupDomains.length === 0) {
    return true;
  }

  const domain = readEmailDomain(email);
  if (!domain) {
    return false;
  }

  return allowedSignupDomains.includes(domain);
};

export {
  SOCIAL_LOGIN_PROVIDER_IDS,
  formatSignupDomainLimitMessage,
  isSignupEmailAllowed,
  isSocialLoginEnabled,
  parseAllowedSignupDomains,
  parseSocialLoginProviders,
};
export type { SocialLoginProviderId };
