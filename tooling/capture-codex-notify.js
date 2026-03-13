#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logDir = path.join(os.homedir(), ".nagomi", "hooks");
const logPath = path.join(logDir, "codex-notify-capture.jsonl");
fs.mkdirSync(logDir, { recursive: true });

let stdin = "";
try {
  stdin = fs.readFileSync(0, "utf8");
} catch {
  stdin = "";
}

const payload = {
  ts_ms: Date.now(),
  argv: process.argv,
  stdin,
  env_session_id: process.env.NAGOMI_SESSION_ID || null,
};

fs.appendFileSync(logPath, JSON.stringify(payload) + "\n", "utf8");
