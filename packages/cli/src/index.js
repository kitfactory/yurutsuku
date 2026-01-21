#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_HEALTH_PORT = 17707;
const DEFAULT_HEALTH_TIMEOUT_MS = 400;
const DEFAULT_HEALTH_RETRIES = 60;

function resolveHealthPort() {
  const raw = process.env.YURUTSUKU_ORCH_HEALTH_PORT;
  if (!raw) return DEFAULT_HEALTH_PORT;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_HEALTH_PORT;
}

function healthUrl() {
  const port = resolveHealthPort();
  return `http://127.0.0.1:${port}/health`;
}

function isWindows() {
  return process.platform === "win32";
}

function orchestratorExeName() {
  return isWindows() ? "yurutsuku-orchestrator.exe" : "yurutsuku-orchestrator";
}

function resolveOrchestratorPath() {
  const envPath = process.env.YURUTSUKU_ORCHESTRATOR_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const candidate = path.join(repoRoot, "target", "debug", orchestratorExeName());
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function isProcessRunningWindows(imageName) {
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`], {
    encoding: "utf8",
  });
  return result.stdout && result.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function isProcessRunningUnix(processName) {
  const result = spawnSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout
    .split(/\r?\n/)
    .some((line) => line.trim().endsWith(processName));
}

function isOrchestratorRunning() {
  const name = orchestratorExeName();
  if (isWindows()) {
    return isProcessRunningWindows(name);
  }
  return isProcessRunningUnix(name);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.setTimeout(DEFAULT_HEALTH_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function waitForHealth(retries) {
  const url = healthUrl();
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const status = await httpGet(url);
      if (status === 200) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function spawnOrchestrator(orchestratorPath) {
  const child = spawn(orchestratorPath, [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  const orchestratorPath = resolveOrchestratorPath();
  if (!orchestratorPath) {
    console.error("orchestrator binary not found");
    process.exitCode = 1;
    return;
  }

  if (isOrchestratorRunning()) {
    const healthy = await waitForHealth(DEFAULT_HEALTH_RETRIES);
    if (healthy) {
      return;
    }
  }

  spawnOrchestrator(orchestratorPath);
  const healthy = await waitForHealth(DEFAULT_HEALTH_RETRIES);
  if (!healthy) {
    console.error("orchestrator health check failed");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
