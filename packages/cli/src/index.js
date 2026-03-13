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

function resolveAppConfigDir() {
  if (isWindows()) {
    const base = process.env.APPDATA || "";
    if (!base) return null;
    return path.join(base, "com.kitfactory.nagomi");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.kitfactory.nagomi");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, "com.kitfactory.nagomi");
  }
  return path.join(os.homedir(), ".config", "com.kitfactory.nagomi");
}

function formatLocalTimeFromTsMs(tsMs) {
  const num = Number(tsMs);
  if (!Number.isFinite(num) || num <= 0) return "-";
  try {
    const date = new Date(num);
    if (Number.isNaN(date.getTime())) return "-";
    const pad = (v, w = 2) => String(v).padStart(w, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  } catch {
    return "-";
  }
}

function truncateText(value, maxLen = 120) {
  const raw = value == null ? "" : String(value);
  const n = Number.isFinite(Number(maxLen)) ? Math.max(8, Math.floor(Number(maxLen))) : 120;
  if (raw.length <= n) return raw;
  return `${raw.slice(0, Math.max(1, n - 3))}...`;
}

function normalizeSingleLineText(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function extractGuardSegments(reasonLine) {
  const raw = normalizeSingleLineText(reasonLine);
  if (!raw) return [];
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase().startsWith("guard:"));
}

function stripGuardSegments(reasonLine) {
  const raw = normalizeSingleLineText(reasonLine);
  if (!raw) return "";
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("guard:"))
    .join(" | ");
}

function tailFileLines(filePath, lineCount = 30, maxBytes = 1024 * 1024) {
  const n = Number.isFinite(Number(lineCount)) ? Math.max(1, Math.floor(Number(lineCount))) : 30;
  if (!filePath || !fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) return [];

  const chunkSize = 64 * 1024;
  const fd = fs.openSync(filePath, "r");
  try {
    let pos = stat.size;
    let totalBytes = 0;
    let newlineCount = 0;
    const chunks = [];

    while (pos > 0 && newlineCount < n + 1 && totalBytes < maxBytes) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      chunks.push(buf);
      totalBytes += readSize;
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        if (buf[i] === 0x0a) {
          newlineCount += 1;
          if (newlineCount >= n + 1) break;
        }
      }
    }

    const text = Buffer.concat(chunks.reverse()).toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-n);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function resolveDebugBinaryFromRoot(rootDir) {
  if (!rootDir) return null;
  const candidate = path.join(rootDir, "target", "debug", orchestratorExeName());
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function collectCandidateRootsFromCwd(maxDepth = 8) {
  const roots = [];
  let current = process.cwd();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    roots.push(current);
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
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
  const cwdRoots = collectCandidateRootsFromCwd();
  for (const rootDir of cwdRoots) {
    const candidate = resolveDebugBinaryFromRoot(rootDir);
    if (candidate) {
      return candidate;
    }
  }
  const scriptRoot = path.resolve(__dirname, "..", "..", "..");
  const scriptCandidate = resolveDebugBinaryFromRoot(scriptRoot);
  if (scriptCandidate) {
    return scriptCandidate;
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

function stopOrchestratorProcesses() {
  const name = orchestratorExeName();
  if (isWindows()) {
    spawnSync("taskkill", ["/IM", name, "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return;
  }
  spawnSync("pkill", ["-f", name], { encoding: "utf8" });
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

function isNodeLauncherTarget(target) {
  const basename = path.basename(String(target || "")).toLowerCase();
  return basename === "node.exe" || basename === "node";
}

function resolveNodewPath(nodePath) {
  if (!isWindows() || !nodePath) return null;
  const dir = path.dirname(nodePath);
  const candidate = path.join(dir, "nodew.exe");
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveWscriptPath() {
  if (!isWindows()) return null;
  const fromPath = resolveCommandInPath("wscript.exe");
  if (fromPath) return fromPath;
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const fallback = path.join(systemRoot, "System32", "wscript.exe");
  return fs.existsSync(fallback) ? fallback : null;
}

function escapeVbsString(value) {
  return String(value || "").replace(/"/g, '""');
}

function escapePowershellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function writeHiddenShortcutLauncher({ shortcutPath, target, args, workingDir }) {
  const dir = path.dirname(shortcutPath);
  const base = path.basename(shortcutPath, path.extname(shortcutPath));
  const scriptPath = path.join(dir, `${base}.nagomi-launcher.vbs`);
  const escapedTarget = escapeVbsString(target);
  const escapedArgs = escapeVbsString(args || "");
  const escapedWorkDir = escapeVbsString(workingDir || os.homedir());
  const script = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${escapedWorkDir}"`,
    `cmd = """" & "${escapedTarget}" & """"`,
    `If Len("${escapedArgs}") > 0 Then cmd = cmd & " " & "${escapedArgs}"`,
    "shell.Run cmd, 0, False",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

function resolveShortcutRuntimeForWindows({
  shortcutPath,
  target,
  args,
  workingDir,
  targetOverridden,
}) {
  if (!isWindows()) {
    return { target, args, workingDir };
  }
  if (targetOverridden || !isNodeLauncherTarget(target)) {
    return { target, args, workingDir };
  }
  const nodewPath = resolveNodewPath(target);
  if (nodewPath) {
    return { target: nodewPath, args, workingDir };
  }
  const wscriptPath = resolveWscriptPath();
  if (!wscriptPath) {
    return { target, args, workingDir };
  }
  const launcherPath = writeHiddenShortcutLauncher({
    shortcutPath,
    target,
    args,
    workingDir,
  });
  return {
    target: wscriptPath,
    args: quoteWindowsArg(launcherPath),
    workingDir,
  };
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
  let showHelp = false;
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
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
  return { sessionId, text, showHelp };
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
  const targetOverridden = Boolean(parsed.targetPath);
  const { target, baseArgs } = resolveShortcutInvocation(parsed.targetPath);
  const argsText = buildShortcutArgs(baseArgs, parsed.sessionId);
  ensureShortcutDir(shortcutPath);
  const shortcutRuntime = resolveShortcutRuntimeForWindows({
    shortcutPath,
    target,
    args: argsText,
    workingDir: os.homedir(),
    targetOverridden,
  });
  try {
    createWindowsShortcut({
      path: shortcutPath,
      target: shortcutRuntime.target,
      args: shortcutRuntime.args,
      workingDir: shortcutRuntime.workingDir,
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
  let restart = false;
  let showStatus = false;
  let showDebugPaths = false;
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
    if (arg === "--restart" || arg === "--force-restart") {
      restart = true;
      continue;
    }
    if (arg === "--status") {
      showStatus = true;
      continue;
    }
    if (arg === "--debug-paths") {
      showDebugPaths = true;
      continue;
    }
    unknown.push(arg);
  }
  return { sessionId, showHelp, restart, showStatus, showDebugPaths, unknown };
}

function printLauncherUsage() {
  console.error(
    [
      "usage:",
      "  nagomi",
      "  nagomi --restart",
      "  nagomi --session-id <id>",
      "  nagomi --restart --session-id <id>",
      "  nagomi --status",
      "  nagomi --debug-paths",
      "  nagomi debug-tail [status|watcher|subworker|subworker-io] [--n <count>]",
      "  nagomi prompt-history export [--project <query>] [--format json|jsonl] [--output <path>]",
      "  nagomi terminal-send --session-id <id> --text \"<command>\"",
      "  nagomi terminal-send --session-id <id> --text-file <path>",
      "  nagomi shortcut --desktop",
      "  nagomi shortcut --start-menu",
      "",
      "env:",
      "  NAGOMI_ORCHESTRATOR_PATH  Path to nagomi-orchestrator binary",
      "  NAGOMI_ORCH_HEALTH_PORT   Health check port (default 17707)",
    ].join("\n")
  );
}

async function terminalSendCli(args) {
  const parsed = parseTerminalSendArgs(args);
  if (parsed.showHelp) {
    printTerminalSendUsage();
    return;
  }
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

async function waitForOrchestratorStopped(retries = 40) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (!isOrchestratorRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !isOrchestratorRunning();
}

async function collectOrchestratorStatus(orchestratorPath) {
  const running = isOrchestratorRunning();
  const healthy = running ? await waitForHealth(5) : false;
  return {
    orchestratorPath: orchestratorPath || "",
    running,
    healthy,
    healthUrl: healthUrl(),
  };
}

function printOrchestratorStatus(status) {
  console.log(
    JSON.stringify(
      {
        orchestrator_path: status.orchestratorPath,
        running: Boolean(status.running),
        healthy: Boolean(status.healthy),
        health_url: status.healthUrl,
      },
      null,
      2
    )
  );
}

function collectDebugPaths() {
  const configDir = resolveAppConfigDir();
  return {
    app_config_dir: configDir || "",
    project_prompt_history_dir: configDir ? path.join(configDir, "project-prompt-history") : "",
    worker_smoke_log: configDir ? path.join(configDir, "worker_smoke.log") : "",
    subworker_debug_events_jsonl: configDir ? path.join(configDir, "subworker_debug_events.jsonl") : "",
    subworker_io_events_jsonl: configDir ? path.join(configDir, "subworker_io_events.jsonl") : "",
    status_debug_events_jsonl: configDir ? path.join(configDir, "status_debug_events.jsonl") : "",
  };
}

function printDebugPaths(paths) {
  console.log(JSON.stringify(paths || {}, null, 2));
}

function resolveDebugLogPath(kind) {
  const paths = collectDebugPaths();
  const raw = String(kind || "").trim().toLowerCase();
  if (raw === "subworker-io" || raw === "subworker_io" || raw === "io") return paths.subworker_io_events_jsonl;
  if (raw === "subworker") return paths.subworker_debug_events_jsonl;
  if (raw === "terminal") return paths.status_debug_events_jsonl;
  if (raw === "watcher") return paths.status_debug_events_jsonl;
  // default: status
  return paths.status_debug_events_jsonl;
}

function parsePromptHistoryArgs(args) {
  let action = "";
  let projectQuery = "";
  let format = "json";
  let outputPath = "";
  let showHelp = false;
  const unknown = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--project") {
      projectQuery = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--format") {
      format = String(args[i + 1] || "json");
      i += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      outputPath = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (!action && !arg.startsWith("-")) {
      action = arg;
      continue;
    }
    unknown.push(arg);
  }
  return { action, projectQuery, format, outputPath, showHelp, unknown };
}

function printPromptHistoryUsage() {
  console.error(
    [
      "usage:",
      "  nagomi prompt-history export",
      "  nagomi prompt-history export --project yurutsuku",
      "  nagomi prompt-history export --project C:/work/project --format jsonl",
      "  nagomi prompt-history export --project yurutsuku --output prompt-history.json",
    ].join("\n")
  );
}

function listProjectPromptHistoryFiles(historyDir) {
  if (!historyDir || !fs.existsSync(historyDir)) return [];
  return fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl"))
    .map((entry) => path.join(historyDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function readJsonlEntries(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry === "object");
}

function collectProjectPromptHistoryMeta(filePath, entries) {
  const fallbackKey = path.basename(filePath, ".jsonl");
  const fallbackLabel = fallbackKey.replace(/-[0-9a-f]{16}$/i, "");
  let projectKey = fallbackKey;
  let projectLabel = fallbackLabel;
  let cwd = "";
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    if (!projectKey && entry.project_key) projectKey = String(entry.project_key);
    if (!projectLabel && entry.project_label) projectLabel = String(entry.project_label);
    if (!cwd && entry.cwd) cwd = String(entry.cwd);
    if (projectKey && projectLabel && cwd) break;
  }
  return {
    projectKey: projectKey || fallbackKey,
    projectLabel: projectLabel || fallbackLabel || "unknown",
    cwd,
  };
}

function matchesProjectPromptQuery(meta, filePath, entries, rawQuery) {
  const query = normalizeSingleLineText(rawQuery).toLowerCase();
  if (!query) return true;
  const haystacks = [
    meta && meta.projectKey ? String(meta.projectKey) : "",
    meta && meta.projectLabel ? String(meta.projectLabel) : "",
    meta && meta.cwd ? String(meta.cwd) : "",
    filePath || "",
  ];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.project_key) haystacks.push(String(entry.project_key));
    if (entry.project_label) haystacks.push(String(entry.project_label));
    if (entry.cwd) haystacks.push(String(entry.cwd));
  }
  return haystacks.some((value) => normalizeSingleLineText(value).toLowerCase().includes(query));
}

function buildPromptHistoryExportPayload(projectQuery) {
  const paths = collectDebugPaths();
  const historyDir = paths.project_prompt_history_dir;
  if (!historyDir) {
    return { error: "project prompt history path not available (missing app_config_dir)" };
  }
  const files = listProjectPromptHistoryFiles(historyDir);
  if (files.length === 0) {
    return { error: `no project prompt history files: ${historyDir}` };
  }
  const projects = [];
  for (const filePath of files) {
    const entries = readJsonlEntries(filePath);
    if (entries.length === 0) continue;
    const meta = collectProjectPromptHistoryMeta(filePath, entries);
    if (!matchesProjectPromptQuery(meta, filePath, entries, projectQuery)) {
      continue;
    }
    projects.push({
      project_key: meta.projectKey,
      project_label: meta.projectLabel,
      cwd: meta.cwd,
      source_file: filePath,
      entry_count: entries.length,
      entries,
    });
  }
  if (projects.length === 0) {
    const suffix = projectQuery ? ` for query: ${projectQuery}` : "";
    return { error: `no project prompt history entries${suffix}` };
  }
  const entryCount = projects.reduce((sum, project) => sum + Number(project.entry_count || 0), 0);
  return {
    payload: {
      exported_at: new Date().toISOString(),
      project_query: projectQuery || "",
      project_count: projects.length,
      entry_count: entryCount,
      projects,
    },
  };
}

function serializePromptHistoryExport(payload, format) {
  const normalizedFormat = String(format || "json").trim().toLowerCase();
  if (normalizedFormat === "json") {
    return JSON.stringify(payload, null, 2);
  }
  if (normalizedFormat === "jsonl") {
    const lines = [];
    for (const project of payload.projects || []) {
      for (const entry of project.entries || []) {
        lines.push(
          JSON.stringify({
            ...entry,
            source_file: project.source_file,
          })
        );
      }
    }
    return lines.join("\n");
  }
  throw new Error(`unsupported format: ${format}`);
}

function writeCliOutput(outputPath, text) {
  if (!outputPath) {
    console.log(text);
    return;
  }
  const parent = path.dirname(outputPath);
  if (parent && parent !== "." && parent !== outputPath) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(outputPath, text, "utf8");
  console.log(outputPath);
}

function parseDebugTailArgs(args) {
  let kind = "";
  let n = 30;
  let showHelp = false;
  const unknown = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--n") {
      n = Number(args[i + 1] || 30);
      i += 1;
      continue;
    }
    if (!kind && !arg.startsWith("-")) {
      kind = arg;
      continue;
    }
    unknown.push(arg);
  }
  return { kind, n, showHelp, unknown };
}

function printDebugTailUsage() {
  console.error(
    [
      "usage:",
      "  nagomi debug-tail",
      "  nagomi debug-tail status",
      "  nagomi debug-tail watcher",
      "  nagomi debug-tail subworker",
      "  nagomi debug-tail subworker-io",
      "  nagomi debug-tail status --n 80",
    ].join("\n")
  );
}

function summarizeStatusEntry(entry) {
  const ts = formatLocalTimeFromTsMs(entry && entry.ts_ms);
  const eventType = entry && entry.event_type ? String(entry.event_type) : "event";
  const unified =
    entry && entry.terminal_unified && typeof entry.terminal_unified === "object"
      ? entry.terminal_unified
      : null;
  const unifiedBase = unified && unified.base_state ? String(unified.base_state) : "";
  const unifiedStatus = unified && unified.status_state ? String(unified.status_state) : "";
  const unifiedPhase = unified && unified.subworker_phase ? String(unified.subworker_phase) : "";
  const statusState =
    entry && entry.status_state
      ? String(entry.status_state)
      : unifiedStatus || "-";
  const mergedState =
    entry && entry.merged_observed && entry.merged_observed.state
      ? String(entry.merged_observed.state)
      : "-";
  const unifiedPart =
    unifiedBase || unifiedStatus || unifiedPhase
      ? ` unified=${unifiedBase || "-"}/${unifiedStatus || "-"}/${unifiedPhase || "-"}`
      : "";
  if (eventType === "state-transition" && entry.details) {
    const from = entry.details.from ? String(entry.details.from) : "-";
    const to = entry.details.to ? String(entry.details.to) : "-";
    const guarded = entry.details.guarded ? "*" : "";
    const reason = entry.details.reason ? String(entry.details.reason) : "";
    return `${ts} state ${from}->${to}${guarded}${unifiedPart} reason=${reason}`;
  }
  if (eventType === "hook-event" && entry.details) {
    const kind = entry.details.kind ? String(entry.details.kind) : "";
    const state = entry.details.state
      ? String(entry.details.state)
      : entry.details.judge_state
      ? String(entry.details.judge_state)
      : "";
    const summary = entry.details.summary ? String(entry.details.summary) : "";
    return `${ts} hook kind=${kind} state=${state}${unifiedPart} summary=${summary}`;
  }
  if (eventType === "judge-skip" && entry.details) {
    const kind = entry.details.kind ? String(entry.details.kind) : "";
    const hookKind = entry.details.hook_kind ? String(entry.details.hook_kind) : "";
    const reason = entry.details.reason ? String(entry.details.reason) : "";
    const sinceLast = Number.isFinite(Number(entry.details.since_last_ms))
      ? String(Math.floor(Number(entry.details.since_last_ms)))
      : "";
    return `${ts} judge-skip kind=${kind} since_last_ms=${sinceLast} hook_kind=${hookKind}${unifiedPart} reason=${reason}`.trim();
  }
  if ((eventType === "judge-start" || eventType === "judge-result" || eventType === "judge-fallback") && entry.details) {
    const state = entry.details.state ? String(entry.details.state) : "";
    const hookKind = entry.details.hook_kind ? String(entry.details.hook_kind) : "";
    const reason = entry.details.reason ? String(entry.details.reason) : "";
    return `${ts} ${eventType} state=${state} hook_kind=${hookKind}${unifiedPart} reason=${reason}`;
  }
  if (eventType === "judge-complete" && entry.details) {
    const state = entry.details.state ? String(entry.details.state) : "";
    const hookKind = entry.details.hook_kind ? String(entry.details.hook_kind) : "";
    const reason = entry.details.reason ? String(entry.details.reason) : "";
    const applied = Object.prototype.hasOwnProperty.call(entry.details, "applied")
      ? String(Boolean(entry.details.applied))
      : "";
    const rawState = entry.details.raw_state ? String(entry.details.raw_state) : "";
    return `${ts} ${eventType} state=${state} applied=${applied} raw=${rawState} hook_kind=${hookKind}${unifiedPart} reason=${reason}`;
  }
  return `${ts} event=${eventType} status=${statusState} merged=${mergedState}${unifiedPart}`;
}

function isWatcherStatusEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const eventType = entry.event_type ? String(entry.event_type).toLowerCase() : "";
  if (eventType.startsWith("watcher-")) return true;
  return false;
}

function summarizeWatcherStatusEntry(entry) {
  const ts = formatLocalTimeFromTsMs(entry && entry.ts_ms);
  const eventType = entry && entry.event_type ? String(entry.event_type) : "watcher-event";
  const details = entry && entry.details && typeof entry.details === "object" ? entry.details : {};
  const detailParts = [];
  const pushIfPresent = (label, key) => {
    if (!Object.prototype.hasOwnProperty.call(details, key)) return;
    const raw = details[key];
    if (raw == null || raw === "") return;
    detailParts.push(`${label}=${truncateText(String(raw), 120)}`);
  };
  pushIfPresent("reason", "reason");
  pushIfPresent("attempt", "attempt");
  pushIfPresent("elapsed_ms", "elapsed_ms");
  pushIfPresent("retry_in_ms", "retry_in_ms");
  pushIfPresent("timeout", "timeout");
  pushIfPresent("stage", "stage");
  pushIfPresent("model", "model_path");
  pushIfPresent("vrm", "vrm_path");
  pushIfPresent("deps", "deps_source");
  pushIfPresent("message", "message");
  if (Array.isArray(details.candidates) && details.candidates.length > 0) {
    detailParts.push(`candidates=${details.candidates.join(",")}`);
  }
  const suffix = detailParts.length > 0 ? ` ${detailParts.join(" ")}` : "";
  return `${ts} ${eventType}${suffix}`.trim();
}

function summarizeSubworkerEntry(entry) {
  const ts = formatLocalTimeFromTsMs(entry && entry.ts_ms);
  const eventType = entry && entry.event_type ? String(entry.event_type) : "event";
  const observed = entry && entry.observed_state ? String(entry.observed_state) : "-";
  const status = entry && entry.observed_status ? String(entry.observed_status) : "-";
  const src =
    entry && entry.hook_complete_source
      ? String(entry.hook_complete_source)
      : entry && entry.judge_complete_source
      ? String(entry.judge_complete_source)
      : "-";
  const phase = entry && entry.subworker && entry.subworker.phase ? String(entry.subworker.phase) : "-";
  const action = entry && entry.details && entry.details.action ? String(entry.details.action) : "";
  const result = entry && entry.details && entry.details.result ? String(entry.details.result) : "";
  return `${ts} event=${eventType} observed=${observed} status=${status} src=${src} phase=${phase} ${action} ${result}`.trim();
}

function summarizeSubworkerIoEntry(entry) {
  const ts = formatLocalTimeFromTsMs(entry && entry.ts_ms);
  const eventType = entry && entry.event_type ? String(entry.event_type) : "event";
  const details = entry && entry.details && typeof entry.details === "object" ? entry.details : {};
  const observedState = entry && entry.observed_state ? String(entry.observed_state) : "";
  const hookSource =
    entry && entry.hook_complete_source
      ? String(entry.hook_complete_source)
      : entry && entry.judge_complete_source
      ? String(entry.judge_complete_source)
      : "";
  if (eventType === "llm-start") {
    const tool = details.tool ? String(details.tool) : "";
    const state =
      details.prompt_vars && details.prompt_vars.state
        ? String(details.prompt_vars.state)
        : details.prompt_vars && details.prompt_vars.judge_state
        ? String(details.prompt_vars.judge_state)
        : "";
    const instruction = details.prompt_vars && details.prompt_vars.instruction ? String(details.prompt_vars.instruction) : "";
    const src = hookSource ? ` src=${hookSource}` : "";
    const observed = observedState ? ` observed=${observedState}` : "";
    return `${ts} llm-start tool=${tool}${src}${observed} state=${state} instruction=${truncateText(
      instruction,
      80
    )}`;
  }
  if (eventType === "llm-result") {
    const llm = details.llm_json && typeof details.llm_json === "object" ? details.llm_json : null;
    const action = llm && llm.action ? String(llm.action) : "";
    const confidence = llm && llm.confidence != null ? String(llm.confidence) : "";
    const advice = llm && llm.advice_markdown ? String(llm.advice_markdown) : "";
    return `${ts} llm-result action=${action} conf=${confidence} advice=${truncateText(advice, 90)}`;
  }
  if (eventType === "llm-error") {
    const msg = details.message ? String(details.message) : "";
    const src = hookSource ? ` src=${hookSource}` : "";
    const observed = observedState ? ` observed=${observedState}` : "";
    return `${ts} llm-error${src}${observed} ${truncateText(msg, 120)}`.trim();
  }
  if (eventType === "llm-skip") {
    const reason = details.reason ? String(details.reason) : "";
    return `${ts} llm-skip reason=${reason}`;
  }
  if (eventType === "result") {
    const action = details.action ? String(details.action) : "";
    const conf = details.confidence != null ? String(details.confidence) : "";
    const threshold = details.threshold != null ? String(details.threshold) : "";
    const inputPreview = details.input_preview ? String(details.input_preview) : "";
    const advice = details.advice_preview ? String(details.advice_preview) : "";
    const res = details.result ? String(details.result) : "";
    const reasonLine = details.reason ? String(details.reason) : "";
    const guard = extractGuardSegments(reasonLine).join(", ");
    const fallback = action === "show_advice" && guard ? " fallback=guarded" : "";
    const thresholdPart = threshold ? ` threshold=${threshold}` : "";
    const guardPart = guard ? ` guard=${truncateText(guard, 60)}` : "";
    const reasonPart = reasonLine
      ? ` reason=${truncateText(stripGuardSegments(reasonLine), 120)}`
      : "";
    return `${ts} result action=${action} conf=${conf}${thresholdPart}${fallback} input=${inputPreview} res=${res}${guardPart} advice=${truncateText(
      advice,
      90
    )}${reasonPart}`;
  }
  return `${ts} ${eventType}`;
}

function summarizeTerminalSnapshotEntry(entry) {
  const ts = formatLocalTimeFromTsMs(entry && entry.ts_ms);
  const statusState = entry && entry.status_state ? String(entry.status_state) : "-";
  const eventType = entry && entry.event_type ? String(entry.event_type) : "-";
  const eventDetail = entry && entry.event_detail ? String(entry.event_detail) : "";
  const agent = entry && entry.agent_active ? "on" : "off";
  return `${ts} snapshot status=${statusState} agent=${agent} event=${eventType} ${eventDetail}`.trim();
}

async function debugTailCli(args) {
  const parsed = parseDebugTailArgs(args);
  if (parsed.showHelp) {
    printDebugTailUsage();
    return;
  }
  if (parsed.unknown.length > 0) {
    console.error(`unknown arguments: ${parsed.unknown.join(" ")}`);
    printDebugTailUsage();
    process.exitCode = 2;
    return;
  }
  const kind = parsed.kind || "status";
  const filePath = resolveDebugLogPath(kind);
  if (!filePath) {
    console.error("debug log path not available (missing app_config_dir)");
    process.exitCode = 1;
    return;
  }
  const lines = tailFileLines(filePath, parsed.n);
  if (lines.length === 0) {
    console.error(`no log entries: ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const summaries = [];
  const normalizedKind = String(kind).toLowerCase();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (normalizedKind === "watcher" && !isWatcherStatusEntry(obj)) {
        continue;
      }
      if (normalizedKind === "subworker") {
        summaries.push(summarizeSubworkerEntry(obj));
      } else if (normalizedKind === "subworker-io" || normalizedKind === "subworker_io" || normalizedKind === "io") {
        summaries.push(summarizeSubworkerIoEntry(obj));
      } else if (normalizedKind === "terminal") {
        summaries.push(summarizeStatusEntry(obj));
      } else if (normalizedKind === "watcher") {
        summaries.push(summarizeWatcherStatusEntry(obj));
      } else {
        summaries.push(summarizeStatusEntry(obj));
      }
    } catch {
      summaries.push(line);
    }
  }
  if (summaries.length === 0 && normalizedKind === "watcher") {
    console.error("no watcher log entries in selected range");
    process.exitCode = 1;
    return;
  }
  console.log(summaries.join("\n"));
}

async function promptHistoryCli(args) {
  const parsed = parsePromptHistoryArgs(args);
  if (parsed.showHelp) {
    printPromptHistoryUsage();
    return;
  }
  if (parsed.unknown.length > 0) {
    console.error(`unknown arguments: ${parsed.unknown.join(" ")}`);
    printPromptHistoryUsage();
    process.exitCode = 2;
    return;
  }
  if (parsed.action !== "export") {
    printPromptHistoryUsage();
    process.exitCode = 2;
    return;
  }
  try {
    const result = buildPromptHistoryExportPayload(parsed.projectQuery);
    if (result.error) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    const body = serializePromptHistoryExport(result.payload, parsed.format);
    writeCliOutput(parsed.outputPath, body);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

function spawnOrchestrator(orchestratorPath) {
  const args = ["--start-hidden", "--exit-on-last-terminal"];
  if (isWindows()) {
    // On Windows, spawning the Tauri binary directly (detached + hidden) can cause stdout/stderr
    // in the parent process to behave unexpectedly in some shells/runners. Use `Start-Process`
    // to detach cleanly.
    const exe = escapePowershellSingleQuoted(orchestratorPath);
    const ps = `Start-Process -FilePath '${exe}' -ArgumentList @('--start-hidden','--exit-on-last-terminal') -WindowStyle Hidden`;
    // Use spawnSync so the launcher keeps a stable stdout/stderr and we get deterministic failures.
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8", windowsHide: true }
    );
    if (result.status !== 0) {
      const message = (result.stderr || result.stdout || "failed to spawn orchestrator").trim();
      throw new Error(message);
    }
    return;
  }
  const child = spawn(orchestratorPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  if (subcommand === "help") {
    printLauncherUsage();
    return;
  }
  if (subcommand === "debug-tail") {
    await debugTailCli(args.slice(1));
    return;
  }
  if (subcommand === "prompt-history") {
    await promptHistoryCli(args.slice(1));
    return;
  }
  if (subcommand === "terminal-send") {
    await terminalSendCli(args.slice(1));
    return;
  }
  if (subcommand === "shortcut") {
    shortcutCli(args.slice(1));
    return;
  }
  const { sessionId, showHelp, restart, showStatus, showDebugPaths, unknown } = parseLauncherArgs(args);
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
  if (showDebugPaths) {
    printDebugPaths(collectDebugPaths());
    return;
  }

  const orchestratorPath = resolveOrchestratorPath();
  if (!orchestratorPath) {
    console.error("orchestrator binary not found");
    process.exitCode = 1;
    return;
  }

  // `--status` should be non-mutating: do not start/stop processes unless explicitly requested.
  if (showStatus && !restart) {
    const status = await collectOrchestratorStatus(orchestratorPath);
    printOrchestratorStatus(status);
    return;
  }

  if (restart) {
    stopOrchestratorProcesses();
    const stopped = await waitForOrchestratorStopped();
    if (!stopped) {
      console.error("orchestrator restart failed: existing process did not stop");
      process.exitCode = 1;
      return;
    }
  }

  if (!restart && isOrchestratorRunning()) {
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
    console.error("orchestrator already running but health check failed (try --restart)");
    process.exitCode = 1;
    return;
  }

  spawnOrchestrator(orchestratorPath);
  const healthy = await waitForHealth(DEFAULT_HEALTH_RETRIES);
  if (!healthy) {
    console.error("orchestrator health check failed");
    process.exitCode = 1;
    return;
  }
  if (showStatus) {
    const status = await collectOrchestratorStatus(orchestratorPath);
    printOrchestratorStatus(status);
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

