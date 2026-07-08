#!/usr/bin/env bash
#
# run-intraday-bias.sh — scheduled runner for the intraday-bias report (Claude Code).
#
# Cowork can't use the local TradingView MCP, so scheduling lives here instead: a
# macOS launchd job calls this script on the host, where Claude Code (`claude -p`)
# has the local `tradingview` MCP and direct network to Discord.
#
# Flow: bias-guard.sh decides the slot/action → on RUN we invoke `claude -p` to run
# the intraday-bias skill and write the report → we post it to Discord → bias-finish.sh
# records success (or abort so the next 15-min cycle retries). Idempotent + windowed
# via the guard, so launchd can fire it every 15 min safely.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO" || exit 1

mkdir -p "$REPO/bias-reports"
LOG="$REPO/bias-reports/scheduler.log"
log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" >> "$LOG"; }

# launchd gives a minimal PATH; make claude/node/timeout findable
export PATH="$HOME/.claude/local:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# claude + node are installed under nvm on this host — add nvm's node bin dir(s) so launchd can find them
for _d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done
export PATH
CLAUDE_BIN="$(command -v claude || true)"
NODE_BIN="$(command -v node || true)"
TIMEOUT_BIN="$(command -v gtimeout || command -v timeout || true)"

# Refresh the status dashboard (bias-reports/dashboard.html) on every fire — SKIP or
# RUN — via an EXIT trap, so it reflects the settled state after each 15-min check.
gen_dashboard(){ [ -n "$NODE_BIN" ] && "$NODE_BIN" "$SCRIPT_DIR/bias-dashboard.mjs" >/dev/null 2>>"$LOG" || true; }
trap gen_dashboard EXIT

GUARD_OUT="$("$SCRIPT_DIR/bias-guard.sh" 2>>"$LOG")"
DIRECTIVE="$(printf '%s\n' "$GUARD_OUT" | tail -1)"
SLOT="$(printf '%s\n' "$GUARD_OUT" | sed -n 's/^SLOT=//p')"
REPORT="$(printf '%s\n' "$GUARD_OUT" | sed -n 's/^REPORT=//p')"
DATE="$(TZ=America/New_York date +%F)"
PRETTY="$(TZ=America/New_York date '+%b %-d, %Y')"

case "$SLOT" in
  0945) TITLE="**📊 Intraday Bias — $PRETTY · 9:45 ET run**" ;;
  *)    TITLE="**📊 Intraday Bias — $PRETTY**" ;;
esac

log "guard -> directive=$DIRECTIVE slot=$SLOT"

case "$DIRECTIVE" in
  SKIP*) exit 0 ;;
esac

post_report(){
  [ -n "$NODE_BIN" ] || { log "ERROR: node not found"; return 1; }
  "$NODE_BIN" "$SCRIPT_DIR/discord-post.mjs" "$REPORT" --title "$TITLE"
}

finish(){ "$SCRIPT_DIR/bias-finish.sh" "$1" "$SLOT" >>"$LOG" 2>&1; }

# --- REPOST: report already exists from an earlier attempt, only the post failed ---
if [ "$DIRECTIVE" = "REPOST" ]; then
  if [ -f "$REPORT" ] && post_report >>"$LOG" 2>&1; then
    finish success; log "REPOST ok ($SLOT)"
  else
    finish abort;  log "REPOST post failed ($SLOT)"
  fi
  exit 0
fi

# --- RUN: produce the report via Claude Code (it has the tradingview MCP) ---
if [ -z "$CLAUDE_BIN" ]; then
  log "ERROR: claude CLI not found in PATH — aborting for retry"
  finish abort
  exit 1
fi

PROMPT="You are the scheduled intraday-bias job (slot ${SLOT} ET, ${DATE}). Work autonomously; never ask questions.
1) Ensure TradingView Desktop is connected: call mcp__tradingview__tv_health_check; if not connected, call mcp__tradingview__tv_launch, wait ~20s, then re-check. If it STILL cannot connect, do NOT write any report file — reply exactly TV_UNREACHABLE and stop.
2) Read ${REPO}/skills/intraday-bias/SKILL.md and follow it EXACTLY, start to finish, for BOTH instruments in order: OANDA:US30USD then OANDA:NAS100USD. Do every phase, including Phase 0 (read intraday-bias-logs/${DATE}.md to decide BASELINE vs UPDATE and load prior calls) and Phase 6 (append this run to intraday-bias-logs/${DATE}.md; never overwrite). On an UPDATE, reconcile the earlier call per Phase 4. Refresh PDH/PDL/PDC, draw S/R (orange=resistance, blue=support, purple=previous-day; keep them on the chart), run the NAS100USD<->SPX500USD SMT check, size everything in ATR per instrument, and end with a firm LONG/SHORT/DEPENDS for each.
3) Write the COMPLETE final report (the skill's Final Output Format: the Combined read line, then the full US30USD block, then the full NAS100USD block) to this exact file, overwriting it: ${REPORT}
4) Then reply with just: DONE"

log "RUN: invoking claude ($SLOT)"
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" 1200 "$CLAUDE_BIN" -p "$PROMPT" --dangerously-skip-permissions >>"$LOG" 2>&1 </dev/null
else
  "$CLAUDE_BIN" -p "$PROMPT" --dangerously-skip-permissions >>"$LOG" 2>&1 </dev/null
fi
log "claude exited rc=$?"

if [ -f "$REPORT" ] && [ -s "$REPORT" ]; then
  if post_report >>"$LOG" 2>&1; then
    finish success; log "posted + success ($SLOT)"
  else
    finish abort;  log "post FAILED — will retry next cycle ($SLOT)"
  fi
else
  finish abort; log "no report produced (TV unreachable / analysis failed) — retry next cycle ($SLOT)"
fi
exit 0
