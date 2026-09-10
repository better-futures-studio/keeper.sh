import { calendarIdsBodySchema } from "@/utils/request-body";
import { accountIdParamSchema } from "@/utils/request-query";
import { ErrorResponse } from "@/utils/responses";
import type { ApplyAccountCalendarSelectionResult } from "@/utils/calendar-selection";

interface PutAccountCalendarSelectionContext {
  body: unknown;
  params: Record<string, string>;
  userId: string;
}

interface PutAccountCalendarSelectionDependencies {
  applySelection: (
    userId: string,
    accountId: string,
    calendarIds: string[],
  ) => Promise<ApplyAccountCalendarSelectionResult>;
}

const resolveAccountId = (
  params: Record<string, string>,
): { accountId: string } | Response => {
  if (!params.accountId || !accountIdParamSchema.allows(params)) {
    return ErrorResponse.badRequest("Account ID is required").toResponse();
  }
  return { accountId: params.accountId };
};

const handlePutAccountCalendarSelectionRoute = async (
  context: PutAccountCalendarSelectionContext,
  dependencies: PutAccountCalendarSelectionDependencies,
): Promise<Response> => {
  const resolved = resolveAccountId(context.params);
  if (resolved instanceof Response) {
    return resolved;
  }

  if (!calendarIdsBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("calendarIds array is required").toResponse();
  }

  const result = await dependencies.applySelection(
    context.userId,
    resolved.accountId,
    context.body.calendarIds,
  );

  if (result.kind === "account-not-found") {
    return ErrorResponse.notFound().toResponse();
  }

  if (result.kind === "unknown-calendar-ids") {
    return ErrorResponse.badRequest("Some calendar IDs do not belong to this account").toResponse();
  }

  return Response.json(result.selection);
};

export { handlePutAccountCalendarSelectionRoute };
export type { PutAccountCalendarSelectionContext, PutAccountCalendarSelectionDependencies };
