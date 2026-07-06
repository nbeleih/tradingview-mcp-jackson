#!/usr/bin/env node
//
// bias-dashboard-server.mjs — always-on LIVE dashboard for the scheduled intraday-bias
// jobs. Reuses bias-dashboard.mjs's render() but reads every source file FRESH on each
// request, so it's real-time:
//   • shows a bias run WHILE it's executing (green "run in progress" banner)
//   • a ticking ET clock + reload countdown (page feels live between refreshes)
//   • proves the scheduler (launchd) AND this server are alive
//
// Bound to 127.0.0.1 only (localhost — never exposed to the network). No auth, read-only.
//
//   Start:   node scripts/bias-dashboard-server.mjs          (port 8787, or $BIAS_DASH_PORT)
//   Health:  curl http://127.0.0.1:8787/health               (JSON — good for scripts)
//   Always-on: kept alive by scripts/com.nourbeleih.bias-dashboard.plist

import { createServer } from 'node:http';
import { render, status } from './bias-dashboard.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.BIAS_DASH_PORT) || 8787;
const SERVER_START = Math.floor(Date.now() / 1000);

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  try {
    if (url === '/health' || url === '/health/') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ...status(), serverUptimeSec: Math.floor(Date.now() / 1000) - SERVER_START }));
      return;
    }
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(render({ live: true, serverStart: SERVER_START }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('dashboard error: ' + (e && e.stack ? e.stack : String(e)));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`bias-dashboard: port ${PORT} already in use — server already running? (set BIAS_DASH_PORT to change)`);
  } else {
    console.error('bias-dashboard server error:', e);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`bias-dashboard live at http://${HOST}:${PORT}  (health: http://${HOST}:${PORT}/health)`);
});
