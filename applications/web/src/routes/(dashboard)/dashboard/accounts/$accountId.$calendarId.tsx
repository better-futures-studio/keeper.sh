import { use, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { useAtomValue, useStore } from "jotai";
import type { SyncRange } from "@keeper.sh/data-schemas";
import { useEntitlements, useMutateEntitlements, canAddMore } from "@/hooks/use-entitlements";
import { BackButton } from "@/components/ui/primitives/back-button";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import { MenuHint, PremiumHint, PremiumGate } from "@/components/ui/primitives/menu-hint";
import { Pagination, PaginationPrevious, PaginationNext } from "@/components/ui/primitives/pagination";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { useReauthAccounts } from "@/features/dashboard/components/reauth/use-reauth-accounts";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { serializedPatch, serializedCall } from "@/lib/serialized-mutate";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { formatDate } from "@/lib/time";
import { resolveErrorMessage } from "@/utils/errors";
import { canPull, canPush } from "@/utils/calendars";
import { cn } from "@/utils/cn";
import { Input } from "@/components/ui/primitives/input";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "@/types/api";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuLinkItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import {
  NavigationMenuEditableItem,
  NavigationMenuEditableTemplateItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { MenuVariantContext, ItemDisabledContext, usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemStyle,
  navigationMenuCheckbox,
  navigationMenuCheckboxIcon,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
} from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import { Text } from "@/components/ui/primitives/text";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import {
  calendarDetailAtom,
  calendarDetailLoadedAtom,
  calendarDetailErrorAtom,
  calendarNameAtom,
  calendarProviderAtom,
  calendarProviderMissingSinceAtom,
  calendarTypeAtom,
  customEventNameAtom,
  eventCategoryNameAtom,
  eventColorAtom,
  excludeEventNameAtom,
  excludeFieldAtoms,
  treatFullDayTimedEventsAsAllDayAtom,
} from "@/state/calendar-detail";
import type { ExcludeField } from "@/state/calendar-detail";
import {
  destinationIdsAtom,
  selectDestinationInclusion,
} from "@/state/destination-ids";
import {
  getSyncRangeLabel,
  SYNC_RANGE_OPTIONS,
} from "@/features/dashboard/components/sync-range-options";


export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId",
)({
  component: CalendarDetailPage,
});

interface SyncSetting {
  field: ExcludeField;
  label: string;
  matchesField: boolean;
}

const SYNC_SETTINGS: SyncSetting[] = [
  { field: "excludeEventDescription", label: "Sync Event Description", matchesField: false },
  { field: "excludeEventLocation", label: "Sync Event Location", matchesField: false },
  { field: "markEventsAsPrivate", label: "Mark Events as Private", matchesField: true },
];

const EXCLUSION_SETTINGS: SyncSetting[] = [
  { field: "excludeAllDayEvents", label: "Exclude All Day Events", matchesField: true },
];

const PROVIDER_EXCLUSION_SETTINGS: SyncSetting[] = [
  { field: "excludeFocusTime", label: "Exclude Focus Time Events", matchesField: true },
  { field: "excludeOutOfOffice", label: "Exclude Out of Office Events", matchesField: true },
];

const PROVIDERS_WITH_EXTRA_SETTINGS = new Set(["google"]);

interface EventColorOption {
  value: string;
  name: string;
  hex: string;
}

const GOOGLE_EVENT_COLORS: EventColorOption[] = [
  { value: "1", name: "Lavender", hex: "#7986cb" },
  { value: "2", name: "Sage", hex: "#33b679" },
  { value: "3", name: "Grape", hex: "#8e24aa" },
  { value: "4", name: "Flamingo", hex: "#e67c73" },
  { value: "5", name: "Banana", hex: "#f6bf26" },
  { value: "6", name: "Tangerine", hex: "#f4511e" },
  { value: "7", name: "Peacock", hex: "#039be5" },
  { value: "8", name: "Graphite", hex: "#616161" },
  { value: "9", name: "Blueberry", hex: "#3f51b5" },
  { value: "10", name: "Basil", hex: "#0b8043" },
  { value: "11", name: "Tomato", hex: "#d50000" },
];

const OUTLOOK_EVENT_COLORS: EventColorOption[] = [
  { value: "preset0", name: "Red", hex: "#e74856" },
  { value: "preset1", name: "Orange", hex: "#ff8c00" },
  { value: "preset2", name: "Peach", hex: "#ffab45" },
  { value: "preset3", name: "Yellow", hex: "#fff100" },
  { value: "preset4", name: "Green", hex: "#47d041" },
  { value: "preset5", name: "Teal", hex: "#30c6cc" },
  { value: "preset6", name: "Olive", hex: "#73aa24" },
  { value: "preset7", name: "Blue", hex: "#00bcf2" },
  { value: "preset8", name: "Purple", hex: "#8764b8" },
  { value: "preset9", name: "Maroon", hex: "#f495bf" },
  { value: "preset10", name: "Steel", hex: "#a0aeb2" },
  { value: "preset11", name: "Dark Steel", hex: "#004b60" },
  { value: "preset12", name: "Gray", hex: "#b1adab" },
  { value: "preset13", name: "Dark Gray", hex: "#5d5a58" },
  { value: "preset14", name: "Black", hex: "#000000" },
  { value: "preset15", name: "Dark Red", hex: "#750b1c" },
  { value: "preset16", name: "Dark Orange", hex: "#ca5010" },
  { value: "preset17", name: "Dark Peach", hex: "#ab620d" },
  { value: "preset18", name: "Dark Yellow", hex: "#c19c00" },
  { value: "preset19", name: "Dark Green", hex: "#004b1c" },
  { value: "preset20", name: "Dark Teal", hex: "#004b50" },
  { value: "preset21", name: "Dark Olive", hex: "#0b6a0b" },
  { value: "preset22", name: "Dark Blue", hex: "#002050" },
  { value: "preset23", name: "Dark Purple", hex: "#32145a" },
  { value: "preset24", name: "Dark Maroon", hex: "#5c005c" },
];

function patchSource(
  store: ReturnType<typeof useStore>,
  calendarId: string,
  patch: Record<string, unknown>,
) {
  const swrKey = `/api/sources/${calendarId}`;
  serializedPatch(
    swrKey,
    patch,
    (mergedPatch) => {
      return apiFetch(swrKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedPatch),
      });
    },
    () => {
      fetcher<CalendarDetail>(swrKey).then((serverState) => {
        store.set(calendarDetailAtom, serverState);
      });
    },
  );
}

function useSeedCalendarDetail(calendarId: string, calendar: CalendarDetail | undefined) {
  const store = useStore();

  useEffect(() => {
    if (!calendar) return;
    if (store.get(calendarDetailLoadedAtom) === calendarId) return;

    store.set(calendarDetailAtom, calendar);
    store.set(calendarDetailLoadedAtom, calendarId);
    store.set(calendarDetailErrorAtom, null);
  }, [calendarId, calendar, store]);
}

function CalendarDetailPage() {
  const { accountId, calendarId } = Route.useParams();
  const { data: account, isLoading: accountLoading, error: accountError, mutate: mutateAccount } = useSWR<CalendarAccount>(`/api/accounts/${accountId}`);
  const { data: calendar, isLoading: calendarLoading, error: calendarError } = useSWR<CalendarDetail>(`/api/sources/${calendarId}`);
  const { mutate: mutateCalendar } = useSWRConfig();

  useSeedCalendarDetail(calendarId, calendar);
  const needsReauth = useReauthAccounts().some((entry) => entry.id === accountId);

  const isLoading = accountLoading || calendarLoading;
  const error = accountError || calendarError;

  if (error || isLoading || !account || !calendar) {
    if (error) return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="error" onRetry={async () => { await Promise.all([mutateAccount(), mutateCalendar(`/api/sources/${calendarId}`)]); }} />;
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="loading" />;
  }

  const isPullCapable = canPull(calendar);
  const isPushCapable = canPush(calendar);

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <div className="flex items-center justify-between">
          <BackButton fallback={`/dashboard/accounts/${accountId}`} />
          <CalendarPrevNext calendarId={calendarId} />
        </div>
        <CalendarHeader account={account} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        <ReauthNotice account={account} />
        <ProviderMissingNotice />
        <RenameSection calendarId={calendarId} />
        {isPullCapable && (
          <>
            <DashboardSection
              title="Send Events to Calendars"
              description="Select which calendars should receive events from this calendar."
            />
            <DestinationsSection calendarId={calendarId} />
          </>
        )}
        {isPushCapable && <SyncWindowSection calendarId={calendarId} />}
        {(isPullCapable || isPushCapable) && (
          <SyncSettingsSection calendarId={calendarId} calendar={calendar} needsReauth={needsReauth} />
        )}
        {isPullCapable && <ExclusionsSection calendarId={calendarId} provider={calendar.provider} />}
        <CalendarInfoSection account={account} accountId={accountId} />
        {!isPushCapable && <DeleteCalendarSection accountId={accountId} calendarId={calendarId} />}
      </PageBody>
    </div>
  );
}

type SyncRangeField = "syncHistoricRange" | "syncFutureRange";

function SyncWindowSection({ calendarId }: { calendarId: string }) {
  const { data: entitlements } = useEntitlements();
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const disabled = !entitlements || locked;

  return (
    <>
      <DashboardSection
        title="Sync Window"
        description="Choose how far back and ahead Keeper syncs events into this calendar. Narrowing a range removes already-synced events outside it from this calendar."
      />
      <PremiumGate locked={locked} hint="Custom sync windows are a Pro feature.">
        <NavigationMenu>
          <SyncRangeItem
            calendarId={calendarId}
            field="syncHistoricRange"
            label="Sync Historic Events"
            locked={disabled}
          />
          <SyncRangeItem
            calendarId={calendarId}
            field="syncFutureRange"
            label="Sync Future Events"
            locked={disabled}
          />
        </NavigationMenu>
      </PremiumGate>
    </>
  );
}

function SyncRangeItem({
  calendarId,
  field,
  label,
  locked,
}: {
  calendarId: string;
  field: SyncRangeField;
  label: string;
  locked: boolean;
}) {
  const store = useStore();
  const calendar = useAtomValue(calendarDetailAtom);
  const loadedCalendarId = useAtomValue(calendarDetailLoadedAtom);

  if (!calendar || loadedCalendarId !== calendarId) {
    return null;
  }

  const selectedRange = calendar[field];

  const selectRange = (range: SyncRange) => {
    if (locked || range === selectedRange) {
      return;
    }

    store.set(calendarDetailAtom, (previous) => (
      previous ? { ...previous, [field]: range } : previous
    ));
    patchSource(store, calendarId, { [field]: range });
  };

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <>
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone={locked ? "disabled" : "muted"}>
              {getSyncRangeLabel(selectedRange)}
            </Text>
          </NavigationMenuItemTrailing>
        </>
      }
    >
      {SYNC_RANGE_OPTIONS.map((option) => (
        <SyncRangeOptionItem
          key={option.value}
          option={option}
          selected={option.value === selectedRange}
          onSelect={selectRange}
        />
      ))}
    </NavigationMenuPopover>
  );
}

function SyncRangeOptionItem({
  option,
  selected,
  onSelect,
}: {
  option: (typeof SYNC_RANGE_OPTIONS)[number];
  selected: boolean;
  onSelect: (range: SyncRange) => void;
}) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem
      onClick={() => {
        onSelect(option.value);
        close();
      }}
    >
      <NavigationMenuItemLabel>{option.label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {selected && <CheckIcon size={14} />}
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

function CalendarPrevNext({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const calendars = allCalendars ?? [];

  const currentIndex = calendars.findIndex((c) => c.id === calendarId);
  const prev = currentIndex > 0 ? calendars[currentIndex - 1] : null;
  const next = currentIndex < calendars.length - 1 ? calendars[currentIndex + 1] : null;

  useEffect(() => {
    if (prev) preload(`/api/sources/${prev.id}`, fetcher);
    if (next) preload(`/api/sources/${next.id}`, fetcher);
  }, [prev, next]);

  const toCalendar = (c: CalendarSource) => `/dashboard/accounts/${c.accountId}/${c.id}`;

  return (
    <Pagination>
      <PaginationPrevious to={prev ? toCalendar(prev) : undefined} />
      <PaginationNext to={next ? toCalendar(next) : undefined} />
    </Pagination>
  );
}

function CalendarHeader({ account }: { account: CalendarAccount }) {
  const provider = useAtomValue(calendarProviderAtom);
  const calendarType = useAtomValue(calendarTypeAtom);

  return (
    <div className="flex flex-col px-0.5 pt-4">
      <CalendarTitle />
      <div className="flex items-center gap-1.5 pt-0.5">
        <ProviderIcon provider={provider} calendarType={calendarType} size={14} />
        <Text className="truncate overflow-hidden" size="sm" tone="muted">{account.accountLabel}</Text>
      </div>
    </div>
  );
}

function CalendarTitle() {
  const name = useAtomValue(calendarNameAtom);
  return <DashboardHeading1 className="select-none">{name}</DashboardHeading1>;
}

function RenameSection({ calendarId }: { calendarId: string }) {
  return (
    <>
      <DashboardSection
        title="Calendar Name"
        description="Click below to rename the calendar within Keeper.sh. This does not affect the calendar outside of the Keeper.sh ecosystem."
      />
      <NavigationMenu>
        <RenameItem calendarId={calendarId} />
      </NavigationMenu>
    </>
  );
}

function RenameItem({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const name = useAtomValue(calendarNameAtom);

  return (
    <NavigationMenuEditableItem
      value={name}
      onCommit={(newName) => {
        store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, name: newName } : prev));
        patchSource(store, calendarId, { name: newName });
      }}
    >
      <RenameItemValue />
    </NavigationMenuEditableItem>
  );
}

function RenameItemValue() {
  const name = useAtomValue(calendarNameAtom);
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);

  return (
    <Text
      size="sm"
      tone={(disabled ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]}
      className="min-w-0 truncate"
    >
      {name}
    </Text>
  );
}

/** Leads the page when the owning account has lost authorization; this calendar cannot sync until it is restored. */
function ReauthNotice({ account }: { account: CalendarAccount }) {
  const needsReauth = useReauthAccounts().some((entry) => entry.id === account.id);
  if (!needsReauth) return null;

  return (
    <>
      <NavigationMenu variant="attention">
        <NavigationMenuLinkItem to={`/dashboard/accounts/${account.id}/reconnect`}>
          <NavigationMenuItemIcon>
            <TriangleAlert size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Reconnect 1 Account</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
      <MenuHint>
        Authorization for this account has been lost. This calendar will drift out of date until
        access is restored.
      </MenuHint>
    </>
  );
}

function ProviderMissingNotice() {
  const providerMissingSince = useAtomValue(calendarProviderMissingSinceAtom);
  if (!providerMissingSince) return null;

  return (
    <Text size="sm" tone="danger" className="px-0.5">
      This calendar was not found the last time its connection was refreshed
      (since {formatDate(providerMissingSince)}) - it may have been deleted or renamed at the
      provider. Refresh the connection again to confirm, or remove the calendar below.
    </Text>
  );
}

function DeleteCalendarSection({ accountId, calendarId }: { accountId: string; calendarId: string }) {
  const { mutate: globalMutate } = useSWRConfig();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDelete = () => {
    setDeleteError(null);

    startDeleteTransition(async () => {
      try {
        await apiFetch(`/api/sources/${calendarId}`, { method: "DELETE" });
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
        navigate({ to: `/dashboard/accounts/${accountId}` });
      } catch (err) {
        setDeleteError(resolveErrorMessage(err, "Failed to delete calendar."));
      }
    });
  };

  return (
    <>
      <DashboardSection
        title="Remove Calendar"
        description="Stop syncing this calendar and remove it from Keeper.sh. It will be re-imported the next time you refresh the account's calendars, unless it no longer exists at the provider."
      />
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
          <Text size="sm" tone="danger">Delete Calendar</Text>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {deleteError && <Text size="sm" tone="danger" className="px-0.5">{deleteError}</Text>}
      <DeleteConfirmation
        title="Delete this calendar?"
        description="This removes the calendar and its sync history from Keeper.sh. Any sync profiles using it will be affected."
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

function DestinationsSeed({ calendarId }: { calendarId: string }) {
  const { data } = useSWR<{ destinationIds: string[] }>(
    `/api/sources/${calendarId}/destinations`,
  );
  const store = useStore();

  useEffect(() => {
    store.set(destinationIdsAtom, new Set(data?.destinationIds));
  }, [calendarId, data, store]);

  return null;
}

function DestinationsSection({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.mappings);

  const pushCalendars = useMemo(
    () => (allCalendars ?? []).filter((calendar) => canPush(calendar) && !calendar.hidden && calendar.id !== calendarId),
    [allCalendars, calendarId],
  );

  return (
    <>
      <DestinationsSeed calendarId={calendarId} />
      <NavigationMenu>
        {pushCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No destination calendars available</NavigationMenuEmptyItem>
        ) : (
          pushCalendars.map((calendar) => (
            <DestinationCheckboxItem
              key={calendar.id}
              calendarId={calendarId}
              destinationId={calendar.id}
              name={calendar.name}
              provider={calendar.provider}
              calendarType={calendar.calendarType}
            />
          ))
        )}
      </NavigationMenu>
      {atLimit && <PremiumHint>Mapping limit reached.</PremiumHint>}
    </>
  );
}

function DestinationCheckboxItem({
  calendarId,
  destinationId,
  name,
  provider,
  calendarType,
}: {
  calendarId: string;
  destinationId: string;
  name: string;
  provider: string;
  calendarType: string;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();
  const { data: entitlements } = useEntitlements();
  const { adjustMappingCount, revalidateEntitlements } = useMutateEntitlements();

  const checkedAtom = useMemo(() => selectDestinationInclusion(destinationId), [destinationId]);
  const checked = useAtomValue(checkedAtom);
  const atLimit = !canAddMore(entitlements?.mappings);
  const disabled = atLimit && !checked;

  const handleClick = () => {
    if (disabled) return;

    const currentIds = store.get(destinationIdsAtom);
    const willCheck = !currentIds.has(destinationId);
    const updatedSet = new Set(currentIds);

    if (willCheck) {
      updatedSet.add(destinationId);
      adjustMappingCount(1);
    } else {
      updatedSet.delete(destinationId);
      adjustMappingCount(-1);
    }

    store.set(destinationIdsAtom, updatedSet);

    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () => {
      const latestIds = Array.from(store.get(destinationIdsAtom));
      return mutate(
        swrKey,
        async () => {
          await apiFetch(swrKey, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendarIds: latestIds }),
          });
          return { destinationIds: latestIds };
        },
        {
          optimisticData: { destinationIds: latestIds },
          rollbackOnError: true,
          revalidate: false,
        },
      ).catch(() => {
        void mutate(swrKey);
      }).finally(() => {
        void revalidateEntitlements();
      });
    });
  };

  return (
    <li>
      <ItemDisabledContext value={disabled}>
        <button
          type="button"
          role="checkbox"
          disabled={disabled}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !disabled })}
        >
          <NavigationMenuItemIcon>
            <ProviderIcon provider={provider} calendarType={calendarType} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{name}</NavigationMenuItemLabel>
          <DestinationCheckboxIndicator destinationId={destinationId} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function DestinationCheckboxIndicator({ destinationId }: { destinationId: string }) {
  const checkedAtom = useMemo(() => selectDestinationInclusion(destinationId), [destinationId]);
  const checked = useAtomValue(checkedAtom);
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuCheckbox({ variant, checked, className: "ml-auto" })}>
      {checked && <CheckIcon size={12} className={navigationMenuCheckboxIcon({ variant })} />}
    </div>
  );
}

function SyncSettingsSection({
  calendarId,
  calendar,
  needsReauth,
}: {
  calendarId: string;
  calendar: CalendarDetail;
  needsReauth: boolean;
}) {
  const { data: entitlements } = useEntitlements();
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const calendarType = useAtomValue(calendarTypeAtom);
  const isPullCapable = canPull(calendar);
  const isPushCapable = canPush(calendar);

  return (
    <>
      <DashboardSection
        title="Sync Settings"
        description={isPullCapable ? (
          <>Choose which event details are synced to destination calendars. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in text fields for dynamic values.</>
        ) : (
          "Choose how events synced into this calendar are colored."
        )}
      />
      {isPullCapable && (
        <PremiumGate locked={locked} hint="Advanced sync settings are a Pro feature.">
          <NavigationMenu>
            <SyncEventNameTemplateItem calendarId={calendarId} locked={locked} />
            <SyncEventNameToggle calendarId={calendarId} locked={locked} />
            <ProviderSyncSettings calendarId={calendarId} calendarType={calendarType} locked={locked} />
            {SYNC_SETTINGS.map((setting) => (
              <ExcludeFieldToggle
                key={setting.field}
                calendarId={calendarId}
                field={setting.field}
                label={setting.label}
                matchesField={setting.matchesField}
                locked={locked}
              />
            ))}
          </NavigationMenu>
        </PremiumGate>
      )}
      {isPushCapable && (
        <EventColorSection calendarId={calendarId} provider={calendar.provider} needsReauth={needsReauth} />
      )}
    </>
  );
}

/** Google/Outlook destinations can color synced events; other providers don't support it. */
function EventColorSection({
  calendarId,
  provider,
  needsReauth,
}: {
  calendarId: string;
  provider: string;
  needsReauth: boolean;
}) {
  if (provider !== "google" && provider !== "outlook") return null;

  const colors = provider === "google" ? GOOGLE_EVENT_COLORS : OUTLOOK_EVENT_COLORS;

  return (
    <>
      <NavigationMenu>
        <li className="flex flex-col gap-2 p-3.5 sm:p-3">
          <NavigationMenuItemLabel>Event color</NavigationMenuItemLabel>
          {provider === "outlook" && <EventCategoryNameInput calendarId={calendarId} />}
          <EventColorSwatchRow calendarId={calendarId} colors={colors} />
        </li>
      </NavigationMenu>
      {provider === "outlook" && !needsReauth && (
        <MenuHint>
          Outlook colors events by category. Keeper creates or updates the category in this
          mailbox; if the account was connected before this feature, reconnect it once to grant
          the permission.
        </MenuHint>
      )}
    </>
  );
}

function EventCategoryNameInput({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const eventCategoryName = useAtomValue(eventCategoryNameAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const trimmed = (inputRef.current?.value ?? "").trim();
    const nextValue = trimmed === "" ? null : trimmed;
    if (nextValue === eventCategoryName) return;

    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, eventCategoryName: nextValue } : prev));
    patchSource(store, calendarId, { eventCategoryName: nextValue });
  };

  return (
    <Input
      ref={inputRef}
      defaultValue={eventCategoryName ?? ""}
      placeholder="Keeper"
      aria-label="Category name"
      onChange={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(commit, 600);
      }}
      onBlur={commit}
    />
  );
}

function EventColorSwatchRow({ calendarId, colors }: { calendarId: string; colors: EventColorOption[] }) {
  const store = useStore();
  const selected = useAtomValue(eventColorAtom);

  const selectColor = (eventColor: string | null) => {
    if (eventColor === selected) return;
    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, eventColor } : prev));
    patchSource(store, calendarId, { eventColor });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <EventColorSwatchButton selected={selected === null} label="Default" onClick={() => selectColor(null)} />
      {colors.map((color) => (
        <EventColorSwatchButton
          key={color.value}
          selected={selected === color.value}
          label={color.name}
          hex={color.hex}
          onClick={() => selectColor(color.value)}
        />
      ))}
    </div>
  );
}

function EventColorSwatchButton({
  selected,
  label,
  hex,
  onClick,
}: {
  selected: boolean;
  label: string;
  hex?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={hex ? { backgroundColor: hex } : undefined}
      className={cn(
        "size-6 shrink-0 rounded-full border border-black/10",
        !hex && "flex items-center justify-center bg-background text-[10px] text-foreground-muted",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      {!hex && "—"}
    </button>
  );
}

function ProviderSyncSettings({
  calendarId,
  calendarType,
  locked,
}: {
  calendarId: string;
  calendarType: string;
  locked: boolean;
}) {
  switch (calendarType) {
    case "ical":
      return <TreatFullDayTimedEventsToggle calendarId={calendarId} locked={locked} />;
    default:
      return null;
  }
}

function TreatFullDayTimedEventsToggle({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const treatFullDayTimedEventsAsAllDay = !current.treatFullDayTimedEventsAsAllDay;
    store.set(calendarDetailAtom, (prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, treatFullDayTimedEventsAsAllDay };
    });
    patchSource(store, calendarId, { treatFullDayTimedEventsAsAllDay });
  };

  return (
    <li>
      <ItemDisabledContext value={locked}>
        <button
          type="button"
          role="switch"
          disabled={locked}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !locked })}
        >
          <NavigationMenuItemLabel>Sync Full-Day Events as All-Day</NavigationMenuItemLabel>
          <TreatFullDayTimedEventsToggleIndicator disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function TreatFullDayTimedEventsToggleIndicator({ disabled }: { disabled: boolean }) {
  const checked = useAtomValue(treatFullDayTimedEventsAsAllDayAtom);
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, disabled, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function SyncEventNameDisabledProvider({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  return <ItemDisabledContext value={locked || !excludeEventName}>{children}</ItemDisabledContext>;
}

function SyncEventNameTemplateItem({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const customEventName = useAtomValue(customEventNameAtom);

  return (
    <SyncEventNameDisabledProvider locked={locked}>
      <NavigationMenuEditableTemplateItem
        label="Event Name"
        disabled={locked}
        value={customEventName || "{{event_name}}"}
        renderInput={(live) => (
          <SyncEventNameTemplateInput template={live} />
        )}
        onCommit={(customEventName) => {
          store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, customEventName } : prev));
          patchSource(store, calendarId, { customEventName });
        }}
      >
        <SyncEventNameTemplateValue />
      </NavigationMenuEditableTemplateItem>
    </SyncEventNameDisabledProvider>
  );
}

function SyncEventNameTemplateInput({ template }: { template: string }) {
  return <TemplateText template={template} variables={TEMPLATE_VARIABLES} />;
}

const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

function SyncEventNameTemplateValue() {
  const customEventName = useAtomValue(customEventNameAtom);
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const disabled = !excludeEventName;
  const template = customEventName || "{{event_name}}";

  return (
    <Text
      size="sm"
      tone={disabled ? "disabled" : "muted"}
      className="min-w-0 truncate flex-1 text-right"
    >
      <TemplateText
        template={template}
        variables={TEMPLATE_VARIABLES}
        disabled={disabled}
      />
    </Text>
  );
}

function SyncEventNameToggle({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const patch = current.excludeEventName
      ? { excludeEventName: false, customEventName: "{{event_name}}" }
      : { excludeEventName: true, customEventName: "{{calendar_name}}" };

    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, ...patch } : prev));
    patchSource(store, calendarId, patch);
  };

  return (
    <li>
      <ItemDisabledContext value={locked}>
        <button
          type="button"
          role="switch"
          disabled={locked}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !locked })}
        >
          <NavigationMenuItemLabel>Sync Event Name</NavigationMenuItemLabel>
          <SyncEventNameToggleIndicator disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function SyncEventNameToggleIndicator({ disabled }: { disabled: boolean }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const variant = use(MenuVariantContext);
  const checked = !excludeEventName;

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, disabled, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function ExclusionsSection({ calendarId, provider }: { calendarId: string; provider: string }) {
  const { data: entitlements } = useEntitlements();
  const locked = entitlements ? !entitlements.canUseEventFilters : false;
  const hasExtraSettings = PROVIDERS_WITH_EXTRA_SETTINGS.has(provider);
  const exclusionSettings = hasExtraSettings
    ? [...EXCLUSION_SETTINGS, ...PROVIDER_EXCLUSION_SETTINGS]
    : EXCLUSION_SETTINGS;

  return (
    <>
      <DashboardSection
        title="Exclusions"
        description="Choose which event types to exclude from syncing."
      />
      <PremiumGate locked={locked} hint="Event exclusions are a Pro feature.">
        <NavigationMenu>
          {exclusionSettings.map((setting) => (
            <ExcludeFieldToggle
              key={setting.field}
              calendarId={calendarId}
              field={setting.field}
              label={setting.label}
              matchesField={setting.matchesField}
              locked={locked}
            />
          ))}
        </NavigationMenu>
      </PremiumGate>
    </>
  );
}

function ExcludeFieldToggle({
  calendarId,
  field,
  label,
  matchesField,
  locked = false,
}: {
  calendarId: string;
  field: ExcludeField;
  label: string;
  matchesField: boolean;
  locked?: boolean;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const newValue = !current[field];
    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, [field]: newValue } : prev));
    patchSource(store, calendarId, { [field]: newValue });
  };

  return (
    <li>
      <ItemDisabledContext value={locked}>
        <button
          type="button"
          role="switch"
          disabled={locked}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !locked })}
        >
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
          <ExcludeFieldToggleIndicator field={field} matchesField={matchesField} disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function ExcludeFieldToggleIndicator({ field, matchesField, disabled }: { field: ExcludeField; matchesField: boolean; disabled: boolean }) {
  const raw = useAtomValue(excludeFieldAtoms[field]);
  const variant = use(MenuVariantContext);
  const checked = matchesField ? raw : !raw;

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, disabled, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}


function CalendarInfoSection({ account, accountId }: { account: CalendarAccount; accountId: string }) {
  const calendar = useAtomValue(calendarDetailAtom);

  if (!calendar) return null;

  return (
    <>
      <DashboardSection
        title="Calendar Information"
        description="View details about the calendar."
      />
      <NavigationMenu>
        <MetadataRow label="Resource Type" value="Calendar" />
        <MetadataRow label="Type" value={calendar.calendarType} />
        <MetadataRow label="Capabilities" value={calendar.capabilities.join(", ")} />
        {calendar.unavailableSince && (
          <MetadataRow
            label="Availability"
            value={`Unavailable since ${formatDate(calendar.unavailableSince)}`}
            truncate
          />
        )}
        {calendar.originalName && (
          <MetadataRow label="Original Source Name" value={calendar.originalName} truncate />
        )}
        {calendar.url && (
          <MetadataRow label="URL" value={calendar.url} truncate />
        )}
        {calendar.calendarUrl && (
          <MetadataRow label="Calendar URL" value={calendar.calendarUrl} truncate />
        )}
        <MetadataRow label="Added" value={formatDate(calendar.createdAt)} />
        <MetadataRow
          label="Account Identifier"
          value={account.accountIdentifier ?? ""}
          truncate
          to={`/dashboard/accounts/${accountId}`}
        />
      </NavigationMenu>
    </>
  );
}
