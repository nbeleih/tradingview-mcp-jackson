# Session Biases Log

One file per `/session-bias` call, named `YYYY-MM-DD-<SYMBOL>.md` (e.g. `2026-04-14-US30.md`).

Each file captures:
- Time called + session
- Bias (LONG / SHORT / NO TRADE), confidence, weighted score
- Setup snapshot: price, news backdrop, PDH/PDL/PDC, key confluence
- Entry zone + stop + targets as recommended
- Outcome reported by the user (direction correct? entry filled? target hit?)

If `/session-bias` is re-run on the same symbol later the same day, append a new `## Call 2 (HH:MM ET)` section to the existing file rather than overwriting.
