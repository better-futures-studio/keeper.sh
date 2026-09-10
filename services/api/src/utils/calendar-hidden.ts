import { sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { inArray, or } from "drizzle-orm";
import type { database as contextDatabase } from "@/context";

const CALENDAR_HIDDEN_MESSAGE = "Calendar is hidden";
const EMPTY_LIST_COUNT = 0;

type MappingMutationClient = Pick<typeof contextDatabase, "delete">;

const removeMappingsForCalendars = async (
  client: MappingMutationClient,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === EMPTY_LIST_COUNT) {
    return;
  }

  await client
    .delete(sourceDestinationMappingsTable)
    .where(or(
      inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds),
      inArray(sourceDestinationMappingsTable.destinationCalendarId, calendarIds),
    ));
};

export { CALENDAR_HIDDEN_MESSAGE, removeMappingsForCalendars };
export type { MappingMutationClient };
