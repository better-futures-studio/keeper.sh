interface PublicRuntimeConfig {
  commercialMode: boolean;
  polarProMonthlyProductId: string | null;
  polarProYearlyProductId: string | null;
}

interface RuntimeConfigSource {
  commercialMode?: boolean | null;
  polarProMonthlyProductId?: string | null;
  polarProYearlyProductId?: string | null;
}

const normalizeOptionalValue = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
};

interface ServerRuntimeConfigOptions {
  environment: Record<string, string | undefined>;
}

const getServerPublicRuntimeConfig = (
  options: ServerRuntimeConfigOptions,
): PublicRuntimeConfig => {
  const { environment } = options;

  return {
    commercialMode: environment.COMMERCIAL_MODE === "true",
    polarProMonthlyProductId: normalizeOptionalValue(environment.POLAR_PRO_MONTHLY_PRODUCT_ID),
    polarProYearlyProductId: normalizeOptionalValue(environment.POLAR_PRO_YEARLY_PRODUCT_ID),
  };
};

const getWindowPublicRuntimeConfig = (): RuntimeConfigSource => {
  if (typeof window === "undefined") {
    return {};
  }

  return window.__KEEPER_RUNTIME_CONFIG__ ?? {};
};

const resolvePublicRuntimeConfig = (source: RuntimeConfigSource): PublicRuntimeConfig => ({
  commercialMode: source.commercialMode === true,
  polarProMonthlyProductId: normalizeOptionalValue(source.polarProMonthlyProductId),
  polarProYearlyProductId: normalizeOptionalValue(source.polarProYearlyProductId),
});

const getPublicRuntimeConfig = (): PublicRuntimeConfig => resolvePublicRuntimeConfig(
  getWindowPublicRuntimeConfig(),
);

const serializePublicRuntimeConfig = (config: PublicRuntimeConfig): string =>
  JSON.stringify(config)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026");

declare global {
  interface Window {
    __KEEPER_RUNTIME_CONFIG__?: RuntimeConfigSource;
  }
}

export {
  getPublicRuntimeConfig,
  getServerPublicRuntimeConfig,
  resolvePublicRuntimeConfig,
  serializePublicRuntimeConfig,
};
export type { PublicRuntimeConfig, RuntimeConfigSource };
