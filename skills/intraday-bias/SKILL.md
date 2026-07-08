---
name: intraday-bias
description: Intraday directional bias for OANDA US30USD and NAS100USD — runs the full analysis on BOTH instruments every time. Daily/4H context down to a 1H entry (with optional 15m fill-timing), plus a light economic-calendar flag, ending in a firm LONG / SHORT / DEPENDS call with a trade plan for each. Run at the open (~9:45am ET, just after the 9:30 cash open) to build the baseline, then re-run any time after (post-news, midday) for an UPDATE that reconciles against the earlier call and shows how it's playing out.
---

# Intraday Bias — Where Is Price Heading Next?

You are generating a firm, confident **intraday** directional bias for **two instruments every run: `OANDA:US30USD` and `OANDA:NAS100USD`**. The goal is a clear answer, for each, to "where is price most likely heading this session, and what's the trade?"

This skill is **price-action first**. The chart structure leads. A few lightweight indicators (VWAP, ATR, Volume) are optional aids to confirm and size — nothing more. **The 1H is the anchor timeframe: the bias, the setup, and the entry trigger all live there.** US30 and NAS100 move on very different point scales — keep every level and target sized off *that* instrument's own ATR, never a shared number.

## Scope & Execution

Run the **entire workflow (Phases 1–5) once per instrument**, in this order:

1. `OANDA:US30USD`
2. `OANDA:NAS100USD`

- Note the originally active symbol first (from `chart_get_state`) so you can restore it at the end.
- Load each instrument with `chart_set_symbol` (use the `OANDA:` prefix so you get the right feed). If the user keeps the two in separate tabs, `tab_switch` between them instead — either way, do a full top-down pass on each.
- Drawings (PDH/PDL, S/R) are per-symbol, so snapshot and draw them **within each symbol's pass**.
- After both passes, present **two separate bias reports** plus a one-line **Combined read** noting whether the two agree (both risk-on / both risk-off) or diverge (one long, one short — a caution flag, since these indices usually move together).
- These two symbols are the fixed scope of this skill; ignore whatever was on the chart when it was launched.

### Run modes — BASELINE vs UPDATE
This skill is built to be run **several times a day**. Phase 0 decides the mode:
- **BASELINE** — the first (normally only) run of the day (scheduled ~9:45 ET, just after the open). Build the bias from scratch; write the day's log.
- **UPDATE** — any later run (post-open, post-news, midday). Re-derive the *current* bias **and reconcile it against the day's earlier run(s)**: did the DEPENDS resolve, did the trigger fire, did price hit the stop / T1 / invalidation? Every run is logged to a daily file so the next one — even in a brand-new chat — can pick up the thread.

State at the top of the output which mode this is (and, for an update, the prior run's time).

**CRITICAL RULES:**
- Be firm. End with a clear read: **LONG**, **SHORT**, or **DEPENDS**. DEPENDS is a real, allowed answer for a genuinely two-sided chart — but it is NOT vague hedging. When you say DEPENDS you MUST give the exact condition that resolves it (e.g. "LONG on a 1H close above X; SHORT on a 1H close below Y").
- Do NOT let the user's opinions or leading questions override the chart. If the chart says short, say short.
- **Timeframe roles:** Daily & 4H = CONTEXT (trend, key levels). **1H = the ENTRY and TRIGGER timeframe.** 15m only fine-tunes the fill inside an already-valid 1H setup — it never creates or vetoes a trade on its own.
- This is an **intraday** read — same-day. A daily uptrend can still have a clean 1H short.
- **Everything is sized in ATR multiples, not fixed points**, because the instrument changes. Targets ≈ 1.5–2.5× the **1H** ATR, stops ≈ 1–1.5× the 1H ATR. Report prices in the instrument's native unit (index points, handles, pips, ticks, $).
- News input is limited to the **scheduled economic calendar**. Do NOT use trader opinions, social sentiment, or crowd calls.

---

## Phase 0: Continuity Check (once per run, before Phase 1)

Decide **BASELINE vs UPDATE** and load any earlier context for today:

1. Get the current **ET date and time** — the date is the log filename; the time sets the session and tells you how many 1H bars have closed since any prior run.
2. Read today's log: **`intraday-bias-logs/<YYYY-MM-DD>.md`** (ET date, relative to the repo root).
   - **Missing / no run yet today** → this is the **BASELINE** run. Create the `intraday-bias-logs/` folder if it doesn't exist (you write the file in Phase 6).
   - **Exists** → this is an **UPDATE** run. Load, per symbol, the most recent run's **call** (LONG/SHORT/DEPENDS), **confidence**, **resolving level / trigger**, **entry**, **stop**, **T1/T2**, **invalidation**, and its timestamp.
3. Carry those prior levels forward — you grade them in Phase 4's *Reconcile the prior call* step and reference them in the output header. On a BASELINE run there's nothing to reconcile.

*(This is separate from the `chart_get_state` at the start of Phase 1 that records the active symbol for restore.)*

## Phase 1: Load the Instrument & Context

*(Repeat Phase 1 → Phase 5 for each of the two symbols. `chart_get_state` once at the very start to record the originally active symbol for restore.)*

### 1A: Connection, Symbol & Price
1. `tv_health_check` — verify connection (first pass only)
2. `chart_set_symbol` — load this pass's instrument (`OANDA:US30USD`, then `OANDA:NAS100USD`)
3. `chart_get_state` — confirm the symbol loaded and list indicators already on it
4. `quote_get` — real-time price snapshot
5. `symbol_info` — instrument metadata (exchange, type, session, tick size). Confirm the **native unit** (index points) and what a "normal" move looks like for *this* instrument — US30 and NAS100 differ a lot.
6. `draw_list` — **snapshot the drawings already on this symbol and record their IDs.** Treat these as the user's own lines and never remove them — **with one exception:** horizontal lines this skill drew on a prior run, labeled exactly `PDH`, `PDL`, or `PDC`, are stale (previous-day levels change daily) and get refreshed in Phase 1D. Everything else stays.

Both are US index CFDs, so the US economic calendar (Phase 1C) drives both, and VWAP/session levels are meaningful for each.

### 1B: Session Timing (Eastern Time)

Know where you are in the day — it colors conviction.

| Session | Time (ET) | Character | Quality |
|---|---|---|---|
| **Asia** | 8:00 PM – 2:00 AM | Thin, choppy, mean-reverting | LOW |
| **London Open** | 2:00 AM – 5:00 AM | First directional move; sets early bias | MODERATE |
| **Pre-market / Overlap** | 7:00 AM – 9:30 AM | Positioning before the US cash open. **8:30 ET = prime US data-release slot.** | MODERATE — position light, confirm |
| **NY Open** | 9:30 AM – 11:00 AM | Highest volume, strongest momentum | **HIGH — best window** |
| **NY Midday** | 11:00 AM – 12:00 PM | Momentum cools | MODERATE |
| **NY Lunch** | 12:00 PM – 1:30 PM | Dead zone, stop hunts, false breaks | LOW |
| **NY PM** | 1:30 PM – 4:00 PM | Can trend or reverse the AM move | MODERATE |
| **After Hours** | 4:00 PM – 8:00 PM | Thin, unreliable | LOW |

**Rules:**
- Running this **pre-market (~8:30 ET)**: you're building the bias for the *cash open*. State whether the 1H setup is "ready now" or "wait for the 9:30 open to confirm the trigger."
- **Asia / After Hours:** lower conviction unless a clear overnight catalyst is driving.
- Always state the current session in the output.

### 1C: Light Economic-Calendar Flag

Both instruments are US indices, so the **US economic calendar** drives them — do this check **once per run** and apply it to both. Watch for: CPI, PPI, NFP, Jobless Claims, GDP, ISM, Retail Sales, FOMC, Fed speakers.

Search: `"high impact US economic calendar today [date]"`.

**Rules:**
- **8:30 ET is the single most common US release time.** Before committing a pre-market direction on a US instrument, explicitly confirm whether an 8:30 release is scheduled today.
- High-impact event **within 15 min** (before or after): the read is **DEPENDS** until the number prints — don't commit a direction into the release. Trade the reaction after.
- Event **15–60 min ago**: the bias is the **reaction**, not the prediction — the post-news 1H direction leads.
- No high-impact events: proceed on technicals.
- Do NOT pull in social posts, analyst "outlooks," or chatroom calls. Scheduled data only.

### 1D: Previous-Session Levels (from Daily)

Pull the Daily OHLCV and read the **second-to-last completed bar** (yesterday):

| Level | How to Get |
|---|---|
| **PDH** (prev day high) | Daily, 2nd-to-last bar `high` |
| **PDL** (prev day low) | 2nd-to-last bar `low` |
| **PDC** (prev day close) | 2nd-to-last bar `close` |
| **Overnight High / Low** | Extremes since yesterday's close (from 1H/4H overnight bars) |

**First clear stale previous-day lines, then draw fresh ones.** PDH/PDL/PDC change every day, so old ones must not stack up: from the Phase 1A `draw_list` snapshot, `draw_remove_one` on any horizontal line labeled `PDH`, `PDL`, or `PDC` (these are the skill's own from a prior run — never remove differently-labeled user lines).

**Then draw PDH and PDL** with `draw_shape` `horizontal_line` (label them "PDH" and "PDL"), using the **purple** previous-day color: `overrides: '{"linecolor": "#9c27b0", "linewidth": 2}'`. Record the returned drawing IDs. (Draw PDC in the same purple too if useful.)

- Price **above PDH** = breakout, bullish lean, PDH flips to support.
- Price **below PDL** = breakdown, bearish lean, PDL flips to resistance.
- Price **inside PDH–PDL** = watch the boundaries for rejection/breakout.
- **PDC** is equilibrium: above = intraday bullish lean, below = bearish lean.
- These are among the strongest intraday levels — always include them in the S/R map.

---

## Phase 2: Indicators (Optional)

You do **not** need any indicator to form the bias — price action leads. Keep whatever the user already has on the chart. The three below are lightweight aids; add one only if you judge it will genuinely sharpen the read, and clean up whatever you add (Phase 5).

| Indicator | Full name for `chart_manage_indicator` | Purpose |
|---|---|---|
| VWAP | `VWAP` | Intraday S/R / bias line |
| ATR | `Average True Range` (`{"length": 14}`) | Volatility ruler for sizing (read on the 1H) |
| Volume | `Volume` | Conviction confirmation |

If you decide an EMA, pivots, or anything else would help on a given timeframe, add it — but it's your judgment call, not a requirement, and it gets removed in cleanup.

---

## Phase 3: Top-Down Scan (Daily → 1H, + optional 15m)

Analyze these timeframes in order. Daily and 4H set **context**; the **1H is where the bias, setup, and trigger live**; the 15m is **optional** and used only to time the fill. For each: `chart_set_timeframe` → then read:
- `data_get_study_values` — VWAP / ATR readings (and any indicator you added)
- `data_get_ohlcv` with `summary: true` — range, change%, avg volume
- `data_get_ohlcv` with `count: 20` — swing highs/lows, structure, and volume
- `capture_screenshot` — visual confirmation
- Then assess **structure, volume, and S/R** (below). **Identify fair-value gaps (FVGs) yourself** from the candles — a 3-bar imbalance where bar 1's and bar 3's wicks don't overlap. Unfilled bullish FVG below price = support; unfilled bearish FVG above = resistance; a filled gap loses its value.

### What each timeframe tells you

| TF | Role — read for… |
|---|---|
| **Daily** | **Macro context only.** HH/HL (bull) vs LH/LL (bear). Position relative to major swing walls. Do NOT enter off this. |
| **4H** | **Structural bias.** The dominant structure and clear patterns (channel, double top/bottom, H&S). Sets the directional lean; doesn't override the 1H. |
| **1H** | **PRIMARY — setup + trigger.** Structure (break of structure / change of character), reactions at key S/R, VWAP, and PDH/PDL. **The trigger is a 1H candle *closing* as an engulf / pin / BOS at an S/R level.** This is where you enter. |
| **15m** | **Optional precision.** Use ONLY to fine-tune the fill inside a valid 1H setup (e.g. wait for a 15m pullback into the 1H level). It never creates or vetoes the trade. |

### Volume (each timeframe)
- Compare current/last bars to `avg_volume` from the summary.
- **>1.5× avg** on a directional candle = real conviction, trust it.
- **<0.5× avg** = weak, likely a fake-out.
- Volume **expanding** with the move = continuation; **drying up** after a move = exhaustion, expect pullback/reversal.
- Breakout of S/R on **high** volume = real; on **low** volume = trap, expect snap-back.

### ATR-based sizing (read ATR(14) on the **1H**)
Your volatility ruler in the instrument's native unit — sized to a trade held on a 1H basis, not sub-hourly noise.
- **Targets ≈ 1.5–2.5× 1H ATR.** Never target beyond ~2.5× — unlikely to hit intraday.
- **Stops ≈ 1–1.5× 1H ATR.** Never tighter than 1× — normal intra-hour noise will stop you out.
- **Compare current 1H ATR to its own recent average.** If it's near multi-day lows and price is coiling, expect chop → lower confidence, lean DEPENDS.

**After scanning, leave the chart on the 1H for the user.**

---

### Phase 3A: Support & Resistance

S/R is the core of the bias. Build a map from all of these sources — **weight them equally** — then find the **nearest support and nearest resistance to current price**; those define the trade's playground.

- **Swing highs/lows and repeated wick-rejections** — from the OHLCV data and the screenshot. Multiple touches at the same price = a stronger level.
- **Consolidation-zone edges** — the top and bottom of ranges where price spent time.
- **PDH / PDL / PDC** and the overnight high/low (from Phase 1D). Among the strongest intraday levels.
- **VWAP** — above = intraday bull (VWAP acts as support); below = intraday bear (VWAP acts as resistance).
- **FVGs you identify yourself** — unfilled bullish gap below = support, unfilled bearish gap above = resistance; filled gaps lose value.
- **Any optional indicator you added** — e.g. an EMA as dynamic S/R, or pivots — only if it's actually on the chart.

**Draw every key level** on the chart with `draw_shape` `horizontal_line` (PDH and PDL are already drawn in Phase 1D — add the other important S/R). Label them clearly (e.g. "R1 24,910", "S1 24,540").

**Line colors — never use base red (`#ff0000`) or green (`#00ff00`).** Pass the color via `overrides`:
- **Resistance** levels → orange: `overrides: '{"linecolor": "#ff9800", "linewidth": 2}'`
- **Support** levels → blue: `overrides: '{"linecolor": "#2962ff", "linewidth": 2}'`
- **Previous-day levels** (PDH/PDL/PDC) → purple `#9c27b0` (set in Phase 1D)

**These lines STAY on the chart after the scan — they are the deliverable the user trades off; do not remove them in cleanup.** Track the ID of every line you draw. **Never remove or clear a line the user already had (you recorded those in Phase 1A).**

**Confluence:** a level backed by **2+ of these sources** or by **multiple timeframes** is high-confidence. If price sits mid-gap with no level within ~1× ATR, the read there is **DEPENDS/reactive** — mark the bracketing levels and note that direction resolves on a reaction at one of them.

---

### Phase 3B: SMT Divergence Check — NAS100USD / SPX500USD

**Run this section ONLY on the `NAS100USD` pass.** On the US30USD pass, skip it entirely (report SMT as `n/a` — US30 has no SMT peer defined here). For NAS100, the comparison feed (**PEER**) is **SPX500USD**. (The check is written PRIMARY/PEER so it also works if the chart is ever on SPX500USD directly — then NAS100USD is the peer — but in this skill's fixed scope it only fires on the NAS100 pass.)

Below, **PRIMARY** = the index being analyzed, **PEER** = the correlated one you pull for comparison. NAS100 (Nasdaq 100) and SPX500 (S&P 500) are tightly correlated US indices — institutions read their *disagreement* at a swing extreme as a reversal / liquidity-sweep tell.

**What it is:** two correlated markets normally mirror each other's swing highs and lows. An **SMT divergence** is when one makes a **higher high** (or **lower low**) while the other **fails to** — printing a lower high (or a higher low) instead. The index that failed to confirm is showing relative weakness/strength, and the extreme that got swept is often a false break that reverses. It replaces indicators like RSI as the confirmation — it's pure price disagreement. (The divergence is the same event whichever index you're sitting on — the chart symbol just decides which one is PRIMARY.)

**How to run it (without disturbing the active chart):**
1. Pull the **PEER** OHLCV with `batch_run` (`symbols: ["<PEER>"]`, `action: "get_ohlcv"`, ~30 bars) for the **1H** (anchor) and **15m** (fine); 4H is optional context. Using `batch_run` reads the peer symbol **without switching the user's chart or its drawn lines**. (Fallback only if it can't return enough bars: `chart_set_symbol` to the PEER, read, then switch back to the PRIMARY.)
2. On the **PRIMARY**, take the **last two comparable swing highs** and the **last two comparable swing lows** on that timeframe.
3. At the **same bar timestamps** (the bars align — same session), read what the **PEER** did.
4. Compare:
   - PRIMARY **higher high**, PEER **lower high** (or vice-versa) → **bearish SMT** at the highs.
   - PRIMARY **lower low**, PEER **higher low** (or vice-versa) → **bullish SMT** at the lows.
   - Both confirm (both HH, or both LL) → **no divergence** — the move is corroborated, trend is healthy.

**How it feeds the bias:**
- A **bearish SMT at resistance / a PDH sweep** strengthens a SHORT (the high was a false break). A **bullish SMT at support / a PDL sweep** strengthens a LONG. Weight it like a strong extra S/R confluence.
- SMT is a **confirmation tool, not a standalone trigger** — it raises or lowers confidence around the 1H trigger, it does not replace it.
- If SMT **contradicts** the 1H bias (e.g. bias is LONG but a bearish SMT just printed at resistance), lower confidence one level or lean **DEPENDS**.
- Always report which index led, which failed, at what level, and on what timeframe.

**Also mark PDH/PDL on the SPX500USD chart.** SPX is the SMT reference, so keep its previous-day levels drawn and current:
1. Get SPX500USD's previous-day high and low from its **Daily** OHLCV (the 2nd-to-last completed bar) — via `batch_run` `get_ohlcv` on the Daily, or read it after switching.
2. `chart_set_symbol` to `OANDA:SPX500USD`, then `draw_list` on it.
3. **Remove any stale previous-day lines** there: `draw_remove_one` on horizontal lines labeled `PDH`/`PDL` (the skill's own from a prior run) — never touch the user's other SPX lines.
4. Draw the fresh **PDH** and **PDL** with `draw_shape` `horizontal_line`, labeled, in the purple previous-day color (`overrides: '{"linecolor": "#9c27b0", "linewidth": 2}'`).
5. `chart_set_symbol` back to `OANDA:NAS100USD` to finish the pass.

---

## Phase 4: Compile the Bias & Trade Plan

### Reconcile the prior call — UPDATE runs only
If Phase 0 loaded an earlier run today, grade it **before** writing the new bias, using only **closed 1H bars** since that run (per symbol):
- **Resolving level / trigger hit?** A *closed* 1H bar through the prior DEPENDS level means it has **resolved** — state which way, and carry that into today's read.
- **Stop / invalidation hit?** The prior thesis is **dead** — say so plainly; don't quietly re-issue it.
- **T1 / T2 reached?** The prior trade **worked** — note it, and whether it's still live or done.
- **Scheduled event printed since the last run?** (Phase 1C) Fold in the **actual result and the reaction** — the post-news 1H direction leads the read now.

Then issue the updated call, which may **confirm, upgrade, downgrade, or flip** the prior one, and surface the reconciliation in the output header (below). On a BASELINE run, skip this section.

### When the read is DEPENDS (conditional)
The call is **DEPENDS** — a two-sided conditional rather than a single direction — when any of these hold. In that case, name the exact level whose 1H close resolves it, and give both scenarios.
- **1H is ranging** with no clean structure or closed trigger — direction resolves on the range break.
- **Weighted score is 0** (or ±1) — the timeframes conflict.
- **Price is mid-gap** with no S/R within ~1× ATR.
- **High-impact news within 15 min** — don't commit ahead of the print; resolve on the reaction.
- **ATR(14) 1H near multi-day lows** and price coiling — expect chop.

(Thin-liquidity contexts — Asia / After Hours, Friday after 2 PM ET, pre-holiday — don't force DEPENDS but should lower confidence.)

### Weighted timeframe score
Weight by relevance to a 1H-based entry, then multiply each TF's bias (+1 bull / −1 bear) by its weight:

| TF | 1H | 4H | Daily | 15m |
|---|---|---|---|---|
| Weight | **3** | **2** | **1** | **1** |

Range −7 … +7.

| Score | Confidence | Read |
|---|---|---|
| +5…+7 / −5…−7 | HIGH | Strong directional call |
| +3…+4 / −3…−4 | MODERATE | Directional, tighter stop |
| +1…+2 / −1…−2 | LOW | Weak lean — likely **DEPENDS** |
| 0 | CONFLICTING | **DEPENDS** — give the conditional |

**Hard rules:**
- **The 1H is the anchor.** A directional (LONG/SHORT) call needs clean 1H structure *and* a trigger candle that has **closed**. If the 1H is ranging, or the trigger candle is still forming, the call is **DEPENDS** — state the level whose 1H close resolves it.
- **15m is fill-timing only.** It cannot create a trade the 1H doesn't support, and it cannot veto a valid 1H trigger.
- **Daily/4H against the trade is acceptable intraday** — you're trading the 1H momentum. But if **both** Daily and 4H oppose the 1H, drop confidence one level.

### Final Output Format

Lead with the combined read, then one full block per instrument (US30USD, then NAS100USD).

```
# INTRADAY BIAS — [date, current session] — [BASELINE | UPDATE (prior run HH:MM ET)]
Combined read: [US30 and NAS100 both LONG → risk-on tape | both SHORT → risk-off | DIVERGENT: US30 [x] / NAS100 [y] — caution, indices disagree]

═══════════════════════════════════════
## INTRADAY BIAS — [SYMBOL]: [LONG / SHORT / DEPENDS]
Confidence: [HIGH / MODERATE / LOW]   Weighted Score: [X/7]
Update (UPDATE runs only): Prior [HH:MM ET] [call + level] → Since: [what price did on closed 1H bars — trigger / stop / T1] → Now: [confirm / upgrade / downgrade / flip]

### Context
- Symbol / Instrument: [ticker — type, native unit]
- Session: [name] — Quality: [HIGH / MODERATE / LOW]  (Pre-market note: [ready now / wait for 9:30 open])
- ATR(14) 1H: [X units] — [Low / Normal / High / Extreme] vs recent
- Volume: [Above / At / Below] average
- Calendar: [None / EVENT at TIME — X min away / reaction to EVENT X min ago]
- PDH [x] | PDL [x] | PDC [x]  →  Price is [above PDH / below PDL / inside range]
- SMT (NAS100USD ↔ SPX500USD only): [Bearish SMT at the highs, 1H — primary made HH / peer made LH | Bullish SMT at the lows, 1H | None — both confirm | n/a (not NAS100/SPX500)]

### Where Price Is Heading
[2–3 sentences: the directional thesis and the level(s) price is being drawn toward, in plain terms.]

### Key S/R Near Price
| Level | Price | Source(s) | TF(s) | Type |
|---|---|---|---|---|
| R2 | … | … | … | Resistance |
| R1 | … | … | … | Resistance |
| — PRICE — | … | | | |
| S1 | … | … | … | Support |
| S2 | … | … | … | Support |

### Trade Plan
[For LONG or SHORT:]
- Entry: [zone — at/near an S/R level]  |  Trigger: [1H candle close confirmation at the level; optional 15m pullback for the fill]
- Stop: [price — behind an S/R level, ≥1× 1H ATR from entry]  |  Reasoning: [structure it sits behind]
- T1: [price — next S/R] (+X units, ~X.X× ATR)
- T2: [price — second S/R] (+X units, ~X.X× ATR)
- Risk / Reward: [X units risk : X–X units reward → X:X]

[For DEPENDS — give both sides with the resolving level:]
- LONG on 1H close above [X] → target [next S/R], stop [below level]
- SHORT on 1H close below [Y] → target [next S/R], stop [above level]

### Invalidation
- [Specific price + a 1H close beyond an S/R level that kills the thesis]
- [Volume/structure condition that would flip it — e.g. "1H breakout on declining volume"]

═══════════════════════════════════════
[repeat the full block above for the second instrument]
```

---

## Phase 5: Cleanup
*(Run cleanup at the end of each symbol's pass, or once at the very end — but keep it per-symbol since drawings are symbol-scoped.)*
- Remove any indicators you added that weren't already on that symbol's chart (`chart_manage_indicator` remove by entity_id).
- **KEEP every S/R line you drew** — PDH, PDL, PDC, and all the key support/resistance levels. Do NOT remove them when the scan finishes; the user wants them left on the chart to trade off during the session.
- **Never use `draw_clear`, and never remove a drawing the user already had** (you snapshotted those in Phase 1A). The only drawings that ever leave the chart are ones you explicitly decide to redraw more accurately — and even then, remove only that specific ID via `draw_remove_one` and replace it immediately.
- Set each symbol's chart to the **1H** timeframe. When both passes are done, **restore the originally active symbol** (recorded at the start) on the 1H.

---

## Phase 6: Log the Run (persist for the next run)

After presenting the reports, **append** this run to **`intraday-bias-logs/<YYYY-MM-DD>.md`** (ET date; create the file on the BASELINE run). This file is read by the *next* run's Phase 0 — keep it terse and scannable, not prose. Append in order; **never overwrite** — the day's file accumulates the baseline plus every update.

Write, per run:
- A header line: `## <HH:MM ET> — <BASELINE | UPDATE>` (+ session name).
- One line per symbol: call, confidence, resolving level / trigger, entry, stop, T1/T2, and SMT (NAS100 only).
- On UPDATE runs, a `since:` note per symbol — how the prior call played out (trigger / stop / T1 hit).

Example (indented so it needs no code fences; the file itself is plain markdown):

    ## 09:47 ET — BASELINE (NY Open)
    US30USD: DEPENDS-bullish | LONG >52,394 | stop 52,270 | T1 52,512 | VWAP 52,286
    NAS100USD: DEPENDS | pivot 30,000 (short <30,000 / long reclaim 30,143) | SMT bullish @ lows

    ## 10:05 ET — UPDATE (NY Open)
    US30USD: LONG (MOD) | since: 9:00 bar swept PDL 52,129, closed 52,380 → resolved LONG | T1 52,446 T2 52,512 | stop 52,230
    NAS100USD: DEPENDS | since: swept <30,000 to 29,944, no 1H close below → still two-sided | watch 30,143 reclaim

---

## REMINDERS
- **The 1H is the anchor.** Bias, setup, and trigger all live there. Daily/4H are context; 15m only times the fill. Don't let sub-1H noise talk you out of a valid 1H trigger.
- **Wait for the 1H close.** A trigger candle that's still forming is not a trigger. Don't act on a wick.
- **DEPENDS is a valid call — but always attach the resolving level.** "DEPENDS — long above X, short below Y," never a vague shrug.
- **Trade from S/R, not from air.** Entry AT a level, stop BEHIND a level, target AT the next level.
- **1H ATR sizes everything.** Targets 1.5–2.5× ATR, stops 1–1.5× ATR. Dead ATR = chop → lean DEPENDS.
- **Volume confirms.** High-volume break = real; low-volume break = trap.
- **Broken levels flip.** Track them.
- **Mark PDH/PDL and all key S/R on the chart, and LEAVE them there after the scan** — they're what the user trades off. Never delete your own S/R lines in cleanup, and never touch the user's pre-existing lines.
- **Line colors: orange = resistance, blue = support, purple = previous-day levels. Never base red or green.**
- **Refresh previous-day lines each run.** Up front, delete the skill's own stale `PDH`/`PDL`/`PDC` lines (they change daily) before redrawing — on US30, NAS100, **and the SPX500USD chart**. This is the one exception to "never remove your own lines," and it happens at the start, not in cleanup; user-drawn lines are still never touched.
- **On NAS100USD or SPX500USD, check SMT against the other.** Bearish SMT at the highs / bullish SMT at the lows is strong reversal confirmation — but it confirms the 1H trigger, it doesn't replace it.
- **Two instruments, two independent reads.** Analyze US30USD and NAS100USD in full each run. Never share levels or ATR numbers between them — they trade on very different point scales. A divergence between the two calls is itself a signal (flag it in the Combined read).
- **Respect 8:30 ET.** It's the prime US data slot — check the calendar before any pre-market position.
- **Be direct.** "SHORT at [x], stop [x], target [x]." Not "consider watching for potential weakness."
- **Every run is baseline or update.** Phase 0 reads `intraday-bias-logs/<date>.md` first; Phase 6 writes back to it. On an update, reconcile the earlier call (did it trigger / stop / hit T1?) before issuing the new one — never just re-issue a standalone read.
