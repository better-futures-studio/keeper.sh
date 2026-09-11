const GOOGLE_EVENT_COLOR_COUNT = 11;
const OUTLOOK_EVENT_COLOR_COUNT = 25;
const OUTLOOK_EVENT_CATEGORY_NAME_MAX_LENGTH = 64;
const EVENT_COLOR_UNSUPPORTED_MESSAGE = "Event color is not supported for this calendar";

const googleEventColorIds: string[] = [];
for (let colorId = 1; colorId <= GOOGLE_EVENT_COLOR_COUNT; colorId += 1) {
  googleEventColorIds.push(String(colorId));
}
const GOOGLE_EVENT_COLOR_IDS = new Set(googleEventColorIds);

const outlookEventColorPresets: string[] = [];
for (let presetIndex = 0; presetIndex < OUTLOOK_EVENT_COLOR_COUNT; presetIndex += 1) {
  outlookEventColorPresets.push(`preset${presetIndex}`);
}
const OUTLOOK_EVENT_COLOR_PRESETS = new Set(outlookEventColorPresets);

interface DestinationEventColorPatch {
  eventColor?: string | null;
  eventCategoryName?: string | null;
}

interface DestinationEventColorValidationFailure {
  message: string;
}

const isGoogleEventColor = (value: string): boolean => GOOGLE_EVENT_COLOR_IDS.has(value);
const isOutlookEventColor = (value: string): boolean => OUTLOOK_EVENT_COLOR_PRESETS.has(value);

const validateEventCategoryName = (
  provider: string,
  eventCategoryName: string | null,
): DestinationEventColorValidationFailure | null => {
  if (provider !== "outlook") {
    return { message: EVENT_COLOR_UNSUPPORTED_MESSAGE };
  }
  if (eventCategoryName === null) {
    return null;
  }
  const trimmed = eventCategoryName.trim();
  if (trimmed.length === 0 || trimmed.length > OUTLOOK_EVENT_CATEGORY_NAME_MAX_LENGTH) {
    return { message: "Event category name must be between 1 and 64 characters" };
  }
  return null;
};

const validateEventColor = (
  provider: string,
  eventColor: string | null,
): DestinationEventColorValidationFailure | null => {
  if (eventColor === null) {
    if (provider === "google" || provider === "outlook") {
      return null;
    }
    return { message: EVENT_COLOR_UNSUPPORTED_MESSAGE };
  }
  if (provider === "google" && isGoogleEventColor(eventColor)) {
    return null;
  }
  if (provider === "outlook" && isOutlookEventColor(eventColor)) {
    return null;
  }
  if (provider === "google" || provider === "outlook") {
    return { message: "Invalid event color for this calendar" };
  }
  return { message: EVENT_COLOR_UNSUPPORTED_MESSAGE };
};

const normalizeEventCategoryName = (eventCategoryName: string | null): string | null => {
  if (eventCategoryName === null) {
    return null;
  }
  return eventCategoryName.trim();
};

const validateDestinationEventAppearance = (
  provider: string,
  patch: DestinationEventColorPatch,
): DestinationEventColorValidationFailure | null => {
  if ("eventColor" in patch) {
    const colorFailure = validateEventColor(provider, patch.eventColor ?? null);
    if (colorFailure) {
      return colorFailure;
    }
  }
  if ("eventCategoryName" in patch) {
    return validateEventCategoryName(provider, patch.eventCategoryName ?? null);
  }
  return null;
};

export {
  EVENT_COLOR_UNSUPPORTED_MESSAGE,
  GOOGLE_EVENT_COLOR_IDS,
  OUTLOOK_EVENT_CATEGORY_NAME_MAX_LENGTH,
  OUTLOOK_EVENT_COLOR_PRESETS,
  normalizeEventCategoryName,
  validateDestinationEventAppearance,
};
export type { DestinationEventColorPatch, DestinationEventColorValidationFailure };
