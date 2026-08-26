#!/usr/bin/env bash
#
# bias-pause.sh [today|YYYY-MM-DD] — pause the scheduled intraday-bias run.
#
#   (no arg)     pause INDEFINITELY (until you run bias-resume.sh)
#   today        skip ONLY today (auto-resumes tomorrow)
#   YYYY-MM-DD   skip only that ET date
#
# Writes bias-reports/PAUSE (gitignored, local). scripts/bias-guard.sh checks it and
# emits SKIP:paused, so no claude run / Discord post happens. The dashboard shows a
# ⏸ PAUSED banner. Clear it with scripts/bias-resume.sh.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"; mkdir -p "$DIR"
PAUSE="$DIR/PAUSE"

case "${1:-}" in
  "")     printf 'indefinite\n' > "$PAUSE"; echo "paused — scheduled runs will SKIP until 'bash scripts/bias-resume.sh'" ;;
  today)  D="$(TZ=America/New_York date +%F)"; printf '%s\n' "$D" > "$PAUSE"; echo "paused for today ($D) — auto-resumes tomorrow" ;;
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) printf '%s\n' "$1" > "$PAUSE"; echo "paused for $1" ;;
  *) echo "usage: bias-pause.sh [today|YYYY-MM-DD]   (no arg = pause indefinitely)" >&2; exit 2 ;;
esac

# refresh the dashboard so the paused state shows right away (best-effort)
node "$REPO/scripts/bias-dashboard.mjs" >/dev/null 2>&1 || true
