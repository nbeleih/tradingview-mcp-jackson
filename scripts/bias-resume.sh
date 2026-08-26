#!/usr/bin/env bash
#
# bias-resume.sh — clear the pause flag so scheduled intraday-bias runs resume.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PAUSE="$REPO/bias-reports/PAUSE"

if [ -f "$PAUSE" ]; then
  rm -f "$PAUSE" && echo "resumed — scheduled runs re-enabled"
else
  echo "not paused (no flag present)"
fi

# refresh the dashboard so the banner clears right away (best-effort)
node "$REPO/scripts/bias-dashboard.mjs" >/dev/null 2>&1 || true
