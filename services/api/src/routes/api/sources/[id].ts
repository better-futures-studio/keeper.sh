import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { database, premiumService } from "@/context";
import { idParamSchema } from "@/utils/request-query";
import {
  getDestinationsForSource,
  getSourcesForDestination,
  requestUserSync,
  scheduleMappingReplacementSync,
  withMappingMutationLocks,
} from "@/utils/source-destination-mappings";
import { withProviderMetadata } from "@/utils/provider-display";
import { syncDefaultFeedMembership } from "@/utils/ical-feeds";
import type { FeedMembershipClient } from "@/utils/ical-feeds";
import { deleteSourceCalendar } from "@/utils/source-calendars";
import {
  applyHiddenFieldTransition,
  readCalendarHidden,
} from "@/utils/calendar-hidden";
import type { HiddenCalendarDataClient } from "@/utils/calendar-hidden";
import { handlePatchSourceRoute } from "./[id]/source-item-routes";

const readPreviousHiddenForPatch = async (
  client: HiddenCalendarDataClient,
  sourceCalendarId: string,
  userId: string,
  hiddenUpdate: unknown,
): Promise<boolean | null> => {
  if (typeof hiddenUpdate !== "boolean") {
    return null;
  }

    return await readCalendarHidden(client, sourceCalendarId, userId);
};

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("ID is required").toResponse();
    }
    const { id } = params;

    const [source] = await database
      .select({
        id: calendarsTable.id,
        name: calendarsTable.name,
        originalName: calendarsTable.originalName,
        calendarType: calendarsTable.calendarType,
        capabilities: calendarsTable.capabilities,
        provider: calendarAccountsTable.provider,
        url: calendarsTable.url,
        calendarUrl: calendarsTable.calendarUrl,
        customEventName: calendarsTable.customEventName,
        excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
        excludeEventDescription: calendarsTable.excludeEventDescription,
        excludeEventLocation: calendarsTable.excludeEventLocation,
        excludeEventName: calendarsTable.excludeEventName,
        excludeFocusTime: calendarsTable.excludeFocusTime,
        excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
        syncFutureRange: calendarsTable.syncFutureRange,
        syncHistoricRange: calendarsTable.syncHistoricRange,
        treatFullDayTimedEventsAsAllDay: calendarsTable.treatFullDayTimedEventsAsAllDay,
        unavailableSince: calendarsTable.unavailableSince,
        disabled: calendarsTable.disabled,
        hidden: calendarsTable.hidden,
        ingestFailureCount: calendarsTable.ingestFailureCount,
        ingestLastFailureAt: calendarsTable.ingestLastFailureAt,
        markEventsAsPrivate: calendarsTable.markEventsAsPrivate,
        eventColor: calendarsTable.eventColor,
        eventCategoryName: calendarsTable.eventCategoryName,
        providerMissingSince: calendarsTable.providerMissingSince,
        createdAt: calendarsTable.createdAt,
        updatedAt: calendarsTable.updatedAt,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(
        and(
          eq(calendarsTable.id, id),
          eq(calendarsTable.userId, userId),
        ),
      )
      .limit(1);

    if (!source) {
      return ErrorResponse.notFound().toResponse();
    }

    const [destinationIds, sourceIds] = await Promise.all([
      getDestinationsForSource(userId, id),
      getSourcesForDestination(userId, id),
    ]);

    return Response.json({
      ...withProviderMetadata(source),
      destinationIds,
      sourceIds,
    });
  }),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePatchSourceRoute(
      { body: payload, params, userId },
      {
        canUseEventFilters: (candidateUserId) => premiumService.canUseEventFilters(candidateUserId),
        getSourceProvider: async (userIdToLookup, sourceCalendarId) => {
          const [source] = await database
            .select({ provider: calendarAccountsTable.provider })
            .from(calendarsTable)
            .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
            .where(
              and(
                eq(calendarsTable.id, sourceCalendarId),
                eq(calendarsTable.userId, userIdToLookup),
              ),
            )
            .limit(1);
          return source?.provider ?? null;
        },
        updateSource: async (userIdToUpdate, sourceCalendarId, updates) => {
          const applyFeedMembership = async (
            client: FeedMembershipClient,
            updated: Record<string, unknown> | null,
          ): Promise<void> => {
            if (updated && typeof updates.includeInIcalFeed === "boolean") {
              await syncDefaultFeedMembership(
                client,
                userIdToUpdate,
                sourceCalendarId,
                updates.includeInIcalFeed,
              );
            }
          };

          const updatesSyncWindow = "syncHistoricRange" in updates
            || "syncFutureRange" in updates;
          if (updatesSyncWindow) {
            const mutation = await withMappingMutationLocks(
              userIdToUpdate,
              async () => {
                const pushCalendars = await database
                  .select({ id: calendarsTable.id })
                  .from(calendarsTable)
                  .where(and(
                    eq(calendarsTable.id, sourceCalendarId),
                    eq(calendarsTable.userId, userIdToUpdate),
                    arrayContains(calendarsTable.capabilities, ["push"]),
                  ));
                return pushCalendars.map(({ id: calendarId }) => calendarId);
              },
              () => database.transaction(async (transaction) => {
                const previousHidden = await readPreviousHiddenForPatch(
                  transaction,
                  sourceCalendarId,
                  userIdToUpdate,
                  updates.hidden,
                );
                const [updated] = await transaction
                  .update(calendarsTable)
                  .set(updates)
                  .where(
                    and(
                      eq(calendarsTable.id, sourceCalendarId),
                      eq(calendarsTable.userId, userIdToUpdate),
                    ),
                  )
                  .returning();
                if (updated?.capabilities.includes("push")) {
                  await requestUserSync(transaction, userIdToUpdate);
                }
                if (updated) {
                  await applyHiddenFieldTransition(
                    transaction,
                    sourceCalendarId,
                    previousHidden,
                    updates.hidden,
                  );
                }
                await applyFeedMembership(transaction, updated ?? null);
                return updated ?? null;
              }),
            );
            if (mutation.destinationCalendarIds.length > 0 && mutation.result) {
              scheduleMappingReplacementSync(userIdToUpdate);
            }
            return mutation.result;
          }

          return await database.transaction(async (transaction) => {
            const previousHidden = await readPreviousHiddenForPatch(
              transaction,
              sourceCalendarId,
              userIdToUpdate,
              updates.hidden,
            );
            const [updated] = await transaction
              .update(calendarsTable)
              .set(updates)
              .where(
                and(
                  eq(calendarsTable.id, sourceCalendarId),
                  eq(calendarsTable.userId, userIdToUpdate),
                ),
              )
              .returning();
            if (
              updated
              && (
                "markEventsAsPrivate" in updates
                || "eventColor" in updates
                || "eventCategoryName" in updates
              )
            ) {
              await requestUserSync(transaction, userIdToUpdate);
            }
            if (updated) {
              await applyHiddenFieldTransition(
                transaction,
                sourceCalendarId,
                previousHidden,
                updates.hidden,
              );
            }
            await applyFeedMembership(transaction, updated ?? null);
            return updated ?? null;
          });
        },
      },
    );
  }),
);

const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("ID is required").toResponse();
    }
    const { id } = params;

    const deleted = await deleteSourceCalendar(userId, id);
    if (!deleted) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json({ success: true });
  }),
);

export { GET, PATCH, DELETE };
