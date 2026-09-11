import { describe, expect, it, vi } from "vitest";
import { HTTP_STATUS } from "@keeper.sh/constants";
import {
  createOutlookMasterCategoryCache,
  ensureOutlookMasterCategory,
} from "../../../../src/providers/outlook/destination/master-category";

const MASTER_CATEGORIES_URL = "https://graph.microsoft.com/v1.0/me/outlook/masterCategories";
const HEADERS = {
  Authorization: "Bearer test-token",
  "Content-Type": "application/json",
};

const jsonResponse = (body: unknown, status = HTTP_STATUS.OK): Response =>
  Response.json(body, { status });

describe("ensureOutlookMasterCategory", () => {
  it("creates a missing master category after listing once", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({
        color: "preset8",
        displayName: "Keeper",
        id: "category-1",
      }));
    const cache = createOutlookMasterCategoryCache();

    await ensureOutlookMasterCategory({
      cache,
      color: "preset8",
      displayName: "Keeper",
      headers: HEADERS,
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(String(send.mock.calls[0]?.[0])).toBe(MASTER_CATEGORIES_URL);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ color: "preset8", displayName: "Keeper" }),
      method: "POST",
    });
  });

  it("patches an existing category when the color differs", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        value: [{ color: "preset0", displayName: "Keeper", id: "category-1" }],
      }))
      .mockResolvedValueOnce(new Response(null, { status: HTTP_STATUS.OK }));
    const cache = createOutlookMasterCategoryCache();

    await ensureOutlookMasterCategory({
      cache,
      color: "preset8",
      displayName: "Keeper",
      headers: HEADERS,
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(String(send.mock.calls[1]?.[0])).toBe(`${MASTER_CATEGORIES_URL}/category-1`);
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ color: "preset8" }),
      method: "PATCH",
    });
  });

  it("does not write when the listed category already has the color", async () => {
    const send = vi.fn().mockResolvedValueOnce(jsonResponse({
      value: [{ color: "preset8", displayName: "Keeper", id: "category-1" }],
    }));
    const cache = createOutlookMasterCategoryCache();

    await ensureOutlookMasterCategory({
      cache,
      color: "preset8",
      displayName: "Keeper",
      headers: HEADERS,
      send,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("reuses the listed categories for a second ensure in the same push run", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({
        color: "preset8",
        displayName: "Keeper",
        id: "category-1",
      }));
    const cache = createOutlookMasterCategoryCache();
    const options = {
      cache,
      color: "preset8",
      displayName: "Keeper",
      headers: HEADERS,
      send,
    };

    await ensureOutlookMasterCategory(options);
    await ensureOutlookMasterCategory(options);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not fail the sync on 403 and flags the account once", async () => {
    const send = vi.fn().mockResolvedValue(
      new Response("MailboxSettings.ReadWrite is required", { status: HTTP_STATUS.FORBIDDEN }),
    );
    const onForbidden = vi.fn(() => Promise.resolve());
    const cache = createOutlookMasterCategoryCache();

    await expect(ensureOutlookMasterCategory({
      cache,
      color: "preset8",
      displayName: "Keeper",
      headers: HEADERS,
      onForbidden,
      send,
    })).resolves.toBeUndefined();
    await expect(ensureOutlookMasterCategory({
      cache,
      color: "preset2",
      displayName: "Work",
      headers: HEADERS,
      onForbidden,
      send,
    })).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledOnce();
    expect(onForbidden).toHaveBeenCalledOnce();
    expect(cache.forbidden).toBe(true);
  });
});
