import { describe, expect, it } from "vitest";
import {
  getServerPublicRuntimeConfig,
  resolvePublicRuntimeConfig,
  serializePublicRuntimeConfig,
} from "../../src/lib/runtime-config";

describe("resolvePublicRuntimeConfig", () => {
  it("returns normalized runtime values", () => {
    const config = resolvePublicRuntimeConfig({
      operatorName: "Boca Pro",
      polarProMonthlyProductId: "prod-monthly",
      polarProYearlyProductId: "prod-yearly",
    });

    expect(config).toEqual({
      commercialMode: false,
      operatorName: "Boca Pro",
      polarProMonthlyProductId: "prod-monthly",
      polarProYearlyProductId: "prod-yearly",
    });
  });

  it("defaults operatorName when unset", () => {
    const config = resolvePublicRuntimeConfig({
      polarProMonthlyProductId: "prod-monthly",
      polarProYearlyProductId: "prod-yearly",
    });

    expect(config.operatorName).toBe("HeyJet, LLC");
  });

  it("treats missing runtime values as null", () => {
    const config = resolvePublicRuntimeConfig({
      polarProMonthlyProductId: "",
      polarProYearlyProductId: undefined,
    });

    expect(config).toEqual({
      commercialMode: false,
      operatorName: "HeyJet, LLC",
      polarProMonthlyProductId: null,
      polarProYearlyProductId: null,
    });
  });
});

describe("getServerPublicRuntimeConfig", () => {
  it("defaults operatorName when OPERATOR_NAME is unset", () => {
    const config = getServerPublicRuntimeConfig({ environment: {} });

    expect(config.operatorName).toBe("HeyJet, LLC");
  });

  it("reads OPERATOR_NAME from the environment", () => {
    const config = getServerPublicRuntimeConfig({
      environment: { OPERATOR_NAME: "Boca Pro" },
    });

    expect(config.operatorName).toBe("Boca Pro");
  });
});

describe("serializePublicRuntimeConfig", () => {
  it("serializes config for safe inline script injection", () => {
    const serialized = serializePublicRuntimeConfig({
      commercialMode: false,
      operatorName: "HeyJet, LLC",
      polarProMonthlyProductId: "</script><script>alert(1)</script>",
      polarProYearlyProductId: null,
    });

    expect(serialized).toContain("\"polarProMonthlyProductId\"");
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003C/script\\u003E");
  });
});
