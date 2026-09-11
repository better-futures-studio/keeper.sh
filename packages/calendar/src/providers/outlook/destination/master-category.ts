import { HTTP_STATUS } from "@keeper.sh/constants";
import { widelog } from "widelogger";
import { MICROSOFT_GRAPH_API } from "../shared/api";

interface OutlookMasterCategory {
  id: string;
  displayName: string;
  color: string;
}

interface OutlookMasterCategoryEnsureCache {
  categories: OutlookMasterCategory[] | null;
  forbidden: boolean;
}

type OutlookGraphSender = (url: URL, init: RequestInit) => Promise<Response>;

interface EnsureOutlookMasterCategoryOptions {
  send: OutlookGraphSender;
  headers: Record<string, string>;
  displayName: string;
  color: string;
  cache: OutlookMasterCategoryEnsureCache;
  onForbidden?: () => Promise<void>;
}

type MasterCategoryLookup =
  | { kind: "ok"; categories: OutlookMasterCategory[] }
  | { kind: "forbidden"; reason: string };

type MasterCategoryWrite =
  | { kind: "ok"; category?: OutlookMasterCategory }
  | { kind: "forbidden"; reason: string };

const MASTER_CATEGORIES_PATH = `${MICROSOFT_GRAPH_API}/me/outlook/masterCategories`;
const MAILBOX_SETTINGS_FORBIDDEN_REASON =
  "MailboxSettings.ReadWrite is missing; pushing events with categories anyway";

const createOutlookMasterCategoryCache = (): OutlookMasterCategoryEnsureCache => ({
  categories: null,
  forbidden: false,
});

const readGraphErrorReason = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (text.length > 0) {
    return text;
  }
  return response.statusText;
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const toStoredCategory = (value: unknown): OutlookMasterCategory | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = readOptionalString(record.id);
  const displayName = readOptionalString(record.displayName);
  const color = readOptionalString(record.color);
  if (!id || !displayName || !color) {
    return null;
  }
  return { color, displayName, id };
};

const readCategoryList = (value: unknown): OutlookMasterCategory[] => {
  if (typeof value !== "object" || value === null || !("value" in value)) {
    return [];
  }
  const listed = value.value;
  if (!Array.isArray(listed)) {
    return [];
  }
  const categories: OutlookMasterCategory[] = [];
  for (const category of listed) {
    const stored = toStoredCategory(category);
    if (stored) {
      categories.push(stored);
    }
  }
  return categories;
};

const markForbidden = async (
  options: EnsureOutlookMasterCategoryOptions,
  reason: string,
): Promise<void> => {
  options.cache.forbidden = true;
  widelog.set("outlook.master_category.forbidden", true);
  widelog.set("outlook.master_category.reason", reason);
  if (options.onForbidden) {
    await options.onForbidden();
  }
};

const listMasterCategories = async (
  options: EnsureOutlookMasterCategoryOptions,
): Promise<MasterCategoryLookup> => {
  const response = await options.send(new URL(MASTER_CATEGORIES_PATH), {
    headers: options.headers,
    method: "GET",
  });

  if (response.status === HTTP_STATUS.FORBIDDEN) {
    return {
      kind: "forbidden",
      reason: await readGraphErrorReason(response),
    };
  }

  if (!response.ok) {
    throw new Error(await readGraphErrorReason(response));
  }

  return { categories: readCategoryList(await response.json()), kind: "ok" };
};

const createMasterCategory = async (
  options: EnsureOutlookMasterCategoryOptions,
): Promise<MasterCategoryWrite> => {
  const response = await options.send(new URL(MASTER_CATEGORIES_PATH), {
    body: JSON.stringify({
      color: options.color,
      displayName: options.displayName,
    }),
    headers: options.headers,
    method: "POST",
  });

  if (response.status === HTTP_STATUS.FORBIDDEN) {
    return {
      kind: "forbidden",
      reason: await readGraphErrorReason(response),
    };
  }

  if (!response.ok) {
    throw new Error(await readGraphErrorReason(response));
  }

  const created = toStoredCategory(await response.json());
  if (created) {
    return { category: created, kind: "ok" };
  }
  return {
    category: {
      color: options.color,
      displayName: options.displayName,
      id: options.displayName,
    },
    kind: "ok",
  };
};

const patchMasterCategory = async (
  options: EnsureOutlookMasterCategoryOptions,
  categoryId: string,
): Promise<MasterCategoryWrite> => {
  const response = await options.send(
    new URL(`${MASTER_CATEGORIES_PATH}/${encodeURIComponent(categoryId)}`),
    {
      body: JSON.stringify({ color: options.color }),
      headers: options.headers,
      method: "PATCH",
    },
  );

  if (response.status === HTTP_STATUS.FORBIDDEN) {
    return {
      kind: "forbidden",
      reason: await readGraphErrorReason(response),
    };
  }

  if (!response.ok) {
    throw new Error(await readGraphErrorReason(response));
  }

  await response.body?.cancel?.();
  return { kind: "ok" };
};

const findCachedCategory = (
  categories: OutlookMasterCategory[],
  displayName: string,
): OutlookMasterCategory | undefined => {
  const normalizedName = displayName.toLowerCase();
  return categories.find((category) => category.displayName.toLowerCase() === normalizedName);
};

const ensureOutlookMasterCategory = async (
  options: EnsureOutlookMasterCategoryOptions,
): Promise<void> => {
  if (options.cache.forbidden) {
    return;
  }

  if (options.cache.categories === null) {
    const listed = await listMasterCategories(options);
    if (listed.kind === "forbidden") {
      await markForbidden(options, listed.reason || MAILBOX_SETTINGS_FORBIDDEN_REASON);
      return;
    }
    options.cache.categories = listed.categories;
  }

  const existing = findCachedCategory(options.cache.categories, options.displayName);
  if (!existing) {
    const created = await createMasterCategory(options);
    if (created.kind === "forbidden") {
      await markForbidden(options, created.reason || MAILBOX_SETTINGS_FORBIDDEN_REASON);
      return;
    }
    if (created.category) {
      options.cache.categories.push(created.category);
    }
    return;
  }

  if (existing.color === options.color) {
    return;
  }

  const patched = await patchMasterCategory(options, existing.id);
  if (patched.kind === "forbidden") {
    await markForbidden(options, patched.reason || MAILBOX_SETTINGS_FORBIDDEN_REASON);
    return;
  }
  existing.color = options.color;
};

export {
  MAILBOX_SETTINGS_FORBIDDEN_REASON,
  createOutlookMasterCategoryCache,
  ensureOutlookMasterCategory,
};
export type { OutlookMasterCategoryEnsureCache };
