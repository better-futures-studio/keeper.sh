import { describe, expect, it } from "vitest";
import {
  EVENT_COLOR_UNSUPPORTED_MESSAGE,
  normalizeEventCategoryName,
  validateDestinationEventAppearance,
} from "../../src/utils/destination-event-color";

describe("validateDestinationEventAppearance", () => {
  it("accepts Google Calendar event color ids 1 through 11", () => {
    expect(validateDestinationEventAppearance("google", { eventColor: "1" })).toBeNull();
    expect(validateDestinationEventAppearance("google", { eventColor: "11" })).toBeNull();
    expect(validateDestinationEventAppearance("google", { eventColor: null })).toBeNull();
  });

  it("rejects Google colors outside the palette", () => {
    expect(validateDestinationEventAppearance("google", { eventColor: "12" })).toEqual({
      message: "Invalid event color for this calendar",
    });
    expect(validateDestinationEventAppearance("google", { eventColor: "preset0" })).toEqual({
      message: "Invalid event color for this calendar",
    });
  });

  it("rejects a category name on Google", () => {
    expect(validateDestinationEventAppearance("google", { eventCategoryName: "Work" })).toEqual({
      message: EVENT_COLOR_UNSUPPORTED_MESSAGE,
    });
  });

  it("accepts Outlook preset colors and a trimmed category name", () => {
    expect(validateDestinationEventAppearance("outlook", { eventColor: "preset0" })).toBeNull();
    expect(validateDestinationEventAppearance("outlook", { eventColor: "preset24" })).toBeNull();
    expect(validateDestinationEventAppearance("outlook", {
      eventCategoryName: "Work blocks",
      eventColor: "preset8",
    })).toBeNull();
    expect(validateDestinationEventAppearance("outlook", { eventCategoryName: null })).toBeNull();
  });

  it("rejects Outlook colors outside the preset range", () => {
    expect(validateDestinationEventAppearance("outlook", { eventColor: "preset25" })).toEqual({
      message: "Invalid event color for this calendar",
    });
    expect(validateDestinationEventAppearance("outlook", { eventColor: "7" })).toEqual({
      message: "Invalid event color for this calendar",
    });
  });

  it("rejects an empty or oversized Outlook category name", () => {
    expect(validateDestinationEventAppearance("outlook", { eventCategoryName: "   " })).toEqual({
      message: "Event category name must be between 1 and 64 characters",
    });
    expect(validateDestinationEventAppearance("outlook", {
      eventCategoryName: "x".repeat(65),
    })).toEqual({
      message: "Event category name must be between 1 and 64 characters",
    });
  });

  it("rejects event color on CalDAV, iCloud, Fastmail, and ICS", () => {
    for (const provider of ["caldav", "icloud", "fastmail", "ics"]) {
      expect(validateDestinationEventAppearance(provider, { eventColor: "1" })).toEqual({
        message: EVENT_COLOR_UNSUPPORTED_MESSAGE,
      });
      expect(validateDestinationEventAppearance(provider, { eventColor: null })).toEqual({
        message: EVENT_COLOR_UNSUPPORTED_MESSAGE,
      });
    }
  });
});

describe("normalizeEventCategoryName", () => {
  it("trims a supplied name and leaves null alone", () => {
    expect(normalizeEventCategoryName("  Keeper  ")).toBe("Keeper");
    expect(normalizeEventCategoryName(null)).toBeNull();
  });
});
