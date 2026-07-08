#!/usr/bin/env bash
#
# bias-guard.sh — decide whether a scheduled intraday-bias run should proceed.
#
# The task runs ONCE each weekday, in a single retry window:
#   slot 0945  09:45–10:35 ET  -> the day's run (BASELINE; 15 min after the 9:30 open)
# (BASELINE vs UPDATE is decided by the skill itself from its daily log; a lone daily
#  run is always BASELINE. This guard only handles WHEN and prevents duplicate/
#  again-today runs; the launchd plist fires at 09:45 and retries 10:00/10:15/10:30.)
#
# State is tracked in ONE per-slot file, `.state-<slot>-<date>`, whose contents are
# "<status>:<epoch>" with status in {running, posted, idle}. We use a plain file
# that we OVERWRITE (never delete): deletions are permission-gated inside scheduled
# Cowork sandboxes, so any lock/marker scheme based on rm/rmdir gets stuck. Writing
# (truncate-in-place) is always allowed.
#
# Fires 15 min apart with a fixed dispatch delay, so runs don't truly overlap; the
# state file mainly stops a new fire from starting while a prior run is still going
# and records "posted" so the slot runs once/day.
#
# stdout (parse these): `SLOT=0945`, `REPORT=<path>`, and the directive LAST:
#   RUN | REPOST | SKIP:<reason>
# Diagnostics -> stderr. Window overridable via env (HHMM): BIAS_START/BIAS_END.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"
mkdir -p "$DIR"

DATE="$(TZ=America/New_York date +%F)"
NOWMIN=$((10#$(TZ=America/New_York date +%H%M)))
NOW=$(date +%s)
WIN_START=$((10#${BIAS_START:-0945})); WIN_END=$((10#${BIAS_END:-1035}))
STALE_SEC=$(( 25 * 60 ))

# weekdays only (launchd fires by interval, so enforce the day here). 1=Mon..7=Sun
DOW=$(TZ=America/New_York date +%u)
if [ "$DOW" -gt 5 ]; then
  echo "guard: weekend (dow=$DOW)" >&2
  echo "SKIP:weekend (ET day $DOW)"
  exit 0
fi

# single daily window (launchd fires 09:45/10:00/10:15/10:30; guard runs it once)
if [ "$NOWMIN" -ge "$WIN_START" ] && [ "$NOWMIN" -le "$WIN_END" ]; then
  SLOT=0945
else
  echo "guard: now=$NOWMIN outside window($WIN_START-$WIN_END)" >&2
  echo "SKIP:outside the 09:45 ET window (now $NOWMIN ET)"
  exit 0
fi

STATE="$DIR/.state-$SLOT-$DATE"
REPORT="$DIR/intraday-bias-$DATE-$SLOT.md"

echo "SLOT=$SLOT"
echo "REPORT=$REPORT"

# read current state ("status:epoch")
ST=""; TS=0
if [ -f "$STATE" ]; then
  IFS=: read -r ST TS < "$STATE" 2>/dev/null || true
  case "${TS:-}" in ''|*[!0-9]*) TS=0 ;; esac
fi
AGE=$(( NOW - TS ))
echo "guard: date=$DATE now=$NOWMIN slot=$SLOT state=${ST:-none} age=${AGE}s report=$([ -f "$REPORT" ] && echo y || echo n)" >&2

# 1) this slot already completed today
if [ "$ST" = "posted" ]; then echo "SKIP:already posted the $SLOT run today"; exit 0; fi

# 2) a fresh run is in progress
if [ "$ST" = "running" ] && [ "$TS" -gt 0 ] && [ "$AGE" -lt "$STALE_SEC" ]; then
  echo "SKIP:another $SLOT run in progress (${AGE}s)"; exit 0
fi

# 3) claim by overwriting the state file (no delete needed); RUN, or REPOST if a
#    report was already produced this slot but the Discord post had failed.
printf 'running:%s\n' "$NOW" > "$STATE"
[ -f "$REPORT" ] && echo "REPOST" || echo "RUN"
exit 0
