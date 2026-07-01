# Intraday Bias → Discord (scheduled)

A scheduled Cowork task runs the **intraday-bias** skill every US market weekday
pre-market, scans the live TradingView charts via the `tradingview` MCP, and posts
the full report to a Discord channel through a webhook.

## Pieces

| Piece | Location | Purpose |
|---|---|---|
| Skill | `skills/intraday-bias/SKILL.md` | The analysis (US30USD + NAS100USD, Daily→1H, SMT, bias). |
| Delivery script | `scripts/discord-post.mjs` | Splits a report into ≤2000-char messages and POSTs to the webhook (via curl/proxy). |
| Run guard | `scripts/bias-guard.sh` | Per-day lock + marker + ET time-window → prints RUN / REPOST / SKIP. |
| Run finisher | `scripts/bias-finish.sh` | `success` marks the day done; `abort` frees the lock so the next cycle retries. |
| Webhook secret | `.discord-webhook` (repo root, git-ignored) | One line: your Discord webhook URL. |
| Saved reports | `bias-reports/intraday-bias-YYYY-MM-DD.md` (git-ignored) | Durable copy of each run. |
| Scheduled task | `~/Claude/Scheduled/intraday-bias-discord/SKILL.md` | The recurring job (created via Cowork). |

## One-time setup

1. **Create a Discord webhook**: in your server → *Server Settings → Integrations →
   Webhooks → New Webhook*, choose the target channel, **Copy Webhook URL**.
2. **Store it** in the repo root as `.discord-webhook` (a single line, the URL only).
   It is git-ignored so it will not be committed.
3. **Allow Discord network access**: Cowork's sandbox blocks outbound traffic to
   everything except package registries by default. Add `discord.com` to the allowed
   domains in **Claude → Settings → Capabilities** (network access), or the POST will
   fail. Each run still saves the report to `bias-reports/` even if posting fails.

## Test the delivery script

```bash
# balance/split check only, no network:
node scripts/discord-post.mjs bias-reports/some-report.md --dry-run

# real send (needs .discord-webhook + discord.com allowed):
node scripts/discord-post.mjs bias-reports/some-report.md --title "**Test**"
```

## Schedule & retry

Task id `intraday-bias-discord`, cron `*/15 8-11 * * 1-5` (weekdays, every 15 min
from 08:00, America/New_York; the scheduler adds a small fixed dispatch delay).

The task fires every 15 minutes, but `bias-guard.sh` decides what actually happens:

- Only runs the analysis inside the **08:30–11:30 ET** window (so the pre-08:30
  fires are skipped and it never posts a stale midday bias). Change the window with
  `BIAS_START_HHMM` / `BIAS_END_HHMM` env vars in the guard call.
- Runs the full analysis **at most once per day** (a `.posted-<date>` marker).
- Uses an atomic per-day **lock** so overlapping fires never double-run or
  double-post; a crashed run's lock is auto-reclaimed after 25 min.
- If the machine was **asleep / app closed at 8:30**, the next fire after it wakes
  (within the window) runs the analysis — that's the retry behavior. If only the
  Discord post failed, later cycles **re-post** the already-saved report without
  re-analyzing.

Effective result: first real run ~08:37 ET; if missed, retried every ~15 min until
~11:30 ET, exactly once. TradingView Desktop must be running with CDP on port 9222
(the task will `tv_launch` it if needed), and the Claude desktop app must be open at
run time (scheduled tasks run while the app is open; a missed run also fires on next
launch).

## Notes

- The delivery script POSTs via `curl`, which honors the sandbox's mandatory HTTP
  proxy (`HTTPS_PROXY`). Node's built-in `fetch` does **not** use the proxy and fails
  with `EAI_AGAIN`, so `curl` is used deliberately.
- Every run saves the full report to `bias-reports/` first, so even if the Discord
  post fails the analysis is never lost.
