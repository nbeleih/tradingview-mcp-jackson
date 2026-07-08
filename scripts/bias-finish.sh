#!/usr/bin/env bash
#
# bias-finish.sh <success|abort> <slot HHMM> — close out a scheduled intraday-bias run.
#
#   success : mark this slot done today (later fires in the slot skip)
#   abort   : set the slot back to idle so the NEXT 15-min fire retries immediately
#
# Writes the per-slot state file only (no deletes — deletions are gated inside
# scheduled Cowork sandboxes).
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"
DATE="$(TZ=America/New_York date +%F)"
NOW=$(date +%s)

ACTION="${1:-}"
SLOT="${2:-}"
case "$SLOT" in [0-9][0-9][0-9][0-9]) ;; *) echo "usage: bias-finish.sh <success|abort> <slot HHMM>" >&2; exit 2;; esac

STATE="$DIR/.state-$SLOT-$DATE"

case "$ACTION" in
  success) printf 'posted:%s\n' "$NOW" > "$STATE"; echo "finish: $SLOT marked posted" ;;
  abort)   printf 'idle:%s\n'   "$NOW" > "$STATE"; echo "finish: $SLOT set idle — next 15-min cycle retries" ;;
  *)       echo "usage: bias-finish.sh <success|abort> <slot HHMM>" >&2; exit 2 ;;
esac
