#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const os = require("node:os");

const DEFAULT_HEALTH_PORT = 17707;
const DEFAULT_HEALTH_TIMEOUT_MS = 400;
const DEFAULT_HEALTH_RETRIES = 60;

function resolveHealthPort() {
  const raw = process.env.NAGOMI_ORCH_HEALTH_PORT;
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
  return isWindows() ? "nagomi-orchestrator.exe" : "nagomi-orchestrator";
}

function resolveCommandInPath(command) {
  const rawPath = process.env.PATH || "";
  const pathEntries = rawPath.split(path.delimiter).filter(Boolean);
  if (pathEntries.length === 0) return null;

  const candidates = [];
  if (isWindows()) {
    if (path.extname(command)) {
      candidates.push(command);
    } else {
      const rawExts = process.env.PATHEXT;
      const exts = rawExts ? rawExts.split(";").filter(Boolean) : [".exe", ".cmd", ".bat"];
      for (const ext of exts) {
        candidates.push(`${command}${ext}`);
      }
      candidates.push(command);
    }
  } else {
    candidates.push(command);
  }

  for (const dir of pathEntries) {
    for (const name of candidates) {
      const candidate = path.join(dir, name);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch {
        // ignore missing entries
      }
    }
  }
  return null;
}

function resolveOrchestratorPath() {
  const envPath = process.env.NAGOMI_ORCHESTRATOR_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const candidate = path.join(repoRoot, "target", "debug", orchestratorExeName());
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return resolveCommandInPath(orchestratorExeName());
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
    const req = http.get(url, { agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.setTimeout(DEFAULT_HEALTH_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function httpGetBody(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(DEFAULT_HEALTH_TIMEOUT_MS * 5, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function windowsDesktopDir() {
  return path.join(os.homedir(), "Desktop");
}

function windowsStartMenuDir() {
  const appData = process.env.APPDATA || "";
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
}

function ensureLnkPath(filePath, name) {
  const normalized = path.normalize(filePath);
  if (path.extname(normalized).toLowerCase() === ".lnk") {
    return normalized;
  }
  return path.join(normalized, `${name}.lnk`);
}

function quoteWindowsArg(value) {
  if (!value) return "";
  const text = String(value);
  if (!/[ \t"]/g.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function resolveShortcutInvocation(targetOverride) {
  if (targetOverride) {
    return { target: targetOverride, baseArgs: [] };
  }
  const scriptPath = process.argv[1];
  if (scriptPath && fs.existsSync(scriptPath)) {
    return { target: process.execPath, baseArgs: [scriptPath] };
  }
  if (process.execPath) {
    return { target: process.execPath, baseArgs: [] };
  }
  return { target: "nagomi", baseArgs: [] };
}

function buildShortcutArgs(baseArgs, sessionId) {
  const args = baseArgs.slice();
  if (sessionId) {
    args.push("--session-id", sessionId);
  }
  return args.map(quoteWindowsArg).join(" ");
}

function createWindowsShortcut({ path: shortcutPath, target, args, workingDir }) {
  const escapedPath = shortcutPath.replace(/'/g, "''");
  const escapedTarget = target.replace(/'/g, "''");
  const escapedArgs = (args || "").replace(/'/g, "''");
  const escapedWorkDir = (workingDir || "").replace(/'/g, "''");
  const script = [
    "$WshShell = New-Object -ComObject WScript.Shell",
    `$Shortcut = $WshShell.CreateShortcut('${escapedPath}')`,
    `$Shortcut.TargetPath = '${escapedTarget}'`,
    `$Shortcut.Arguments = '${escapedArgs}'`,
    `$Shortcut.WorkingDirectory = '${escapedWorkDir}'`,
    "$Shortcut.Save()",
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || "failed to create shortcut";
    throw new Error(message.trim());
  }
}

function openTerminalUrl(sessionId) {
  const port = resolveHealthPort();
  const url = new URL(`http://127.0.0.1:${port}/open-terminal`);
  if (sessionId) {
    url.searchParams.set("session_id", sessionId);
  }
  return url.toString();
}

async function openTerminal(sessionId) {
  const { status, body } = await httpGetBody(openTerminalUrl(sessionId));
  if (status !== 200) {
    throw new Error(body || `open-terminal failed: ${status}`);
  }
  return body;
}

function parseTerminalSendArgs(args) {
  let sessionId = "";
  let text = "";
  let textFile = "";
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--session-id" || arg === "-s") {
      sessionId = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--text" || arg === "-t") {
      text = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--text-file") {
      textFile = args[i + 1] || "";
      i += 1;
      continue;
    }
    rest.push(arg);
  }
  if (!text && textFile) {
    text = fs.readFileSync(textFile, "utf8");
  }
  if (!text && rest.length > 0) {
    text = rest.join(" ");
  }
  return { sessionId, text };
}

function printTerminalSendUsage() {
  console.error(
    [
      "usage:",
      "  nagomi terminal-send --session-id <id> --text \"<command>\"",
      "  nagomi terminal-send --session-id <id> --text-file <path>",
      "  nagomi terminal-send <session_id> \"<command>\"",
    ].join("\n")
  );
}

function parseShortcutArgs(args) {
  let targetPath = "";
  let name = "nagomi";
  let sessionId = "";
  let output = "";
  let useDesktop = false;
  let useStartMenu = false;
  let showHelp = false;
  const unknown = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      targetPath = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--name") {
      name = args[i + 1] || name;
      i += 1;
      continue;
    }
    if (arg === "--session-id" || arg === "-s") {
      sessionId = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--path") {
      output = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--desktop") {
      useDesktop = true;
      continue;
    }
    if (arg === "--start-menu") {
      useStartMenu = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    unknown.push(arg);
  }
  return { targetPath, name, sessionId, output, useDesktop, useStartMenu, showHelp, unknown };
}

function printShortcutUsage() {
  console.error(
    [
      "usage:",
      "  nagomi shortcut --desktop [--name <name>] [--session-id <id>]",
      "  nagomi shortcut --start-menu [--name <name>] [--session-id <id>]",
      "  nagomi shortcut --path <file-or-dir> [--name <name>] [--session-id <id>]",
      "",
      "notes:",
      "  - Windows only (.lnk)",
      "  - --target <path> can override the executable (advanced)",
    ].join("\n")
  );
}

function resolveShortcutPath({ output, name, useDesktop, useStartMenu }) {
  if (output) {
    return ensureLnkPath(output, name);
  }
  if (useStartMenu) {
    return ensureLnkPath(windowsStartMenuDir(), name);
  }
  return ensureLnkPath(windowsDesktopDir(), name);
}

function ensureShortcutDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function shortcutCli(args) {
  if (!isWindows()) {
    console.error("shortcut is supported on Windows only");
    process.exitCode = 1;
    return;
  }
  const parsed = parseShortcutArgs(args);
  if (parsed.showHelp) {
    printShortcutUsage();
    return;
  }
  if (parsed.unknown.length > 0) {
    console.error(`unknown arguments: ${parsed.unknown.join(" ")}`);
    printShortcutUsage();
    process.exitCode = 2;
    return;
  }
  if (!parsed.output && !parsed.useDesktop && !parsed.useStartMenu) {
    parsed.useDesktop = true;
  }
  const shortcutPath = resolveShortcutPath(parsed);
  const { target, baseArgs } = resolveShortcutInvocation(parsed.targetPath);
  const argsText = buildShortcutArgs(baseArgs, parsed.sessionId);
  ensureShortcutDir(shortcutPath);
  try {
    createWindowsShortcut({
      path: shortcutPath,
      target,
      args: argsText,
      workingDir: os.homedir(),
    });
    console.log(`shortcut created: ${shortcutPath}`);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

function parseLauncherArgs(args) {
  let sessionId = "";
  let showHelp = false;
  const unknown = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--session-id" || arg === "-s") {
      sessionId = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    unknown.push(arg);
  }
  return { sessionId, showHelp, unknown };
}

function printLauncherUsage() {
  console.error(
    [
      "usage:",
      "  nagomi",
      "  nagomi --session-id <id>",
      "  nagomi terminal-send --session-id <id> --text \"<command>\"",
      "  nagomi shortcut --desktop",
      "",
      "env:",
      "  NAGOMI_ORCHESTRATOR_PATH  Path to nagomi-orchestrator binary",
      "  NAGOMI_ORCH_HEALTH_PORT   Health check port (default 17707)",
    ].join("\n")
  );
}

async function terminalSendCli(args) {
  const parsed = parseTerminalSendArgs(args);
  const sessionId = parsed.sessionId || args[0] || "";
  const text = parsed.text || "";
  if (!sessionId || !text) {
    printTerminalSendUsage();
    process.exitCode = 2;
    return;
  }
  const port = resolveHealthPort();
  const url = new URL(`http://127.0.0.1:${port}/terminal-send`);
  url.searchParams.set("session_id", sessionId);
  url.searchParams.set("text", text);
  try {
    const { status, body } = await httpGetBody(url);
    if (status !== 200) {
      console.error(body || `request failed: ${status}`);
      process.exitCode = 1;
      return;
    }
    if (body) {
      console.log(body.trim());
    }
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
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
  const args = process.argv.slice(2);
  const subcommand = args[0];
  if (subcommand === "terminal-send") {
    await terminalSendCli(args.slice(1));
    return;
  }
  if (subcommand === "shortcut") {
    shortcutCli(args.slice(1));
    return;
  }
  const { sessionId, showHelp, unknown } = parseLauncherArgs(args);
  if (showHelp) {
    printLauncherUsage();
    return;
  }
  if (unknown.length > 0) {
    console.error(`unknown arguments: ${unknown.join(" ")}`);
    printLauncherUsage();
    process.exitCode = 2;
    return;
  }
  const orchestratorPath = resolveOrchestratorPath();
  if (!orchestratorPath) {
    console.error("orchestrator binary not found");
    process.exitCode = 1;
    return;
  }

  if (isOrchestratorRunning()) {
    const healthy = await waitForHealth(DEFAULT_HEALTH_RETRIES);
    if (healthy) {
      try {
        await openTerminal(sessionId);
      } catch (err) {
        console.error(err && err.message ? err.message : String(err));
        process.exitCode = 1;
      }
      return;
    }
  }

  spawnOrchestrator(orchestratorPath);
  const healthy = await waitForHealth(DEFAULT_HEALTH_RETRIES);
  if (!healthy) {
    console.error("orchestrator health check failed");
    process.exitCode = 1;
    return;
  }
  try {
    await openTerminal(sessionId);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
