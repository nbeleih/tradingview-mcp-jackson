# Intraday Bias → Discord (scheduled)

Runs the **intraday-bias** skill on `OANDA:US30USD` + `OANDA:NAS100USD` once each
weekday morning (09:45 ET), scanning the live TradingView charts, and posts the full report to a
Discord channel.

## Why this runs in Claude Code, not Cowork

The TradingView MCP is a **local** stdio server (`node src/server.js` → TradingView on
`localhost:9222`). Per Anthropic's docs, *local MCP servers aren't available in Cowork*
— only remote (public-internet) connectors are. So a Cowork scheduled task literally
cannot drive TradingView. Instead, a **macOS launchd** job calls **Claude Code**
(`claude -p`) on the host, where the local `tradingview` MCP works and there's direct
network to Discord.

## Pieces

| Piece | Location | Purpose |
|---|---|---|
| Skill | `skills/intraday-bias/SKILL.md` | The analysis. Self-detects BASELINE vs UPDATE from its daily log. |
| Skill log | `intraday-bias-logs/<date>.md` (git-ignored) | Continuity log the skill reads (Phase 0) and appends (Phase 6). |
| Runner | `scripts/run-intraday-bias.sh` | Guard → `claude -p` (runs the skill, writes report) → post to Discord → finish. |
| Run guard | `scripts/bias-guard.sh` | Weekday + ET-window + per-slot state → prints RUN / REPOST / SKIP. |
| Run finisher | `scripts/bias-finish.sh` | `success` marks the slot done; `abort` sets it idle so the next cycle retries. |
| Delivery | `scripts/discord-post.mjs` | Splits the report into ≤2000-char messages and POSTs to the webhook (via curl). |
| Webhook secret | `.discord-webhook` (repo root, git-ignored) | One line: your Discord webhook URL. |
| Saved reports | `bias-reports/intraday-bias-<date>-<slot>.md` (git-ignored) | Durable copy of each run + `scheduler.log`. |
| launchd job | `scripts/com.nourbeleih.intraday-bias.plist` | Fires the runner at 09:45 ET (+ 10:00/10:15/10:30 retries). |

## One-time setup

1. **Claude Code has the tradingview MCP.** Confirm with `claude mcp list` (it should
   list `tradingview`). It's also defined in the repo's `.mcp.json`, so a `claude` run
   started inside this repo picks it up.
2. **Webhook** is stored in `.discord-webhook` at the repo root (already set). No Cowork
   network allowlist is needed anymore — posting happens from the host via curl.
3. **Install the launchd job:**
   ```bash
   cp scripts/com.nourbeleih.intraday-bias.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.nourbeleih.intraday-bias.plist
   ```

## Test it once (real run + real Discord post)

Force a run regardless of the clock (this actually scans and posts):
```bash
BIAS_START=0000 BIAS_END=2359 bash scripts/run-intraday-bias.sh
tail -n 40 bias-reports/scheduler.log
```
TradingView Desktop should be open (the runner will `tv_launch` it otherwise).

## Schedule & retry

launchd fires the runner at **09:45 ET** (and retries **10:00 / 10:15 / 10:30**);
`bias-guard.sh` decides what happens:

| Slot | ET window | Mode |
|---|---|---|
| 0945 | 09:45–10:35 (fires 09:45; 10:00/10:15/10:30 are retries) | BASELINE — 15 min after the 9:30 open |

- **Weekdays only**, and only inside the 09:45–10:35 window.
- Runs the full analysis **at most once per day** (state file `.state-0945-<date>`). The
  09:45 fire runs it; 10:00/10:15/10:30 only fire a `claude` run if the earlier attempt
  failed — otherwise they SKIP, so it's normally **one `claude` run per day**.
- State files hold `running|posted|idle:<epoch>` and are only **overwritten, never
  deleted**. A `running` state older than 25 min is treated as a crashed run and reclaimed.
- **Retry if asleep:** launchd runs a missed calendar time once on wake, so if the Mac was
  asleep at 09:45, it runs when it wakes (if still inside the window).
- If the analysis fails or Discord is unreachable, the report is still saved and the slot
  is set `idle` so the next retry time runs it (or `REPOST`s the saved report).

## Requirements at run time
- The Mac is awake (or wakes) during the window; TradingView Desktop installed/running
  (port 9222); `claude` logged in with the tradingview MCP.

## Uninstall
```bash
launchctl unload ~/Library/LaunchAgents/com.nourbeleih.intraday-bias.plist
rm ~/Library/LaunchAgents/com.nourbeleih.intraday-bias.plist
```
The old Cowork scheduled task `intraday-bias-discord` is paused/disabled and can be
removed from the Cowork **Scheduled** sidebar.
