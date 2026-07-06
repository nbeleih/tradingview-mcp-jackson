#!/usr/bin/env bash
#
# run-dashboard-server.sh — launchd entrypoint for the live bias-dashboard server.
#
# Mirrors run-intraday-bias.sh's PATH handling: launchd hands over a minimal PATH that
# omits nvm's node bin dir, so we add it here (globbed) or the server can't find node.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.claude/local:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
for _d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done
export PATH

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "run-dashboard-server: node not found in PATH" >&2; exit 1; }
exec "$NODE_BIN" "$SCRIPT_DIR/bias-dashboard-server.mjs"
