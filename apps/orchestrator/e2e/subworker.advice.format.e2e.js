const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { Builder, Capabilities, until, By } = require("selenium-webdriver");
const { ensureDriversOnPath, resolveTauriDriverPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

const repoRoot = path.join(__dirname, "..", "..", "..");
process.env.NAGOMI_ENABLE_TEST_ENDPOINTS = process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

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
      const req = require("node:http").get(
        { host: "127.0.0.1", port, path: "/status" },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
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

async function openAndSetIpcSessionId(client) {
  const snapshot = await invokeTauri(client, "ipc_session_open", {
    clientEpoch: Date.now(),
  });
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

async function ensureTestHooks(client) {
  await client.executeScript("if (typeof registerTestHooks === 'function') registerTestHooks();");
  await waitFor(async () => {
    const ok = await client
      .executeScript("return Boolean(window.nagomiTest && window.nagomiTest.getInternalState);")
      .catch(() => false);
    return Boolean(ok);
  }, 10000);
}

function resetDebugFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing file
  }
}

function readJsonl(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // ignore malformed
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function appPath() {
  const base = path.join(repoRoot, "target", "debug", "nagomi-orchestrator");
  return process.platform === "win32" ? `${base}.exe` : base;
}

async function main() {
  const targetApp = appPath();
  if (!fs.existsSync(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }

  if (!process.env.NAGOMI_ORCH_HEALTH_PORT) {
    process.env.NAGOMI_ORCH_HEALTH_PORT = String(await pickFreePort());
  }

  // Use a stub tool to make the E2E deterministic.
  process.env.NAGOMI_TOOL_PATH = process.execPath; // node.exe
  const stubPath = path.join(__dirname, "stubs", "subworker_llm_stub.js");
  process.env.NAGOMI_SUBWORKER_TOOL_ARGS = stubPath;
  process.env.NAGOMI_SUBWORKER_TOOL_TIMEOUT_MS = "5000";

  const { tauriPath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    throw new Error("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
  }

  const driverPort = 4450;
  const driver = spawn(tauriPath || resolveTauriDriverPath(), ["--port", String(driverPort)], {
    stdio: "inherit",
  });

  let client = null;
  try {
    await waitForDriver(driverPort, 10000);
    const caps = new Capabilities();
    caps.set("browserName", "webview2");
    caps.set("tauri:options", {
      application: targetApp,
      args: [],
    });

    client = await new Builder()
      .usingServer(`http://127.0.0.1:${driverPort}`)
      .forBrowser("webview2")
      .withCapabilities(caps)
      .build();

    await client.manage().setTimeouts({ script: 20000, implicit: 0, pageLoad: 30000 });
    await client.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);

    const opened = await openAndSwitchToTerminalWindow(
      client,
      `e2e-subworker-advice-${Date.now()}`,
      20000
    );
    await client.switchTo().window(opened.handle);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 20000);

    await ensureTestHooks(client);
    const ipcSessionId = await openAndSetIpcSessionId(client);
    const previousSettings = await invokeTauri(client, "load_settings", { ipcSessionId });
    if (!previousSettings) {
      throw new Error("settings not loaded");
    }

    const settings = {
      ...previousSettings,
      llm_enabled: true,
      llm_tool: "stub",
      subworker_enabled: true,
      subworker_debug_enabled: true,
      status_debug_enabled: true,
      subworker_mode: "advice",
      subworker_confidence_threshold: 0.8,
    };
    await invokeTauri(client, "save_settings", { ipcSessionId, settings });

    await waitFor(async () => {
      const snapshot = await client.executeScript(
        "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
      );
      return Boolean(
        snapshot &&
          snapshot.ipcSessionId &&
          snapshot.terminalSessionId &&
          snapshot.subworker &&
          snapshot.subworker.enabled === true &&
          snapshot.subworker.debug_enabled === true
      );
    }, 20000);

    // Resolve debug file path from backend.
    const debugPath = await invokeTauri(client, "append_subworker_debug_event", {
      ipcSessionId,
      payload: { source: "e2e", event_type: "probe" },
    });
    const debugFile = typeof debugPath === "string" ? debugPath : "";
    if (!debugFile) {
      throw new Error("subworker debug file path not returned");
    }
    resetDebugFile(debugFile);

    // Inject a tail that looks like a 1/2 choice prompt and set a last input.
    await client.executeScript(`
      outputTailBuffer = "Pick one. 1か2で答えてください。\\n> ";
      lastInputLine = "前回グーで負けた。次は2案。";
    `);

    const ok = await client.executeScript(
      "return window.nagomiTest && window.nagomiTest.triggerSubworkerJudgeComplete ? (window.nagomiTest.triggerSubworkerJudgeComplete({ state: 'need-input', reason: 'e2e choice prompt', source: 'judge-result' }), true) : false;"
    );
    if (!ok) {
      throw new Error("triggerSubworkerJudgeComplete unavailable");
    }

    await waitFor(async () => {
      const entries = readJsonl(debugFile);
      return entries.some((entry) => entry && entry.event_type === "llm-result");
    }, 20000);

    const internal = await client.executeScript(
      "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
    );
    const displayLine = internal && internal.subworker ? internal.subworker.displayLine || "" : "";
    if (!displayLine.includes("次に入力:")) {
      throw new Error(`display line missing next-input prefix: ${displayLine}`);
    }
    if (!displayLine.includes("1<Enter>")) {
      throw new Error(`display line missing suggested input: ${displayLine}`);
    }
    if (!displayLine.includes("LONGTOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789")) {
      throw new Error(`display line truncated too early (token missing): ${displayLine}`);
    }

    const suggestedInput =
      internal && internal.subworker ? String(internal.subworker.suggestedInput || "") : "";
    if (!suggestedInput.includes("1")) {
      throw new Error(`suggested input missing: ${suggestedInput}`);
    }

    // Apply the suggestion using a document-level Tab (this should work even when focus is not on xterm).
    await client.executeScript(`
      try {
        const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
      } catch {}
    `);

    await waitFor(async () => {
      const entries = readJsonl(debugFile);
      return entries.some((entry) => entry && entry.event_type === "accept-suggestion");
    }, 20000);

    console.log("[e2e] subworker advice format OK", {
      displayLine,
    });
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        // ignore
      }
    }
    driver.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
