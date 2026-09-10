import { describe, expect, it } from "vitest";
import {
  resolvePublicRuntimeConfig,
  serializePublicRuntimeConfig,
} from "../../src/lib/runtime-config";

describe("resolvePublicRuntimeConfig", () => {
  it("returns normalized runtime values", () => {
    const config = resolvePublicRuntimeConfig({
      polarProMonthlyProductId: "prod-monthly",
      polarProYearlyProductId: "prod-yearly",
    });

    expect(config).toEqual({
      commercialMode: false,
      polarProMonthlyProductId: "prod-monthly",
      polarProYearlyProductId: "prod-yearly",
    });
  });

  it("treats missing runtime values as null", () => {
    const config = resolvePublicRuntimeConfig({
      polarProMonthlyProductId: "",
      polarProYearlyProductId: undefined,
    });

    expect(config).toEqual({
      commercialMode: false,
      polarProMonthlyProductId: null,
      polarProYearlyProductId: null,
    });
  });
});

describe("serializePublicRuntimeConfig", () => {
  it("serializes config for safe inline script injection", () => {
    const serialized = serializePublicRuntimeConfig({
      commercialMode: false,
      polarProMonthlyProductId: "</script><script>alert(1)</script>",
      polarProYearlyProductId: null,
    });

    expect(serialized).toContain("\"polarProMonthlyProductId\"");
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003C/script\\u003E");
  });
});
