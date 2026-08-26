#!/usr/bin/env node
//
// bias-dashboard.mjs — render a self-contained status dashboard for the scheduled
// intraday-bias jobs into bias-reports/dashboard.html.
//
// Reads what the scheduler already writes — no new state:
//   bias-reports/scheduler.log            (every 15-min fire: guard decision + outcome)
//   bias-reports/.state-<slot>-<date>     (per-slot: running|posted|idle:<epoch>)
//   bias-reports/intraday-bias-<date>-<slot>.md   (the saved report per run)
//   intraday-bias-logs/<date>.md          (the skill's continuity log)
//   launchctl                             (is the job loaded / last exit)
//
// The HTML auto-refreshes (meta refresh) and is regenerated on every launchd fire
// by run-intraday-bias.sh, so leaving it open in a browser keeps it current.
//
// Run standalone anytime:  node scripts/bias-dashboard.mjs   (then: open bias-reports/dashboard.html)

import { readFileSync, readdirSync, existsSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(SCRIPT_DIR);
const REPORTS = join(REPO, 'bias-reports');
const LOGS = join(REPO, 'intraday-bias-logs');
const OUT = join(REPORTS, 'dashboard.html');

const SLOTS = [
  { id: '1000', label: 'DAILY', window: '10:00–10:50 ET', startMin: 10 * 60, endMin: 10 * 60 + 50 },
];
// fallback labels for history slot ids; each report's own BASELINE/UPDATE mode wins when present
const SLOT_LABELS = { '0830': 'BASELINE', '0945': 'DAILY', '1000': 'DAILY' };
const REFRESH_SEC = 60;

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readSafe = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const listSafe = (d) => { try { return readdirSync(d); } catch { return []; } };
const humanDur = (secs) => {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};

function etNow() {
  const d = new Date();
  const dateISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
  const pretty = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  const [H, M] = hm.split(':').map(Number);
  return { epoch: Math.floor(d.getTime() / 1000), dateISO, hm, minutes: H * 60 + M, wd, isWeekend: wd === 'Sat' || wd === 'Sun', pretty };
}

// epoch (seconds) -> "Mon 09:51" in ET
function epochET(epoch) {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

// "[2026-07-06 09:36:09 EDT] ..." -> epoch seconds (ET offset from EDT/EST label)
function parseLogTs(line) {
  const m = line.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (\w+)\]/);
  if (!m) return null;
  const off = m[7] === 'EDT' ? '-04:00' : '-05:00';
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

// ---------- gather state ----------
function stateFiles() {
  const map = {}; // "<slot>-<date>" -> {status, epoch}
  for (const f of listSafe(REPORTS)) {
    const m = f.match(/^\.state-(\d{4})-(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    const [status, epoch] = readSafe(join(REPORTS, f)).trim().split(':');
    map[`${m[1]}-${m[2]}`] = { status, epoch: Number(epoch) || 0 };
  }
  return map;
}

function reportPath(date, slot) { return join(REPORTS, `intraday-bias-${date}-${slot}.md`); }

// Parse a saved report into a compact summary.
function parseReport(date, slot) {
  const p = reportPath(date, slot);
  const txt = readSafe(p);
  if (!txt) return null;
  const modeM = txt.match(/^#\s*INTRADAY BIAS\b.*?\b(BASELINE|UPDATE)\b/im);
  const combM = txt.match(/^Combined read:\s*(.+)$/im);
  const symbols = [];
  const re = /^##\s*INTRADAY BIAS\s*[—-]\s*(?:OANDA:)?([A-Z0-9]+):\s*(.+)$/gim;
  let m;
  while ((m = re.exec(txt))) {
    const sym = m[1];
    const callFull = m[2].trim();
    const call = (callFull.match(/\b(LONG|SHORT|DEPENDS)\b/i) || [, '?'])[1].toUpperCase();
    // confidence: first "Confidence: X" after this header
    const rest = txt.slice(re.lastIndex, re.lastIndex + 400);
    const conf = (rest.match(/Confidence:\s*([A-Za-z/–-]+)/i) || [, ''])[1];
    symbols.push({ sym, call, callFull, conf });
  }
  const combined = combM ? combM[1].replace(/\*\*/g, '').trim() : '';
  const mode = modeM ? modeM[1].toUpperCase() : '';
  return { path: `intraday-bias-${date}-${slot}.md`, mode, combined, symbols, raw: txt };
}

function parseSchedulerEvents(limit) {
  const txt = readSafe(join(REPORTS, 'scheduler.log'));
  const out = [];
  for (const line of txt.split('\n')) {
    const ts = parseLogTs(line);
    if (ts == null) continue; // skip the non-timestamped "guard: ..." diagnostics
    const body = line.replace(/^\[[^\]]+\]\s*/, '');
    let kind = 'info';
    if (/ERROR|post FAILED|no report produced|abort|AUTH FAILURE|not logged in/i.test(body)) kind = 'error';
    else if (/posted \+ success|REPOST ok/i.test(body)) kind = 'ok';
    else if (/RUN: invoking claude|directive=RUN|directive=REPOST/i.test(body)) kind = 'run';
    else if (/directive=SKIP/i.test(body)) kind = 'skip';
    const slot = (body.match(/slot=(\d{4})/) || body.match(/\((\d{4})\)/) || [])[1] || '';
    out.push({ ts, tsET: epochET(ts), body, kind, slot });
  }
  return limit ? out.slice(-limit).reverse() : out;
}

function launchd() {
  try {
    const line = execSync('launchctl list 2>/dev/null | grep -i intraday', { encoding: 'utf8' }).trim();
    if (!line) return { loaded: false };
    const [pid, exit] = line.split(/\s+/);
    return { loaded: true, running: pid !== '-', pid, lastExit: exit };
  } catch { return { loaded: false }; }
}

// Is a bias run executing right now? Authoritative = a live runner process; fallback =
// a fresh 'running' state file for today.
function runningNow(now, stateMap) {
  let proc = false;
  try { proc = !!execSync("pgrep -fl 'run-intraday-bias\\.sh' 2>/dev/null || true", { encoding: 'utf8' }).trim(); } catch {}
  let slot = '';
  for (const s of SLOTS) {
    const st = stateMap[`${s.id}-${now.dateISO}`];
    if (st?.status === 'running' && now.epoch - st.epoch < 1500) slot = s.id;
  }
  return { active: proc || !!slot, proc, slot, since: slot ? epochET(stateMap[`${slot}-${now.dateISO}`].epoch) : '' };
}

// Compact machine-readable status for the server's /health endpoint.
export function status() {
  const now = etNow();
  const stateMap = stateFiles();
  return { ok: true, etDate: now.dateISO, etTime: now.hm, running: runningNow(now, stateMap), launchd: launchd() };
}

// Toggle the pause flag — used by the live server's POST /pause, /pause-today, /resume.
export function setPause(mode) {
  const p = join(REPORTS, 'PAUSE');
  if (mode === 'off') { try { if (existsSync(p)) rmSync(p); } catch {} return { paused: false }; }
  const value = mode === 'today' ? etNow().dateISO : 'indefinite';
  writeFileSync(p, value + '\n');
  return { paused: true, value };
}

// ---------- status logic ----------
function slotStatus(date, slot, ctx) {
  const st = ctx.stateMap[`${slot.id}-${date}`];
  const hasReport = existsSync(reportPath(date, slot.id));
  const isToday = date === ctx.now.dateISO;

  if (st?.status === 'posted' || (!isToday && hasReport && st?.status !== 'idle'))
    return { key: 'posted', badge: '✅', text: 'Posted', cls: 'ok', at: epochET(st?.epoch) };
  if (st?.status === 'running' && ctx.now.epoch - st.epoch < 1500)
    return { key: 'running', badge: '🔄', text: 'Running…', cls: 'run', at: epochET(st.epoch) };
  if (st?.status === 'idle') {
    const canRetry = isToday && ctx.now.minutes <= slot.endMin && !ctx.now.isWeekend;
    return canRetry
      ? { key: 'retry', badge: '⚠️', text: 'Failed — retrying', cls: 'warn', at: epochET(st.epoch) }
      : { key: 'failed', badge: '❌', text: 'Failed', cls: 'bad', at: epochET(st.epoch) };
  }
  // no state file for this slot/date
  if (isToday) {
    if (ctx.now.isWeekend) return { key: 'weekend', badge: '—', text: 'Weekend — no run', cls: 'muted' };
    if (ctx.now.minutes < slot.startMin) return { key: 'pending', badge: '⏳', text: 'Scheduled', cls: 'pending' };
    if (ctx.now.minutes <= slot.endMin) return { key: 'due', badge: '⏳', text: 'Due now', cls: 'pending' };
    return { key: 'missed', badge: '⚠️', text: 'No run recorded', cls: 'warn' };
  }
  return hasReport
    ? { key: 'posted', badge: '✅', text: 'Posted', cls: 'ok' }
    : { key: 'none', badge: '·', text: 'No run', cls: 'muted' };
}

function nextRunText(now) {
  const s = SLOTS[0];
  const start = s.window.split('–')[0];
  if (now.isWeekend) return `Mon ${start}`;
  if (now.minutes < s.startMin) return `today ${start}`;
  if (now.minutes <= s.endMin) return 'in the run window now';
  return `tomorrow ${start}`;
}

function discoverDates(stateMap) {
  const set = new Set();
  for (const f of listSafe(REPORTS)) {
    const m = f.match(/intraday-bias-(\d{4}-\d{2}-\d{2})-\d{4}\.md$/);
    if (m) set.add(m[1]);
  }
  for (const k of Object.keys(stateMap)) set.add(k.slice(5));
  for (const f of listSafe(LOGS)) { const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/); if (m) set.add(m[1]); }
  return [...set].sort().reverse();
}

// ---------- render ----------
function callChip(s) {
  const cls = s.call === 'LONG' ? 'long' : s.call === 'SHORT' ? 'short' : 'depends';
  const conf = s.conf ? ` <span class="conf">${esc(s.conf)}</span>` : '';
  return `<span class="sym">${esc(s.sym.replace('USD', ''))}</span> <span class="call ${cls}">${esc(s.call)}</span>${conf}`;
}

function slotCard(date, slot, ctx) {
  const s = slotStatus(date, slot, ctx);
  const rep = (s.key === 'posted' || s.key === 'running') ? parseReport(date, slot.id) : null;
  const calls = rep?.symbols?.length
    ? `<div class="calls">${rep.symbols.map((x) => `<div class="callrow">${callChip(x)}<div class="callfull">${esc(x.callFull)}</div></div>`).join('')}</div>`
    : `<div class="empty">${s.key === 'pending' ? `Scheduled for ${slot.window}` : s.key === 'due' ? 'Window open — awaiting the next 15-min fire' : 'No report'}</div>`;
  const combined = rep?.combined ? `<div class="combined">${esc(rep.combined)}</div>` : '';
  const details = rep?.raw
    ? `<details><summary>view full report</summary><pre>${esc(rep.raw)}</pre></details>`
    : '';
  const at = s.at ? `<span class="at">${esc(s.at)}</span>` : '';
  return `<section class="card ${s.cls}">
    <header><div class="slot">${slot.id.replace(/(\d\d)(\d\d)/, '$1:$2')} <span class="tag">${slot.label}</span></div>
      <div class="status ${s.cls}">${s.badge} ${esc(s.text)} ${at}</div></header>
    ${combined}${calls}${details}
  </section>`;
}

// Which slots actually have data on a given date (handles schedule changes over time).
function slotsForDate(date) {
  const ids = new Set();
  for (const f of listSafe(REPORTS)) {
    let m = f.match(/^intraday-bias-(\d{4}-\d{2}-\d{2})-(\d{4})\.md$/);
    if (m && m[1] === date) ids.add(m[2]);
    m = f.match(/^\.state-(\d{4})-(\d{4}-\d{2}-\d{2})$/);
    if (m && m[2] === date) ids.add(m[1]);
  }
  return [...ids].sort();
}

function historyRows(dates, ctx) {
  return dates.map((date) => {
    const ids = slotsForDate(date);
    const runs = ids.length ? ids.map((id) => {
      const slot = SLOTS.find((x) => x.id === id) || { id };
      const s = slotStatus(date, slot, ctx);
      const rep = s.key === 'posted' ? parseReport(date, id) : null;
      const calls = rep?.symbols?.map((x) => {
        const cls = x.call === 'LONG' ? 'long' : x.call === 'SHORT' ? 'short' : 'depends';
        return `<span class="mini ${cls}" title="${esc(x.sym)}: ${esc(x.callFull)}">${esc(x.sym.replace('USD', ''))} ${esc(x.call)}</span>`;
      }).join(' ') || '';
      const link = rep ? ` <a href="${esc(rep.path)}">md</a>` : '';
      const t = id.replace(/(\d\d)(\d\d)/, '$1:$2');
      const lblText = rep?.mode || SLOT_LABELS[id] || '';
      const lbl = lblText ? ` <span class="tag">${esc(lblText)}</span>` : '';
      return `<span class="hrun ${s.cls}"><span class="b">${s.badge}</span> <b>${esc(t)}</b>${lbl} ${calls}${link}</span>`;
    }).join('') : '<span class="dim">—</span>';
    const isToday = date === ctx.now.dateISO;
    return `<tr${isToday ? ' class="today"' : ''}><th>${esc(date)}${isToday ? ' <span class="tag">today</span>' : ''}</th><td>${runs}</td></tr>`;
  }).join('');
}

export function render({ live = false, serverStart = null } = {}) {
  const now = etNow();
  const stateMap = stateFiles();
  const ctx = { now, stateMap };
  const dates = discoverDates(stateMap);
  const allEvents = parseSchedulerEvents();
  const lastFire = allEvents[allEvents.length - 1];
  const nextCheck = lastFire ? epochET(lastFire.ts + 900) : '~15 min';
  const lastCheck = lastFire ? lastFire.tsET : '—';
  const feedEvents = allEvents.filter((e) => e.kind !== 'skip').slice(-12).reverse();
  const ld = launchd();
  const run = runningNow(now, stateMap);
  const refresh = live ? 12 : REFRESH_SEC;
  const liveHtml = live
    ? `<span class="pill live">● LIVE</span> <span class="dim">server up ${esc(serverStart ? humanDur(now.epoch - serverStart) : '')}</span>`
    : '';
  const runBanner = run.active
    ? `<div class="banner run"><span class="pulse"></span> <b>A bias run is executing right now.</b>${run.slot ? ` ${esc(run.slot.replace(/(\d\d)(\d\d)/, '$1:$2'))} slot, started ${esc(run.since)}.` : ''} Takes a few minutes; the result posts here when done.</div>`
    : '';

  // User pause flag (bias-pause.sh): paused when the flag is empty/indefinite or holds today's date.
  const hasPause = existsSync(join(REPORTS, 'PAUSE'));
  const pauseVal = hasPause ? readSafe(join(REPORTS, 'PAUSE')).trim() : '';
  const paused = hasPause && (pauseVal === '' || pauseVal === 'indefinite' || pauseVal === now.dateISO);
  const pauseBanner = paused
    ? `<div class="banner paused"><b>⏸ PAUSED — scheduled runs are skipped.</b> ${pauseVal === now.dateISO ? `Just for today (${esc(now.dateISO)}); auto-resumes tomorrow.` : 'Indefinite.'} Re-enable with <code>bash scripts/bias-resume.sh</code>.</div>`
    : '';

  // Auth alert: scan the RAW log after the last success for a logged-out marker.
  // (claude's "Not logged in" output is untimestamped, so the events feed can miss it.)
  const authLines = readSafe(join(REPORTS, 'scheduler.log')).split('\n');
  let okIdx = -1;
  for (let i = 0; i < authLines.length; i++) if (/posted \+ success/i.test(authLines[i])) okIdx = i;
  const authAlert = authLines.slice(okIdx + 1).some((l) => /AUTH FAILURE|not logged in|please run \/login/i.test(l));
  const lastRunEv = allEvents.filter((e) => e.kind === 'run').pop();
  const authBanner = (authAlert && !paused)
    ? `<div class="banner auth"><b>⚠️ claude is logged out — scheduled runs are failing.</b> The headless run can't authenticate${lastRunEv ? ` (last attempt ${esc(lastRunEv.tsET)})` : ''}. Fix: run <code>claude /login</code> in a terminal, or set a durable token (see DISCORD-SCHEDULE-SETUP.md). TradingView is fine — this is a CLI-auth issue, not a TV one.</div>`
    : '';

  const ldHtml = ld.loaded
    ? `<span class="pill ${ld.lastExit === '0' ? 'ok' : 'bad'}">launchd ✓ loaded</span>
       <span class="dim">last exit ${esc(ld.lastExit)}${ld.running ? ` · running pid ${esc(ld.pid)}` : ''}</span>`
    : `<span class="pill bad">launchd ✗ not loaded</span>`;

  const todayCards = SLOTS.map((slot) => slotCard(now.dateISO, slot, ctx)).join('');
  const feed = feedEvents.map((e) => `<div class="ev ${e.kind}"><span class="t">${esc(e.tsET)}</span> <span class="b">${esc(e.body)}</span></div>`).join('') || '<div class="dim">no runs logged yet</div>';
  const past = dates.filter((d) => d !== now.dateISO);
  const hist = historyRows([now.dateISO, ...past], ctx);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${refresh}">
<title>Intraday-Bias Dashboard</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#0b0e14;color:#c9d1d9;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1040px;margin:0 auto;padding:22px 18px 60px}
  h1{font-size:19px;margin:0 0 2px;letter-spacing:.2px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:#8b949e;margin:26px 0 10px;font-weight:600}
  header.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px;border-bottom:1px solid #21262d;padding-bottom:14px}
  .clock{font-variant-numeric:tabular-nums;color:#e6edf3;font-weight:600}
  .dim{color:#6e7681;font-size:12.5px}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
  .pill.ok{background:#12261a;color:#3fb950;border:1px solid #1f6f34}
  .pill.bad{background:#2b1416;color:#f85149;border:1px solid #7d2a2a}
  .meta{margin-left:auto;text-align:right}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
  @media(max-width:680px){.grid{grid-template-columns:1fr}}
  .card{background:#0f141c;border:1px solid #21262d;border-radius:12px;padding:14px 15px;border-left:4px solid #30363d}
  .card.ok{border-left-color:#3fb950}.card.pending{border-left-color:#58a6ff}.card.run{border-left-color:#d29922}
  .card.warn{border-left-color:#d29922}.card.bad{border-left-color:#f85149}.card.muted{border-left-color:#30363d}
  .card header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border:0;padding:0;margin-bottom:8px}
  .slot{font-size:16px;font-weight:700;color:#e6edf3;font-variant-numeric:tabular-nums}
  .tag{font-size:10px;font-weight:700;letter-spacing:.8px;color:#8b949e;background:#1c2330;padding:2px 6px;border-radius:5px;vertical-align:middle}
  .status{font-size:12.5px;font-weight:600}
  .status.ok{color:#3fb950}.status.pending{color:#58a6ff}.status.run{color:#d29922}.status.warn{color:#d29922}.status.bad{color:#f85149}.status.muted{color:#6e7681}
  .at{color:#6e7681;font-weight:400}
  .combined{font-size:12.5px;color:#adbac7;background:#0b0f16;border:1px solid #1c2330;border-radius:7px;padding:7px 9px;margin:6px 0 10px}
  .calls{display:flex;flex-direction:column;gap:8px}
  .callrow{border-top:1px solid #1c2330;padding-top:7px}
  .callrow:first-child{border-top:0;padding-top:0}
  .sym{font-weight:700;color:#e6edf3;font-size:13px}
  .call{font-weight:700;font-size:12px;padding:1px 7px;border-radius:5px;margin-left:2px}
  .call.long{background:#0f2a19;color:#3fb950}.call.short{background:#2b1416;color:#f85149}.call.depends{background:#2a2411;color:#d29922}
  .conf{color:#8b949e;font-size:11px;font-weight:600}
  .callfull{color:#8b949e;font-size:11.5px;margin-top:3px}
  .empty{color:#6e7681;font-size:12.5px;font-style:italic}
  details{margin-top:10px}summary{cursor:pointer;color:#58a6ff;font-size:12px}
  pre{white-space:pre-wrap;background:#0b0f16;border:1px solid #1c2330;border-radius:7px;padding:10px;font-size:11.5px;color:#adbac7;max-height:340px;overflow:auto;margin:8px 0 0}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #1c2330;vertical-align:top}
  thead th{color:#8b949e;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.8px}
  tbody th{font-weight:600;color:#c9d1d9;white-space:nowrap;font-variant-numeric:tabular-nums}
  tr.today th,tr.today td{background:#0f141c}
  .mini{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:4px;margin:1px 1px}
  .mini.long{background:#0f2a19;color:#3fb950}.mini.short{background:#2b1416;color:#f85149}.mini.depends{background:#2a2411;color:#d29922}
  .hrun{display:block;padding:2px 0}.hrun .b{margin-right:2px}
  td.muted .b,td.none .b{color:#6e7681}
  .feed{background:#0f141c;border:1px solid #21262d;border-radius:10px;padding:6px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
  .ev{padding:3px 10px;border-left:3px solid transparent;white-space:pre-wrap;word-break:break-word}
  .ev .t{color:#6e7681}
  .ev.ok{border-left-color:#3fb950}.ev.error{border-left-color:#f85149;background:#1a0f11}.ev.run{border-left-color:#58a6ff}.ev.skip{color:#6e7681}
  .ev.error .b{color:#f85149}
  .legend{font-size:11.5px;color:#6e7681;margin-top:8px}
  footer{margin-top:30px;color:#4d5560;font-size:11px;text-align:center}
  .pill.live{background:#0d2440;color:#58a6ff;border:1px solid #1f4f7a}
  .banner{margin:14px 0 0;padding:10px 14px;border-radius:10px;font-size:13px;background:#0f2033;border:1px solid #1f4f7a;color:#cfe3ff}
  .banner.run b{color:#e6edf3}
  .banner.auth{background:#2b1a10;border-color:#7d4a1a;color:#ffd9a8}
  .banner.paused{background:#241a2e;border-color:#5a4a7a;color:#e6d6ff}
  .controls{display:flex;gap:8px;margin:12px 0 0}
  .btn{background:#1c2330;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
  .btn:hover{background:#242c3a;border-color:#3d4655}
  .btn.resume{background:#12261a;color:#3fb950;border-color:#1f6f34}
  .btn:disabled{opacity:.6;cursor:default}
  .banner code{background:#00000055;padding:1px 5px;border-radius:4px;font-size:12px}
  .pulse{display:inline-block;width:9px;height:9px;border-radius:50%;background:#3fb950;animation:pulse 1.5s infinite;vertical-align:middle;margin-right:5px}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(63,185,80,.6)}70%{box-shadow:0 0 0 8px rgba(63,185,80,0)}100%{box-shadow:0 0 0 0 rgba(63,185,80,0)}}
  #cd{color:#8b949e}
</style></head><body><div class="wrap">

  <header class="top">
    <div>
      <h1>Intraday-Bias Dashboard</h1>
      <div class="dim">US30USD + NAS100USD · scheduled to Discord · checks every 15 min</div>
    </div>
    <div class="meta">
      <div class="clock"><span id="liveclock">${esc(now.hm)} ET</span> · ${esc(now.pretty)}</div>
      ${live ? `<div class="dim">${liveHtml}</div>` : ''}
      <div class="dim">${ldHtml}</div>
      <div class="dim">next run: ${esc(nextRunText(now))} · last check ${esc(lastCheck)} · next ≈ ${esc(nextCheck)}${live ? ' · reload <span id="cd"></span>' : ''}</div>
    </div>
  </header>
  ${pauseBanner}${authBanner}${runBanner}
  ${live ? `<div class="controls">${paused ? `<button class="btn resume" data-act="resume">▶ Resume runs</button>` : `<button class="btn" data-act="pause">⏸ Pause</button><button class="btn" data-act="pause-today">Skip today</button>`}</div>` : ''}

  <h2>Today — ${esc(now.dateISO)}${now.isWeekend ? ' (weekend — no runs)' : ''}</h2>
  <div class="grid">${todayCards}</div>

  <h2>Recent activity <span class="dim" style="text-transform:none;letter-spacing:0;font-weight:400">— runs, posts &amp; errors (routine 15-min checks hidden)</span></h2>
  <div class="feed">${feed}</div>

  <h2>History</h2>
  <table>
    <thead><tr><th>Date</th><th>Runs</th></tr></thead>
    <tbody>${hist}</tbody>
  </table>
  <div class="legend">✅ posted&nbsp; 🔄 running&nbsp; ⏳ scheduled/due&nbsp; ⚠️ failed·retrying&nbsp; ❌ failed&nbsp; · no run &nbsp;|&nbsp; hover a chip for the full call</div>

  <footer>${live ? 'live server' : 'generated ' + esc(now.hm) + ' ET'} · auto-refreshes every ${refresh}s${live ? '' : ' · regenerated on each scheduler fire'}</footer>
</div>${live ? `<script>
(function(){var R=${refresh};
function tick(){var d=new Date();
var et=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
var c=document.getElementById('liveclock');if(c)c.textContent=et+' ET';
var cd=document.getElementById('cd');if(cd)cd.textContent=R+'s';
if(R--<=0)location.reload();}
setInterval(tick,1000);tick();})();
document.querySelectorAll('.btn[data-act]').forEach(function(b){b.addEventListener('click',function(){var m={pause:'/pause','pause-today':'/pause-today',resume:'/resume'}[b.dataset.act];b.disabled=true;b.textContent='…';fetch(m,{method:'POST',headers:{'x-bias-dash':'1'}}).then(function(){location.reload();}).catch(function(){location.reload();});});});
</script>` : ''}</body></html>`;
}

// Write the static file only when run directly (not when imported by the server).
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    writeFileSync(OUT, render());
    console.log(`dashboard -> ${OUT}`);
  } catch (e) {
    const msg = esc(e && e.stack ? e.stack : String(e));
    try { writeFileSync(OUT, `<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=30><body style="background:#0b0e14;color:#f85149;font-family:monospace;padding:20px"><h2>dashboard generation error</h2><pre>${msg}</pre></body>`); } catch {}
    console.error('dashboard error:', e);
    process.exit(1);
  }
}
