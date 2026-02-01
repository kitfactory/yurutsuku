const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromWhere(binary) {
  const result = spawnSync("where", [binary], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const line = (result.stdout || "").trim().split(/\r?\n/)[0];
  return line || null;
}

function resolveTauriDriverPath() {
  if (process.platform !== "win32") {
    return null;
  }
  const envPath = process.env.NAGOMI_TAURI_DRIVER;
  if (envPath && fileExists(envPath)) {
    return envPath;
  }
  const fromWhere = resolveFromWhere("tauri-driver");
  if (fromWhere && fileExists(fromWhere)) {
    return fromWhere;
  }
  const home = os.homedir();
  const candidate = path.join(home, ".cargo", "bin", "tauri-driver.exe");
  return fileExists(candidate) ? candidate : null;
}

function resolveMsEdgeDriverPath() {
  if (process.platform !== "win32") {
    return null;
  }
  const envPath = process.env.NAGOMI_EDGE_DRIVER;
  if (envPath && fileExists(envPath)) {
    return envPath;
  }
  const fromWhere = resolveFromWhere("msedgedriver");
  if (fromWhere && fileExists(fromWhere)) {
    return fromWhere;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "msedgedriver.exe"),
    path.join(home, ".cargo", "bin", "msedgedriver.exe"),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function ensureDriversOnPath() {
  const tauriPath = resolveTauriDriverPath();
  const edgePath = resolveMsEdgeDriverPath();
  const delimiter = path.delimiter;
  const current = process.env.PATH || "";
  const parts = current.split(delimiter);
  const nextParts = [];

  if (tauriPath) {
    const dir = path.dirname(tauriPath);
    if (!parts.includes(dir)) {
      nextParts.push(dir);
    }
  }
  if (edgePath) {
    const dir = path.dirname(edgePath);
    if (!parts.includes(dir)) {
      nextParts.push(dir);
    }
  }
  if (nextParts.length) {
    process.env.PATH = `${nextParts.join(delimiter)}${delimiter}${current}`;
  }
  return { tauriPath, edgePath };
}

module.exports = {
  resolveTauriDriverPath,
  resolveMsEdgeDriverPath,
  ensureDriversOnPath,
};
