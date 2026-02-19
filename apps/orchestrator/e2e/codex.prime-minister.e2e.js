const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { Builder, Capabilities, until, By } = require("selenium-webdriver");
const { ensureDriversOnPath, resolveTauriDriverPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

const repoRoot = path.join(__dirname, "..", "..", "..");

process.env.NAGOMI_ENABLE_TEST_ENDPOINTS = process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

function appPath() {
  const base = path.join(repoRoot, "target", "debug", "nagomi-orchestrator");
  return process.platform === "win32" ? `${base}.exe` : base;
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fn();
    if (ok) return;
    await sleep(200);
  }
  throw new Error("timeout waiting for condition");
}

async function waitForDriver(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/status" }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error("webdriver not responding");
}

async function invokeTauri(client, command, payload) {
  const result = await client.executeAsyncScript(
    function (command, payload, done) {
      const invoke =
        (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
        (window.__TAURI__ && window.__TAURI__.invoke);
      if (!invoke) {
        done({ error: "invoke not available" });
        return;
      }
      invoke(command, payload)
        .then((data) => done({ ok: true, data }))
        .catch((err) => done({ error: String(err) }));
    },
    command,
    payload
  );
  if (!result || result.error) {
    throw new Error(result && result.error ? result.error : `${command} failed`);
  }
  return result.data;
}

async function ensureTestHooks(client) {
  await client.executeScript("if (typeof registerTestHooks === 'function') registerTestHooks();");
  await waitFor(async () => {
    const ok = await client
      .executeScript("return Boolean(window.nagomiTest && window.nagomiTest.getInternalState);")
      .catch(() => false);
    return Boolean(ok);
  }, 10000);
}

async function getIpcSessionIdFromInternalState(client) {
  const internal = await client.executeScript(
    "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
  );
  return internal && typeof internal.ipcSessionId === "string" && internal.ipcSessionId
    ? internal.ipcSessionId
    : null;
}

async function openAndSetIpcSessionId(client) {
  const snapshot = await invokeTauri(client, "ipc_session_open", { clientEpoch: Date.now() });
  const sessionId = snapshot && snapshot.sessionId ? snapshot.sessionId : null;
  if (!sessionId) {
    throw new Error("ipc session id not ready");
  }
  await client.executeScript(
    "window.__ipcSessionId = arguments[0]; if (typeof ipcSessionId !== 'undefined') { ipcSessionId = arguments[0]; }",
    sessionId
  );
  return sessionId;
}

function isWindowsProcessRunning(imageName) {
  if (process.platform !== "win32") return false;
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`], {
    encoding: "utf8",
  });
  return result.stdout && result.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function resolveRunDir() {
  const fromEnv = process.env.NAGOMI_E2E_ISOLATED_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(__dirname, "sandbox", "isolated-workdir", `run-${Date.now()}`);
}

async function main() {
  const targetApp = appPath();
  if (!exists(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }

  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-orchestrator.exe")) {
    throw new Error("nagomi-orchestrator already running");
  }

  const runDir = resolveRunDir();
  const appConfigDir = path.join(runDir, "app-config");
  const appDataDir = path.join(runDir, "appdata");
  const hooksDir = path.join(runDir, "hooks");
  ensureDir(appConfigDir);
  ensureDir(appDataDir);
  ensureDir(hooksDir);

  // Isolate logs/settings under this run directory.
  if (process.platform === "win32") {
    process.env.APPDATA = appDataDir;
  }
  process.env.NAGOMI_APP_CONFIG_DIR = appConfigDir;
  process.env.NAGOMI_HOOKS_DIR = hooksDir;

  if (!process.env.NAGOMI_ORCH_HEALTH_PORT) {
    process.env.NAGOMI_ORCH_HEALTH_PORT = String(await pickFreePort());
  }

  const { tauriPath, edgePath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    throw new Error("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
  }
  if (process.platform === "win32" && !edgePath) {
    throw new Error("msedgedriver not found (set NAGOMI_EDGE_DRIVER or update PATH)");
  }

  const driverPort = 4444;
  const driver = spawn(tauriPath || resolveTauriDriverPath(), ["--port", String(driverPort)], {
    stdio: "inherit",
  });

  let client = null;
  let previousSettings = null;

  try {
    await waitForDriver(driverPort, 10000);
    const caps = new Capabilities();
    caps.set("browserName", "webview2");
    caps.set("tauri:options", { application: targetApp, args: [] });

    client = await new Builder()
      .usingServer(`http://127.0.0.1:${driverPort}`)
      .forBrowser("webview2")
      .withCapabilities(caps)
      .build();

    await client.manage().setTimeouts({ script: 20000, implicit: 0, pageLoad: 30000 });
    await client.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);

    const opened = await openAndSwitchToTerminalWindow(client, `e2e-codex-${Date.now()}`, 20000);
    await client.switchTo().window(opened.handle);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 20000);

    await ensureTestHooks(client);
    await waitFor(async () => {
      const internalId = await getIpcSessionIdFromInternalState(client);
      const readiness = await client.executeScript(`
        try {
          return {
            terminalInitialized: typeof terminalInitialized !== 'undefined' ? terminalInitialized : false
          };
        } catch {
          return null;
        }
      `);
      return Boolean(readiness && readiness.terminalInitialized && internalId);
    }, 20000);

    // Force a fresh ipc session id (and ensure invokeWithSession sees it).
    const ipcSessionId = await openAndSetIpcSessionId(client);

    previousSettings = await invokeTauri(client, "load_settings", { ipcSessionId });
    if (!previousSettings) {
      throw new Error("settings not loaded");
    }

    const nextSettings = {
      ...previousSettings,
      llm_enabled: true,
      llm_tool: "codex",
      subworker_enabled: true,
      subworker_debug_enabled: true,
      status_debug_enabled: true,
      // Speed up judge cycles in E2E.
      silence_timeout_ms: 1000,
    };
    await invokeTauri(client, "save_settings", { ipcSessionId, settings: nextSettings });

    await waitFor(async () => {
      const snapshot = await client.executeScript(`
        try {
          return {
            terminalInitialized: typeof terminalInitialized !== 'undefined' ? terminalInitialized : false,
            terminalSessionReady: typeof terminalSessionReady !== 'undefined' ? terminalSessionReady : false
          };
        } catch {
          return null;
        }
      `);
      return Boolean(snapshot && snapshot.terminalInitialized);
    }, 30000);

    // Wait until the terminal session is ready to accept PTY input.
    await waitFor(async () => {
      const ready = await client.executeScript(
        "return typeof terminalSessionReady !== 'undefined' ? Boolean(terminalSessionReady) : false;"
      );
      return Boolean(ready);
    }, 30000);

    // Resolve the actual debug file paths from backend (do not assume APPDATA layout).
    const subworkerDebugFile = await invokeTauri(client, "append_subworker_debug_event", {
      ipcSessionId,
      payload: { source: "e2e", event_type: "probe" },
    });
    const statusDebugFile = await invokeTauri(client, "append_status_debug_event", {
      ipcSessionId,
      payload: { source: "e2e", event_type: "probe" },
    });

    // Send `codex` and a real prompt via the same path as UI typing.
    // Use `enqueueTerminalInput` to mimic the real keyboard input path.
    // `enqueueTerminalInput` を使い、実際のキー入力経路に近い形で入力する。
    await waitFor(async () => {
      const ok = await client
        .executeScript("return typeof enqueueTerminalInput === 'function';")
        .catch(() => false);
      return Boolean(ok);
    }, 20000);

    await client.executeScript("enqueueTerminalInput(arguments[0]);", "codex\r");

    // Wait for Codex to show its initial UI, then ensure we do NOT jump to need-input before the
    // first instruction is submitted. This guards against: idle -> need-input at tool start.
    await waitFor(async () => {
      const internal = await client.executeScript(
        "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
      );
      const outputTail = internal && typeof internal.outputTail === "string" ? internal.outputTail : "";
      const tail = outputTail.toLowerCase();
      const codexUiVisible =
        tail.includes("context left") || tail.includes("for shortcuts") || tail.includes("openai codex");
      const hasAnyOutput = Boolean(outputTail.trim());
      return Boolean(internal && internal.agentActive && (codexUiVisible || hasAnyOutput));
    }, 60000);

    const idleWindowMs = Number(nextSettings.silence_timeout_ms || 1000) + 900;
    const sampleCount = Math.max(4, Math.floor(idleWindowMs / 250));
    for (let i = 0; i < sampleCount; i += 1) {
      const observed = await client.executeScript(
        "return window.nagomiTest && window.nagomiTest.getObservedState ? window.nagomiTest.getObservedState() : null;"
      );
      const status = observed && typeof observed.status === "string" ? observed.status : "unknown";
      if (status !== "idle") {
        throw new Error(`expected idle before first instruction, got: ${status}`);
      }
      await sleep(250);
    }

    // Now submit the first instruction.
    await client.executeScript(
      "enqueueTerminalInput(arguments[0]);",
      "Who is the current Prime Minister of Japan?\r"
    );

    // Give it some time; we only assert that judge/subworker logs are being appended.
    await waitFor(async () => {
      try {
        const entries = fs.readFileSync(String(subworkerDebugFile || ""), "utf8");
        return entries.includes("\"event_type\":\"start\"") || entries.includes("\"event_type\":\"llm-start\"");
      } catch {
        return false;
      }
    }, 60000);

    console.log("[e2e] codex prime-minister OK", {
      runDir,
      appConfigDir,
      appDataDir,
      hooksDir,
      subworkerDebugFile,
      statusDebugFile,
    });
  } finally {
    if (client) {
      if (previousSettings) {
        try {
          const ipcSessionId =
            (await client.executeScript("return window.__ipcSessionId || null;")) || null;
          if (ipcSessionId) {
            await invokeTauri(client, "save_settings", {
              ipcSessionId,
              settings: previousSettings,
            });
          }
        } catch {
          // ignore
        }
      }
      await client.quit();
    }
    if (driver) {
      driver.kill();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

