#!/usr/bin/env bash
#
# bias-guard.sh — decide whether a scheduled intraday-bias run should proceed.
#
# The task runs TWICE each weekday morning, each with its own retry window:
#   slot 0830  08:30–09:59 ET  -> the day's first run (BASELINE, pre-market)
#   slot 1000  10:00–11:30 ET  -> the second run (UPDATE, ~90 min later)
# (BASELINE vs UPDATE is decided by the skill itself from its daily log; this
#  guard only handles WHICH run / WHEN and prevents duplicate/again-today runs.
#  The two windows are back-to-back and never overlap.)
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
# stdout (parse these): `SLOT=0830|1000`, `REPORT=<path>`, and the directive LAST:
#   RUN | REPOST | SKIP:<reason>
# Diagnostics -> stderr. Windows overridable via env (HHMM):
#   BIAS_R1_START/BIAS_R1_END/BIAS_R2_START/BIAS_R2_END.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"
mkdir -p "$DIR"

DATE="$(TZ=America/New_York date +%F)"
NOWMIN=$((10#$(TZ=America/New_York date +%H%M)))
NOW=$(date +%s)
R1_START=$((10#${BIAS_R1_START:-0830})); R1_END=$((10#${BIAS_R1_END:-0959}))
R2_START=$((10#${BIAS_R2_START:-1000})); R2_END=$((10#${BIAS_R2_END:-1130}))
STALE_SEC=$(( 25 * 60 ))

# weekdays only (launchd fires by interval, so enforce the day here). 1=Mon..7=Sun
DOW=$(TZ=America/New_York date +%u)
if [ "$DOW" -gt 5 ]; then
  echo "guard: weekend (dow=$DOW)" >&2
  echo "SKIP:weekend (ET day $DOW)"
  exit 0
fi

# choose the slot from the current ET time
if   [ "$NOWMIN" -ge "$R1_START" ] && [ "$NOWMIN" -le "$R1_END" ]; then SLOT=0830
elif [ "$NOWMIN" -ge "$R2_START" ] && [ "$NOWMIN" -le "$R2_END" ]; then SLOT=1000
else
  echo "guard: now=$NOWMIN outside run1($R1_START-$R1_END) / run2($R2_START-$R2_END)" >&2
  echo "SKIP:outside the 08:30 / 10:00 ET windows (now $NOWMIN ET)"
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
