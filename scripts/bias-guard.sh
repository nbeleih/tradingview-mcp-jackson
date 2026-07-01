#!/usr/bin/env bash
#
# bias-guard.sh — decide whether the scheduled intraday-bias run should proceed.
#
# The scheduled task fires every 15 min across a morning window so a run that was
# missed (e.g. computer asleep at 8:30) is retried once the machine is awake.
# This guard makes that safe and idempotent:
#   - only runs inside the ET time window (default 08:30–11:30),
#   - runs the analysis at most ONCE per day (marker file),
#   - uses an atomic per-day lock so overlapping fires don't double-run/double-post,
#   - recovers a stale lock left by a crashed run.
#
# Prints diagnostics to stderr and exactly one directive as the LAST stdout line:
#   RUN            -> do the full analysis, then call: bias-finish.sh success|abort
#   REPOST         -> analysis already saved but Discord post failed earlier;
#                     re-post $DIR/intraday-bias-<DATE>.md, then finish success|abort
#   SKIP:<reason>  -> do nothing this cycle
#
# Window can be overridden with env: BIAS_START_HHMM / BIAS_END_HHMM (e.g. 0830 1130)
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"
mkdir -p "$DIR"

DATE="$(TZ=America/New_York date +%F)"
NOWMIN=$((10#$(TZ=America/New_York date +%H%M)))
START=$((10#${BIAS_START_HHMM:-0830}))
END=$((10#${BIAS_END_HHMM:-1130}))
STALE_SEC=$(( 25 * 60 ))

POSTED="$DIR/.posted-$DATE"
REPORT="$DIR/intraday-bias-$DATE.md"
LOCK="$DIR/.run-$DATE.lock"

# acquire lock atomically (mkdir), stamp it with an epoch we control (NOT file
# mtime — the mounted FS mtime does not track the sandbox clock reliably).
acquire() {
  if mkdir "$LOCK" 2>/dev/null; then
    date +%s > "$LOCK/ts"
    [ -f "$REPORT" ] && echo "REPOST" || echo "RUN"
    return 0
  fi
  return 1
}

echo "guard: date=$DATE now=$NOWMIN window=$START-$END posted=$([ -f "$POSTED" ] && echo y || echo n) report=$([ -f "$REPORT" ] && echo y || echo n) lock=$([ -d "$LOCK" ] && echo y || echo n)" >&2

# 1) already fully done today
if [ -f "$POSTED" ]; then echo "SKIP:already posted today"; exit 0; fi

# 2) outside the allowed ET window (covers jittered-early fires and late/stale wakes)
if [ "$NOWMIN" -lt "$START" ] || [ "$NOWMIN" -gt "$END" ]; then
  echo "SKIP:outside ${START}-${END} ET window (now $NOWMIN)"; exit 0
fi

# 3) acquire the per-day lock
if acquire; then exit 0; fi

# 4) lock is held — decide in-progress vs. stale (crashed run) via the stamped epoch
NOW=$(date +%s)
THEN=$(cat "$LOCK/ts" 2>/dev/null || echo 0)
AGE=$(( NOW - THEN ))
if [ "$THEN" -gt 0 ] && [ "$AGE" -gt "$STALE_SEC" ]; then
  echo "guard: stale lock (age ${AGE}s > ${STALE_SEC}s), reclaiming" >&2
  rm -rf "$LOCK"
  if acquire; then exit 0; fi
fi

echo "SKIP:another run in progress"
exit 0
