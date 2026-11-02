#!/bin/bash
# Database migration is a separate reviewed operation, never an app boot action.
set -euo pipefail
cd /app
pids=()
stop() {
  trap - TERM INT EXIT
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap stop TERM INT EXIT
export DATABASE_POOL_MAX=${DATABASE_POOL_MAX:-10}
bun run services/api/dist/index.js &
pids+=("$!")
(cd applications/web && exec bun dist/server-entry/index.js) &
pids+=("$!")
case "${KEEPER_SYNC_ENABLED:-false}" in
  true)
    bun run services/cron/dist/index.js &
    pids+=("$!")
    bun run services/worker/dist/index.js &
    pids+=("$!")
    ;;
  false) ;;
  *) echo 'KEEPER_SYNC_ENABLED must be true or false' >&2; exit 64 ;;
esac
# Any child exiting means this instance can no longer serve its full contract.
set +e
wait -n "${pids[@]}"
status=$?
set -e
[ "$status" -ne 0 ] || status=1
exit "$status"
