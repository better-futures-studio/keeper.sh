import { describe, expect, it } from "vitest";
import { handlePatchSourceRoute } from "../../../../../src/routes/api/sources/[id]/source-item-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

describe("handlePatchSourceRoute", () => {
  it("returns 400 when id param is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: {}, params: {}, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when no valid fields are provided", async () => {
    const response = await handlePatchSourceRoute(
      { body: { unknown: true }, params: { id: "source-1" }, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when source update target is missing", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { name: "Updated Name" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when free users update the event name template", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { customEventName: "{{calendar_name}}" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "This setting requires a Pro plan.",
    });
  });

  it("returns updated source for valid name update", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { name: "Updated Name" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns updated source for exclusion filter update", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeEventDescription: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns 403 when free users update full-day timed event interpretation", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { treatFullDayTimedEventsAsAllDay: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "This setting requires a Pro plan.",
    });
  });

  it("passes sync range updates through for Pro users", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { syncFutureRange: "12_months", syncHistoricRange: "3_months" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({
      syncFutureRange: "12_months",
      syncHistoricRange: "3_months",
    });
  });

  it("returns 403 when free users try to set markEventsAsPrivate", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { markEventsAsPrivate: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });

  it("passes hidden through without a Pro gate", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { hidden: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({ hidden: true });
  });

  it("passes hidden false through so showing can reset ingest", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { hidden: false },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({ hidden: false });
  });

  it("returns 400 when event color is set on an unsupported provider", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { eventColor: "7" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceProvider: () => Promise.resolve("caldav"),
        updateSource: () => Promise.resolve({ id: "source-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      message: "Event color is not supported for this calendar",
    });
  });

  it("returns 400 when Google receives an Outlook preset color", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { eventColor: "preset8" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceProvider: () => Promise.resolve("google"),
        updateSource: () => Promise.resolve({ id: "source-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      message: "Invalid event color for this calendar",
    });
  });

  it("returns 400 when Outlook receives a category name on another provider", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { eventCategoryName: "Work" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceProvider: () => Promise.resolve("google"),
        updateSource: () => Promise.resolve({ id: "source-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      message: "Event color is not supported for this calendar",
    });
  });

  it("passes a Google event color through without a Pro gate", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { eventColor: "7" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceProvider: () => Promise.resolve("google"),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({ eventColor: "7" });
  });

  it("trims and persists an Outlook category name", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { eventCategoryName: "  Work blocks  ", eventColor: "preset8" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceProvider: () => Promise.resolve("outlook"),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({
      eventCategoryName: "Work blocks",
      eventColor: "preset8",
    });
  });

  it("clears event color when null is sent", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { eventColor: null },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceProvider: () => Promise.resolve("outlook"),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({ eventColor: null });
  });

  it("returns updated source when pro user sets markEventsAsPrivate", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { markEventsAsPrivate: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });
});
