interface PublicRuntimeConfig {
  commercialMode: boolean;
  operatorName: string;
  polarProMonthlyProductId: string | null;
  polarProYearlyProductId: string | null;
}

interface RuntimeConfigSource {
  commercialMode?: boolean | null;
  operatorName?: string | null;
  polarProMonthlyProductId?: string | null;
  polarProYearlyProductId?: string | null;
}

const DEFAULT_OPERATOR_NAME = "HeyJet, LLC";

const normalizeOptionalValue = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
};

const normalizeOperatorName = (value: string | null | undefined): string => {
  if (typeof value !== "string" || value.length === 0) {
    return DEFAULT_OPERATOR_NAME;
  }

  return value;
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
    operatorName: normalizeOperatorName(environment.OPERATOR_NAME),
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
  operatorName: normalizeOperatorName(source.operatorName),
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
