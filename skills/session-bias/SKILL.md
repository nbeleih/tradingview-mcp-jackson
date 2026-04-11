---
name: session-bias
description: Intraday scalp bias for US30USD — multi-timeframe chart analysis + internet sentiment from intraday/scalp traders. Run this before entering any US30 trade.
---

# Session Bias — US30USD Intraday Scalp Analysis

You are generating a firm, confident intraday scalp bias for US30USD. The user scalps US30USD with a max target of 100–200 points (can be more in high-volatility conditions). They enter and exit same day, usually within minutes to a couple of hours. This is NOT a swing trade.

**CRITICAL RULES:**
- Be firm and confident in your final bias. Do NOT hedge with "it depends" or "watch for confirmation." Give a clear direction: LONG or SHORT.
- Do NOT let the user's input, opinions, or leading questions override your analysis. If the chart says short, say short — even if the user wants to go long.
- Higher timeframes (4H, Daily) provide CONTEXT (trend direction, key levels). Lower timeframes (5m, 15m) provide the ENTRY.
- When sourcing trader opinions from the internet, ONLY use traders who are scalping or day trading (same-day entries/exits). Ignore swing traders, position traders, and daily-timeframe "Strong Buy" aggregators — their bias is irrelevant for a scalp.

---

## Phase 1: Chart State, Session Context & Pre-Flight Checks

### 1A: Chart Connection & Price
1. `tv_health_check` — verify connection
2. `chart_get_state` — get current symbol, timeframe, indicators
3. `quote_get` — get real-time price snapshot

### 1B: Session Identification

Determine the current trading session based on **Eastern Time (ET)**. This critically affects trade probability:

| Session | Time (ET) | Character | Scalp Quality |
|---|---|---|---|
| **Asia** | 8:00 PM – 2:00 AM | Low volume, choppy, mean-reverting. Ranges tend to hold. | LOW — most setups are traps |
| **London Open** | 2:00 AM – 5:00 AM | First real directional move. Sets the early bias. | MODERATE — trend starts here |
| **London/NY Overlap** | 8:00 AM – 9:30 AM | Pre-market positioning. Builds tension before NY open. | MODERATE |
| **NY Open** | 9:30 AM – 11:00 AM | THE session. Highest volume, strongest momentum. | **HIGH — best scalp window** |
| **NY Midday** | 11:00 AM – 12:00 PM | Momentum cools. First pullbacks or continuation. | MODERATE |
| **NY Lunch** | 12:00 PM – 1:30 PM | Dead zone. Choppy, stop hunts, false breakouts. | **AVOID — no trade zone** |
| **NY PM** | 1:30 PM – 4:00 PM | Can trend or reverse AM move. Institutions close positions. | MODERATE — lower conviction |
| **After Hours** | 4:00 PM – 8:00 PM | Thin liquidity. Unreliable moves. | LOW — avoid |

**Rules:**
- If currently in **NY Lunch (12–1:30 PM ET)**: default to NO TRADE unless there is an extreme setup (3+ confluent S/R levels + news catalyst). Flag this prominently.
- If currently in **Asia or After Hours**: flag LOW probability. Only trade if there's a clear catalyst (overnight news).
- If currently in **NY Open (9:30–11 AM ET)**: highest conviction window — this is where you want to be trading.
- Always state the current session in the final output.

### 1C: Economic Calendar / News Check

Search the web for today's high-impact economic events:
- "US economic calendar today [date]"
- "high impact news forex today [date]"

Check for events like: **FOMC, CPI, PPI, NFP, Jobless Claims, GDP, ISM, Fed Speakers, Earnings** (especially Dow components).

**Rules:**
- If a high-impact event is within **15 minutes** (before or after): **NO TRADE**. Wait for the dust to settle.
- If a high-impact event happened **15–60 minutes ago**: trade the REACTION, not the prediction. The post-news direction on the 5m/15m is the bias.
- If no high-impact events today: proceed normally — technicals dominate.
- If a Fed speaker or earnings are during the session: flag it, be aware of potential volatility spikes.
- Always state upcoming events and their times in the final output.

### 1D: Previous Session Levels

These are among the most reliable intraday S/R levels. Retrieve them from the Daily timeframe OHLCV data (the second-to-last completed bar):

| Level | Description | How to Get |
|---|---|---|
| **PDH** (Previous Day High) | Yesterday's high | `data_get_ohlcv` on Daily, second-to-last bar's `high` |
| **PDL** (Previous Day Low) | Yesterday's low | Second-to-last bar's `low` |
| **PDC** (Previous Day Close) | Yesterday's close | Second-to-last bar's `close` |
| **Overnight High** | Highest price since yesterday's close to now | From the current day's bar or 1H/4H bars overnight |
| **Overnight Low** | Lowest price since yesterday's close to now | Same as above |

**Rules:**
- PDH and PDL are critical S/R. Price reacting to these = high-probability trade.
- If price is **above PDH** = strong bullish bias (breakout). PDH becomes support.
- If price is **below PDL** = strong bearish bias (breakdown). PDL becomes resistance.
- If price is **between PDH and PDL** = inside yesterday's range, watch for breakout/rejection at boundaries.
- PDC is the equilibrium — price above PDC = intraday bullish lean, below = bearish lean.
- Include ALL of these in the S/R confluence map (Phase 3A).

---

## Phase 2: Ensure Required Indicators

Check if these indicators are on the chart. Add any that are missing:

| Indicator | Full Name for `chart_manage_indicator` | Settings |
|---|---|---|
| Pivot Points | Pivot Points Standard | (default — Traditional Auto) |
| FVG/iFVG | Already on chart (Nephew_Sam_) | — |
| RSI | Relative Strength Index | `{"length": 14}` |
| VWAP | VWAP | (default) |
| ATR | Average True Range | `{"length": 14}` |
| Volume | Volume | (default) |

### EMA Setup — Timeframe-Specific

Each timeframe uses a different EMA length. **Swap the EMA setting as you move between timeframes** using `indicator_set_inputs` on the existing EMA indicator (do NOT add/remove EMAs each time — just change the length).

| Timeframe | EMA Length | Why |
|---|---|---|
| **5m** | **9** | ~45 min of data. Fast momentum for scalp triggers. |
| **15m** | **21** | ~5.25 hours. One session of data. Clean dynamic S/R for entries. |
| **30m** | **21** | ~10.5 hours. Confirms 15m session trend. |
| **1H** | **50** | ~50 hours (~2.5 trading days). Separates noise from real session direction. Institutional level. |
| **4H** | **50** | ~200 hours (~10 trading days). Structural trend — big money respects this. |
| **Daily** | **200** | ~200 trading days. THE institutional benchmark. Above = macro bullish. Below = macro bearish. |

**On 5m and 15m**, you may optionally add a second EMA (EMA 21 on 5m, or EMA 9 on 15m) to watch for crossovers as momentum confirmation. Clean up the extra EMA after analysis.

You MAY add additional indicators if you believe they will strengthen your read (e.g., ATR for volatility, MACD for momentum). Use your judgment — but always clean up any indicators you add at the end.

---

## Phase 3: Multi-Timeframe Analysis (TOP-DOWN)

Analyze ALL timeframes in this order. For each timeframe:
- Switch with `chart_set_timeframe`
- **Set the EMA length** for this timeframe via `indicator_set_inputs`
- Read `data_get_study_values` (EMA, RSI, VWAP, ATR readings)
- Read `data_get_ohlcv` with `summary: true`
- Read `data_get_ohlcv` with `count: 20` (to identify swing highs/lows for manual S/R + volume analysis)
- Read `data_get_pine_labels` with `study_filter: "Pivot"` (pivot levels)
- Read `data_get_pine_boxes` with `study_filter: "FVG"` (fair value gaps)
- Take `capture_screenshot`
- **Analyze Volume** (see volume rules below)
- **Identify Support & Resistance** (see Phase 3A below)

### Volume Analysis Rules

On every timeframe, check volume on the most recent bars from the OHLCV data:

- **Compare current bar volume to the 20-bar average volume** (from the summary `avg_volume`)
- Volume **> 1.5x average** on a directional candle = **strong conviction move** — trust it
- Volume **< 0.5x average** = **weak move** — likely fake-out or low participation, don't trust it
- **Volume expanding** in the direction of the move (each successive candle has higher volume) = momentum is real, trend continuation
- **Volume drying up** after a move = exhaustion, expect a pullback or reversal
- A breakout of S/R on **high volume** = real breakout. On **low volume** = likely a trap, expect a snap-back.
- On the 15m and 5m, volume spikes often coincide with **NY open and London open** — this is normal and confirms directional moves during those sessions

### ATR-Based Target & Stop Sizing

Read **ATR(14) on the 15m** — this is your volatility ruler for the scalp:

| ATR(14) on 15m | Market State | Target Range | Stop Range |
|---|---|---|---|
| < 30 pts | Low volatility / choppy | 50–80 pts (1.5–2.5x ATR) | 30–45 pts (1–1.5x ATR) |
| 30–60 pts | Normal volatility | 80–150 pts (1.5–2.5x ATR) | 45–90 pts (1–1.5x ATR) |
| 60–100 pts | High volatility | 120–200 pts (1.5–2.5x ATR) | 70–120 pts (1–1.5x ATR) |
| > 100 pts | Extreme volatility (news) | 150–250+ pts | 100–150 pts |

**Rules:**
- **Never set a target that exceeds 2.5x the 15m ATR** — it's unlikely to hit in a scalp timeframe.
- **Never set a stop tighter than 1x ATR** — you'll get stopped out by normal noise.
- If ATR is very low (< 20 pts), consider NO TRADE — the market isn't moving enough to scalp.

### Timeframe Order:

#### 1. Daily (D) — TREND CONTEXT ONLY — EMA 200
- Set EMA length to 200 via `indicator_set_inputs`
- What is the dominant trend? (Higher highs/lows = bullish, lower highs/lows = bearish)
- Where is price relative to the **Daily 200 EMA**? Above = macro bullish. Below = macro bearish. This is the line institutions watch.
- Any major daily FVGs or pivot levels nearby?
- Identify major swing highs/lows as long-term S/R (these are walls that even scalps respect)
- **Do NOT base entry on this timeframe.**

#### 2. 4H — STRUCTURAL BIAS — EMA 50
- Set EMA length to 50
- Is price above or below the **4H 50 EMA**? This is the structural trend line.
- Key 4H pivot levels and FVG zones near current price
- Is there a clear 4H structure (H&S, double top/bottom, channel)?
- Mark key 4H swing highs/lows and consolidation zones as structural S/R
- **This sets the directional lean, but does NOT override lower TF momentum.**

#### 3. 1H — SESSION BIAS — EMA 50
- Set EMA length to 50
- Where is price relative to the **1H 50 EMA**, VWAP, and pivots?
- Any 1H FVGs that price is reacting to?
- RSI reading — overbought/oversold on the 1H?
- Identify 1H swing highs/lows as session-level S/R
- Note any repeated price rejections at specific levels
- **This is the session-level bias.**

#### 4. 30m — TRANSITION ZONE — EMA 21
- Set EMA length to 21
- Confirms or contradicts the 1H bias
- Look for momentum shifts (EMA crosses, RSI divergence)
- Identify S/R levels that align with 1H levels (confluence = stronger)

#### 5. 15m — ENTRY TIMEFRAME — EMA 21
- Set EMA length to 21
- Price action structure (break of structure, FVG mitigation, **21 EMA rejection**)
- This is where the trade setup forms
- Pivot breaks, **21 EMA tests**, FVG fills
- Identify the nearest S/R levels above and below price — these define your entry, stop, and target
- Note any broken S/R levels that have flipped (broken support → resistance, broken resistance → support)
- Is the 21 EMA sloping up or down? Sloping = momentum. Flat = ranging.

#### 6. 5m — PRECISION ENTRY — EMA 9
- Set EMA length to 9
- Fine-tune the exact entry level
- Look for confirmation candles (engulfing, pin bar, momentum shift) **at an S/R level**
- This is the trigger timeframe
- Entry should ideally be at or near a confluent S/R level, not in empty space
- Watch for price rejecting or reclaiming the **9 EMA** — this is your momentum trigger
- Optional: temporarily add a second EMA (21) to check for 9/21 crossover confirmation

**After scanning all timeframes, switch back to 15m for the user.**

---

### Phase 3A: Support & Resistance Identification

S/R is a CORE part of your bias. On every timeframe, build a confluence map of support and resistance levels using ALL of these sources:

#### Source 1: Pivot Points (Traditional Auto)
- Read directly from `data_get_pine_labels` with `study_filter: "Pivot"`
- Identify the nearest P, R1, R2, R3, S1, S2, S3 to current price
- Note which pivots have been broken (now flipped — broken support = resistance, broken resistance = support)

#### Source 2: Manual S/R from Price Action
- From OHLCV data, identify **swing highs** and **swing lows** (bars where high/low is higher/lower than the bars on either side)
- Look for **repeated rejections** at the same price level (multiple wicks touching a level = strong S/R)
- Look for **consolidation zones** where price spent time ranging (the top and bottom of the range are S/R)
- Use the screenshot to visually confirm horizontal levels where price clearly reversed multiple times
- **Draw these levels** on the chart using `draw_shape` with `horizontal_line` so the user can see them

#### Source 3: FVG Zones as S/R
- Bullish FVGs (unfilled, below price) act as **support**
- Bearish FVGs (unfilled, above price) act as **resistance**
- Mitigated/filled FVGs lose their S/R value

#### Source 4: EMA as Dynamic S/R
- Each timeframe has its own EMA (9 on 5m, 21 on 15m/30m, 50 on 1H/4H, 200 on Daily)
- In an uptrend, the EMA acts as **dynamic support** (price bounces off it)
- In a downtrend, the EMA acts as **dynamic resistance** (price rejects from it)
- Note whether the EMA is flat (ranging), sloping up (bullish), or sloping down (bearish)
- **Higher TF EMAs carry more weight as S/R.** The 4H 50 EMA is a stronger level than the 5m 9 EMA.

#### Source 5: VWAP as Intraday S/R
- Price above VWAP = intraday bullish bias, VWAP acts as support
- Price below VWAP = intraday bearish bias, VWAP acts as resistance
- VWAP is most relevant on 5m, 15m, 30m timeframes

#### Source 6: Previous Session Levels (PDH / PDL / PDC)
- Retrieved in Phase 1D
- **PDH** and **PDL** are among the strongest intraday S/R levels — institutions key off these
- **PDC** is the equilibrium level — acts as a magnet and pivot for intraday direction
- If price breaks above PDH = breakout, PDH becomes support
- If price breaks below PDL = breakdown, PDL becomes resistance
- If price is inside PDH-PDL range = watch for rejection at boundaries
- These levels have HIGH weight in the confluence map — treat them like multi-TF pivot levels

#### S/R Confluence Rules
- A level that appears on **2+ sources** (e.g., Pivot S1 + swing low + bullish FVG top) is a **HIGH CONFIDENCE** level
- A level that appears on **multiple timeframes** is stronger than a single-TF level
- Always identify the **nearest support** and **nearest resistance** to current price — these define the trade's playground
- If price is in the middle of a wide S/R zone with no nearby levels, it's a **no-trade zone** — wait for price to reach a level

#### S/R Summary Table (include in final output)

```
### Key S/R Levels Near Price
| Level | Price | Source(s) | TF(s) | Type |
|---|---|---|---|---|
| R3 | XXXXX | Pivot R1 + swing high | 1H, 4H | Strong resistance |
| R2 | XXXXX | Bearish FVG top | 15m | Resistance |
| R1 | XXXXX | 15m EMA 21 + broken pivot | 15m, 30m | Dynamic resistance |
| --- PRICE --- | XXXXX | | | |
| S1 | XXXXX | Pivot P + VWAP | 15m, 1H | Strong support |
| S2 | XXXXX | Bullish FVG + swing low | 30m | Support |
| S3 | XXXXX | Pivot S1 | 4H | Support |
```

Use these levels to define your **entry zone** (at S/R), **stop loss** (behind S/R), and **targets** (next S/R level).

---

## Phase 4: Internet Sentiment — INTRADAY TRADERS ONLY

Search the web for what INTRADAY and SCALP traders are doing on US30 today. Use queries like:
- "US30 intraday scalp trade today [date]"
- "US30 day trade setup today [date]"  
- "Dow Jones intraday analysis today [date]"
- "US30 scalp long short today site:x.com"

**FILTER RULES:**
- ONLY include traders who enter and exit within the same session (minutes to hours)
- IGNORE swing traders, position traders, weekly outlook analysts
- IGNORE daily-timeframe "Strong Buy/Sell" aggregators (Investing.com summary, etc.)
- For each trader, note: Name, handle, direction (long/short), entry, target, reasoning
- If you cannot confirm a trader is intraday, exclude them

---

## Phase 5: Compile Bias & Trade Recommendation

### No-Trade Checklist

Before outputting a trade, run through this checklist. If ANY condition is true, the output is **NO TRADE** (with explanation):

- [ ] **NY Lunch (12:00–1:30 PM ET)** — unless extreme setup (3+ confluent S/R + news catalyst)
- [ ] **High-impact news within 15 minutes** (before or after release)
- [ ] **ATR(14) on 15m < 20 pts** — market is dead, nothing to scalp
- [ ] **5m and 15m disagree on direction** — no trigger alignment
- [ ] **Weighted score between -2 and +2** — conflicting timeframes
- [ ] **Volume on last 3 bars < 0.5x average** — no participation, moves are unreliable
- [ ] **RSI between 45–55 on ALL of 5m, 15m, 30m, 1H** — no momentum anywhere
- [ ] **Price is in the middle of a wide S/R gap** with no level within 50 pts — nothing to trade off of
- [ ] **Asia session or After Hours** — unless a clear overnight catalyst exists
- [ ] **Friday after 2 PM ET** or **pre-holiday session** — thinning liquidity, unreliable

If all clear, proceed with the trade.

### Multi-Timeframe Summary Table

| Timeframe | EMA (period) | Price vs EMA | RSI | VWAP | Volume vs Avg | Nearest S/R | FVG Status | Weight | Bias |
|---|---|---|---|---|---|---|---|---|---|
| Daily | 200 | above/below | value | — | — | level (type) | — | x1 | Bullish/Bearish |
| 4H | 50 | above/below | value | — | — | level (type) | zone | x1 | Bullish/Bearish |
| 1H | 50 | above/below | value | above/below | high/avg/low | level (type) | zone | x2 | Bullish/Bearish |
| 30m | 21 | above/below | value | above/below | high/avg/low | level (type) | zone | x2 | Bullish/Bearish |
| 15m | 21 | above/below | value | above/below | high/avg/low | level (type) | zone | x3 | Bullish/Bearish |
| 5m | 9 | above/below | value | above/below | high/avg/low | level (type) | zone | x3 | Bullish/Bearish |

### Decision Matrix — Weighted by Relevance to Scalp

NOT all timeframes are equal for a scalp. Weight them:

| Timeframe | Weight | Role |
|---|---|---|
| 5m | **3** | Entry trigger — must confirm |
| 15m | **3** | Entry setup — must confirm |
| 30m | **2** | Transition — adds conviction |
| 1H | **2** | Session bias — adds conviction |
| 4H | **1** | Context only |
| Daily | **1** | Context only |

**Scoring:** Multiply each timeframe's bias (+1 bullish / -1 bearish) by its weight. Max score = +12 (all bullish), Min = -12 (all bearish).

| Weighted Score | Confidence | Action |
|---|---|---|
| **+8 to +12** or **-8 to -12** | HIGH | Strong directional trade |
| **+5 to +7** or **-5 to -7** | MODERATE | Trade with tighter stop |
| **+3 to +4** or **-3 to -4** | LOW | Weak setup — consider NO TRADE |
| **-2 to +2** | CONFLICTING | **NO TRADE** — wait for alignment |

**Hard rules:**
- The **5m and 15m MUST agree** with the trade direction. If they don't, it's NO TRADE regardless of score.
- If the **1H and 30m contradict the 15m/5m**, reduce confidence by one level (HIGH → MODERATE, MODERATE → LOW).
- Daily and 4H being against the trade is acceptable for a scalp — you're trading momentum, not the macro trend.

### Final Output Format

```
## SESSION BIAS: [LONG / SHORT / NO TRADE]
Confidence: [HIGH / MODERATE / LOW]
Weighted Score: [X/12]

### Context
- Current Session: [Asia / London / NY Open / NY Midday / NY Lunch / NY PM]
- Session Quality: [HIGH / MODERATE / LOW / AVOID]
- ATR(14) 15m: [X pts] — [Low / Normal / High / Extreme] volatility
- Volume: [Above / At / Below] average
- News: [No events / EVENT at TIME — X min away]
- PDH: [price] | PDL: [price] | PDC: [price]
- Price vs PDH/PDL: [Above PDH / Below PDL / Inside range]

### Key S/R Levels Near Price
| Level | Price | Source(s) | TF(s) | Type |
|---|---|---|---|---|
| R3 | XXXXX | [sources] | [timeframes] | Resistance |
| R2 | XXXXX | [sources] | [timeframes] | Resistance |
| R1 | XXXXX | [sources] | [timeframes] | Resistance |
| --- PRICE --- | XXXXX | | | |
| S1 | XXXXX | [sources] | [timeframes] | Support |
| S2 | XXXXX | [sources] | [timeframes] | Support |
| S3 | XXXXX | [sources] | [timeframes] | Support |

### Entry
- Zone: [price range — must be at or near an S/R level]
- Trigger: [what confirms the entry on 5m/15m]
- S/R confluence: [which S/R level(s) support this entry]
- Volume confirmation: [what volume should look like to confirm]

### Stop Loss
- Level: [price — must be BEHIND an S/R level, at least 1x ATR away from entry]
- Reasoning: [what S/R structure it sits behind]

### Targets
- T1: [price — next S/R level] (+XX pts) — [X.Xx ATR]
- T2: [price — second S/R level] (+XX pts) — [X.Xx ATR]

### Risk/Reward
- Risk: XX pts | Reward: XX–XX pts | R:R: X:X

### Invalidation
- [What kills the trade — specific price + timeframe + S/R break]
- [Volume condition that would invalidate — e.g., "breakout on declining volume"]

### Intraday Trader Consensus
- [Name] (@handle): [direction] — [reasoning]
- [Name] (@handle): [direction] — [reasoning]
```

---

## Phase 6: Cleanup

Remove any indicators you added that weren't already on the chart. Leave the chart on 15m timeframe.

---

## REMINDERS

**Entry & Execution:**
- **Entry on lower TF.** The 5m/15m candle structure IS the entry — not "wait for 4H close."
- **Be direct.** "The trade is SHORT at 48,110, stop 48,220, target 47,920." Not "consider watching for potential bearish continuation."
- **Trade from S/R, not from air.** Every entry must be at or near a support/resistance level with confluence. If price is in the middle of nowhere between levels, wait.

**S/R Rules:**
- **S/R defines the trade.** Entry AT a level, stop BEHIND a level, target AT the next level. If the nearest S/R levels don't give you at least 1:1 R:R within 200 pts, it's a NO TRADE.
- **Broken levels flip.** A broken pivot support is now resistance. A broken swing high that gets reclaimed is now support. Always track flipped levels.
- **PDH/PDL are king.** Previous day high and low are the strongest intraday levels. Always include them.

**Bias & Timeframes:**
- **Swing bias ≠ scalp bias.** A stock can be in a daily uptrend and still have a valid 200-pt short scalp on the 15m.
- **Lower TF wins.** 5m and 15m outweigh 4H and Daily for the scalp direction. Weight accordingly.

**Volume & Volatility:**
- **Volume confirms.** A breakout on high volume is real. A breakout on low volume is a trap. Always check.
- **ATR sizes the trade.** Targets = 1.5–2.5x ATR. Stops = 1–1.5x ATR. Never ignore volatility.
- **Low ATR = no trade.** If the market isn't moving, don't force it.

**Session & News:**
- **Know your session.** NY Open is prime time. NY Lunch is a graveyard. Don't trade garbage sessions.
- **Respect the calendar.** No trades within 15 min of high-impact news. After news, trade the reaction.
- **Friday PM + pre-holiday = thin liquidity.** Reduce conviction or sit out.