import { KEEPER_CATEGORY } from "@keeper.sh/constants";

const DEFAULT_OUTLOOK_EVENT_CATEGORY_NAME = "Keeper";

const resolveOutlookEventCategoryName = (eventCategoryName?: string | null): string =>
  eventCategoryName ?? DEFAULT_OUTLOOK_EVENT_CATEGORY_NAME;

const buildOutlookEventCategories = (
  eventColor?: string | null,
  eventCategoryName?: string | null,
): string[] => {
  if (!eventColor) {
    return [KEEPER_CATEGORY];
  }

  return [resolveOutlookEventCategoryName(eventCategoryName), KEEPER_CATEGORY];
};

export {
  DEFAULT_OUTLOOK_EVENT_CATEGORY_NAME,
  buildOutlookEventCategories,
  resolveOutlookEventCategoryName,
};
