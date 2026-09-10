const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatMonthYear(isoDate: string): string {
  return monthYearFormatter.format(new Date(isoDate));
}

const STATIC_PAGE_UPDATED_AT = {
  "/privacy": "2026-08-14",
  "/terms": "2025-12-01",
} as const satisfies Record<string, string>;

export type StaticPagePath = keyof typeof STATIC_PAGE_UPDATED_AT;

export function pageUpdatedAt(path: StaticPagePath): string {
  return STATIC_PAGE_UPDATED_AT[path];
}
