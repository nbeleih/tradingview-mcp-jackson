#!/usr/bin/env bash
#
# bias-finish.sh success|abort — close out a scheduled intraday-bias run.
#
#   success : mark today as posted (so later 15-min fires skip) and release the lock
#   abort   : release the lock WITHOUT marking, so the next 15-min fire retries
#
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/bias-reports"
DATE="$(TZ=America/New_York date +%F)"
POSTED="$DIR/.posted-$DATE"
LOCK="$DIR/.run-$DATE.lock"

case "${1:-}" in
  success)
    date -u +%FT%TZ > "$POSTED"
    rm -rf "$LOCK"
    echo "finish: marked posted ($POSTED), lock released"
    ;;
  abort)
    rm -rf "$LOCK"
    echo "finish: lock released without marker — will retry next 15-min cycle"
    ;;
  *)
    echo "usage: bias-finish.sh success|abort" >&2
    exit 2
    ;;
esac
