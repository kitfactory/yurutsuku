#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function hooksDir() {
  const base = process.env.NAGOMI_HOOKS_DIR;
  if (base) return base;
  return path.join(os.homedir(), ".nagomi", "hooks");
}

function parseEvent(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function main() {
  const raw = process.argv[2];
  if (!raw) return;
  const event = parseEvent(raw);
  if (!event) return;
  const sourceSessionId = process.env.NAGOMI_SESSION_ID;
  const payload = {
    source: "codex",
    event,
    ts_ms: Date.now(),
  };
  if (sourceSessionId) {
    payload.source_session_id = sourceSessionId;
  }
  const base = hooksDir();
  fs.mkdirSync(base, { recursive: true });
  const filePath = path.join(base, "codex.jsonl");
  fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf8");
}

try {
  main();
} catch (err) {
  console.error(err);
}
