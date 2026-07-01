#!/usr/bin/env node
/**
 * discord-post.mjs — post a text report to a Discord channel via webhook.
 *
 * Usage:
 *   node scripts/discord-post.mjs <report-file> [--title "Header line"]
 *   echo "text" | node scripts/discord-post.mjs --stdin
 *
 * Webhook URL resolution (first match wins):
 *   1. env DISCORD_WEBHOOK_URL
 *   2. file .discord-webhook in repo root (single line: the URL)
 *
 * Behavior:
 *   - Splits the report into <=2000-char Discord messages, breaking on line
 *     boundaries and keeping ``` code fences balanced across messages.
 *   - Sends messages in order, honoring 429 rate-limit retry_after.
 *   - Exit 0 on full success; non-zero if any message fails (so callers can
 *     detect a blocked network / bad URL and fall back to saving a file).
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MAX = 1900; // safety margin under Discord's 2000-char hard limit

function resolveWebhook() {
  if (process.env.DISCORD_WEBHOOK_URL && process.env.DISCORD_WEBHOOK_URL.trim()) {
    return process.env.DISCORD_WEBHOOK_URL.trim();
  }
  const f = join(REPO_ROOT, ".discord-webhook");
  if (existsSync(f)) {
    const url = readFileSync(f, "utf8").trim();
    if (url) return url;
  }
  return null;
}

function readInput(args) {
  const stdinMode = args.includes("--stdin");
  if (stdinMode) {
    return readFileSync(0, "utf8"); // fd 0
  }
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    throw new Error("No report file given. Pass a file path or --stdin.");
  }
  if (!existsSync(fileArg)) {
    throw new Error(`Report file not found: ${fileArg}`);
  }
  return readFileSync(fileArg, "utf8");
}

/**
 * Split text into Discord-sized chunks on line boundaries, keeping ``` fences
 * balanced: if a chunk ends while inside a fence, close it and reopen at the
 * top of the next chunk.
 */
function chunk(text) {
  const lines = text.split("\n");
  const chunks = [];
  let buf = [];
  let len = 0;
  let inFence = false;
  let fenceTag = "```";

  const flush = () => {
    if (buf.length === 0) return;
    let body = buf.join("\n");
    if (inFence) body += "\n```"; // close dangling fence
    chunks.push(body);
    buf = [];
    len = 0;
    if (inFence) {
      // reopen fence at start of next chunk
      buf.push(fenceTag);
      len += fenceTag.length + 1;
    }
  };

  for (const line of lines) {
    // A single line longer than MAX: hard-split it.
    if (line.length > MAX) {
      flush();
      for (let i = 0; i < line.length; i += MAX) {
        chunks.push(line.slice(i, i + MAX));
      }
      continue;
    }
    if (len + line.length + 1 > MAX) flush();
    buf.push(line);
    len += line.length + 1;

    const t = line.trim();
    if (t.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceTag = "```"; // reopen as plain fence to stay safe
      } else {
        inFence = false;
      }
    }
  }
  flush();
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * POST one message via curl. We shell out to curl rather than use Node's fetch
 * because this runs inside a sandbox whose only egress is an HTTP proxy
 * (HTTPS_PROXY=http://localhost:3128). curl honors that proxy automatically;
 * Node's built-in fetch ignores it and fails with EAI_AGAIN. curl also works
 * unchanged on a normal host with direct network.
 */
function curlPost(webhook, content) {
  const payload = JSON.stringify({ content, allowed_mentions: { parse: [] } });
  const args = [
    "-s", "-S",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "--data-binary", "@-",
    "-w", "\n%{http_code}",
    "--max-time", "30",
    webhook,
  ];
  const res = spawnSync("curl", args, { input: payload, encoding: "utf8" });
  if (res.error) throw new Error(`could not run curl: ${res.error.message}`);
  const out = res.stdout || "";
  const nl = out.lastIndexOf("\n");
  const code = parseInt((nl === -1 ? out : out.slice(nl + 1)).trim(), 10);
  const body = nl === -1 ? "" : out.slice(0, nl);
  return { code, body, stderr: (res.stderr || "").trim() };
}

async function send(webhook, content, attempt = 0) {
  const { code, body, stderr } = curlPost(webhook, content);
  if (!code || Number.isNaN(code)) {
    throw new Error(`network error posting to Discord${stderr ? ` (curl: ${stderr.slice(0, 200)})` : ""}`);
  }
  if (code === 429) {
    let wait = 1000;
    try { wait = Math.ceil((JSON.parse(body).retry_after ?? 1) * 1000) + 250; } catch {}
    if (attempt < 5) {
      await sleep(wait);
      return send(webhook, content, attempt + 1);
    }
  }
  if (code !== 200 && code !== 204) {
    throw new Error(`Discord responded ${code}: ${body.slice(0, 300)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    const text0 = readInput(args);
    const parts0 = chunk(text0);
    console.log(`[dry-run] ${parts0.length} message(s):`);
    parts0.forEach((p, i) => console.log(`  msg ${i + 1}: ${p.length} chars`));
    return;
  }

  const webhook = resolveWebhook();
  if (!webhook) {
    console.error(
      "No webhook. Set DISCORD_WEBHOOK_URL or create .discord-webhook in repo root."
    );
    process.exit(2);
  }

  let text = readInput(args);
  const titleIdx = args.indexOf("--title");
  if (titleIdx !== -1 && args[titleIdx + 1]) {
    text = `${args[titleIdx + 1]}\n${text}`;
  }

  const parts = chunk(text);
  if (parts.length === 0) {
    console.error("Nothing to send (empty report).");
    process.exit(3);
  }

  for (let i = 0; i < parts.length; i++) {
    await send(webhook, parts[i]);
    if (i < parts.length - 1) await sleep(600); // gentle pacing
  }
  console.log(`Posted ${parts.length} message(s) to Discord.`);
}

main().catch((err) => {
  console.error(`discord-post failed: ${err.message}`);
  process.exit(1);
});
