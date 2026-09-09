import { isSocketMessage, isSyncAggregate } from "@keeper.sh/data-schemas/client";
import type { CompositeSyncState, SyncAggregateData } from "@/state/sync";

type IncomingSocketAction =
  | { kind: "ignore" }
  | { kind: "pong" }
  | { kind: "reconnect" }
  | { kind: "aggregate"; data: SyncAggregateData };

interface AggregateDecision {
  accepted: boolean;
  nextSeq: number;
}

const resolveAggregateLastSyncedAt = (
  currentLastSyncedAt: string | null,
  nextAggregate: SyncAggregateData,
): string | null => {
  if ("lastSyncedAt" in nextAggregate) {
    return nextAggregate.lastSyncedAt ?? null;
  }
  return currentLastSyncedAt;
};

const parseTimestampMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const hasLastSyncedAtAdvanced = (
  current: CompositeSyncState,
  next: SyncAggregateData,
): boolean => {
  const currentLastSyncedAtMs = parseTimestampMs(current.lastSyncedAt);
  const nextLastSyncedAtMs = parseTimestampMs(next.lastSyncedAt);

  return (
    nextLastSyncedAtMs !== null &&
    (currentLastSyncedAtMs === null || nextLastSyncedAtMs > currentLastSyncedAtMs)
  );
};

const isForwardProgress = (
  current: CompositeSyncState,
  next: SyncAggregateData,
): boolean => {
  if (hasLastSyncedAtAdvanced(current, next)) {
    return true;
  }

  if (next.syncEventsProcessed > current.syncEventsProcessed) {
    return true;
  }

  if (next.syncEventsRemaining < current.syncEventsRemaining) {
    return true;
  }

  if (next.progressPercent > current.progressPercent) {
    return true;
  }

  if (current.state === "syncing" && !next.syncing && next.syncEventsRemaining === 0) {
    return true;
  }

  return false;
};

/** The first aggregate of a page load is skipped: the readers just fetched on mount. */
const hasSyncLandedEvents = (
  current: CompositeSyncState,
  next: SyncAggregateData,
): boolean =>
  current.hasReceivedAggregate &&
  (hasLastSyncedAtAdvanced(current, next) || (current.state === "syncing" && !next.syncing));

const parseIncomingSocketAction = (
  raw: string,
): IncomingSocketAction => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "reconnect" };
  }

  if (!isSocketMessage(parsed)) {
    return { kind: "reconnect" };
  }

  if (parsed.event === "ping") {
    return { kind: "pong" };
  }

  if (parsed.event !== "sync:aggregate") {
    return { kind: "ignore" };
  }

  if (!isSyncAggregate(parsed.data)) {
    return { kind: "reconnect" };
  }

  return {
    data: parsed.data,
    kind: "aggregate",
  };
};

const shouldAcceptAggregatePayload = (
  currentState: CompositeSyncState,
  lastSeq: number,
  nextAggregate: SyncAggregateData,
): AggregateDecision => {
  const isNewerSequence = nextAggregate.seq > lastSeq;
  if (!isNewerSequence && !isForwardProgress(currentState, nextAggregate)) {
    return {
      accepted: false,
      nextSeq: lastSeq,
    };
  }

  return {
    accepted: true,
    nextSeq: Math.max(lastSeq, nextAggregate.seq),
  };
};

export {
  hasSyncLandedEvents,
  parseIncomingSocketAction,
  resolveAggregateLastSyncedAt,
  shouldAcceptAggregatePayload,
};
export type { IncomingSocketAction, AggregateDecision };
