const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

const repoRoot = path.join(__dirname, "..", "..", "..");

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

function isWindowsProcessRunning(imageName) {
  if (process.platform !== "win32") {
    return false;
  }
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`], {
    encoding: "utf8",
  });
  return result.stdout && result.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

function buildNotifyOverride() {
  const localScript = path.join(repoRoot, "packages", "cli", "src", "nagomi-codex-notify.js");
  if (!exists(localScript)) {
    throw new Error("nagomi-codex-notify not found; install CLI or build local script");
  }
  const scriptPath = toPosixPath(localScript);
  return `-c \"notify=['node','${scriptPath}']\"`;
}

function buildCodexLaunchCommand() {
  const notifyOverride = buildNotifyOverride();
  return `codex --no-alt-screen ${notifyOverride}`;
}

function hooksDir() {
  return path.join(os.homedir(), ".nagomi", "hooks");
}

function hookFilePath() {
  return path.join(hooksDir(), "codex.jsonl");
}

function snapshotHookFile() {
  const filePath = hookFilePath();
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function restoreHookFile(snapshot) {
  const filePath = hookFilePath();
  if (snapshot === null) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    return;
  }
  fs.mkdirSync(hooksDir(), { recursive: true });
  fs.writeFileSync(filePath, snapshot, "utf8");
}

function resetHookFile() {
  fs.mkdirSync(hooksDir(), { recursive: true });
  fs.writeFileSync(hookFilePath(), "", "utf8");
}

function hookTail(lineCount = 5) {
  const filePath = hookFilePath();
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    const lines = contents.trimEnd().split(/\r?\n/);
    return lines.slice(-lineCount).join("\n");
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fn();
    if (ok) {
      return;
    }
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
    if (ok) {
      return;
    }
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

async function invokeWithRetries(client, command, payload, attempts = 20, delayMs = 300) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await invokeTauri(client, command, payload);
      return;
    } catch (err) {
      lastError = err;
      await sleep(delayMs);
    }
  }
  throw lastError || new Error(`${command} failed`);
}

async function sendTerminalTextSlow(client, ipcSessionId, sessionId, text, delayMs = 20) {
  for (const ch of text) {
    await invokeWithRetries(client, "terminal_send_input", {
      ipcSessionId,
      sessionId,
      text: ch,
    });
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

async function waitForTerminalOutputContains(client, needle, timeoutMs = 15000) {
  await waitFor(async () => {
    const events = await client.executeScript("return window.__e2eTerminalEvents || [];");
    return events.some(
      (entry) =>
        entry &&
        entry.payload &&
        typeof entry.payload.chunk === "string" &&
        entry.payload.chunk.toLowerCase().includes(needle.toLowerCase())
    );
  }, timeoutMs);
}

async function main() {
  const targetApp = appPath();
  if (!exists(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }
  const hookSnapshot = snapshotHookFile();
  resetHookFile();

  const { tauriPath, edgePath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    throw new Error("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
  }
  if (process.platform === "win32" && !edgePath) {
    throw new Error("msedgedriver not found (set NAGOMI_EDGE_DRIVER or update PATH)");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-orchestrator.exe")) {
    throw new Error("nagomi-orchestrator already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-worker.exe")) {
    throw new Error("nagomi-worker already running");
  }

  const driverPort = 4460;
  const driver = spawn(tauriPath, ["--port", String(driverPort)], { stdio: "inherit" });
  let client;
  let previousSettings = null;
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

    const terminalWindow = await openAndSwitchToTerminalWindow(
      client,
      `e2e-codex-${Date.now()}`
    );
    console.log("[e2e] terminal window", terminalWindow);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);

    let ipcSessionId = await waitFor(async () => {
      const sessionId = await client.executeScript("return window.__ipcSessionId || null;");
      return sessionId || null;
    }, 10000).then(async () => {
      return await client.executeScript("return window.__ipcSessionId || null;");
    });
    if (!ipcSessionId) {
      ipcSessionId = await invokeTauri(client, "ipc_session_open", {
        clientEpoch: Date.now(),
      }).then((snapshot) => (snapshot && snapshot.sessionId ? snapshot.sessionId : null));
    }
    if (!ipcSessionId) {
      throw new Error("ipc session id not ready");
    }
    await client.executeScript(
      "window.__ipcSessionId = arguments[0]; if (typeof ipcSessionId !== 'undefined') { ipcSessionId = arguments[0]; }",
      ipcSessionId
    );

    const hookListenResult = await client.executeAsyncScript(function (done) {
      const listen =
        window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen
          ? window.__TAURI__.event.listen
          : null;
      if (!listen) {
        done({ error: "event.listen not available" });
        return;
      }
      window.__e2eHookEvents = [];
      listen("completion-hook-state", (event) => {
        window.__e2eHookEvents.push({
          payload: event && event.payload,
          ts: Date.now(),
        });
      });
      done({ ok: true });
    });
    if (hookListenResult && hookListenResult.error) {
      throw new Error(hookListenResult.error);
    }

    const terminalEventProbe = await client.executeAsyncScript(function (done) {
      const listen =
        window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen
          ? window.__TAURI__.event.listen
          : null;
      if (!listen) {
        done({ error: "event.listen not available" });
        return;
      }
      window.__e2eTerminalEvents = [];
      listen("terminal-output", (event) => {
        window.__e2eTerminalEvents.push({ type: "output", payload: event && event.payload });
      });
      listen("terminal-output-broadcast", (event) => {
        window.__e2eTerminalEvents.push({
          type: "output-broadcast",
          payload: event && event.payload,
        });
      });
      listen("terminal-error", (event) => {
        window.__e2eTerminalEvents.push({ type: "error", payload: event && event.payload });
      });
      listen("terminal-exit", (event) => {
        window.__e2eTerminalEvents.push({ type: "exit", payload: event && event.payload });
      });
      done({ ok: true });
    });
    if (terminalEventProbe && terminalEventProbe.error) {
      throw new Error(terminalEventProbe.error);
    }

    const settings = await invokeTauri(client, "load_settings", { ipcSessionId });
    previousSettings = settings || null;
    if (!previousSettings) {
      throw new Error("settings not loaded");
    }
    if (previousSettings.llm_tool !== "codex") {
      const updatedSettings = { ...previousSettings, llm_tool: "codex" };
      await invokeTauri(client, "save_settings", { ipcSessionId, settings: updatedSettings });
    }

    const hasTerminalLib = await client.executeScript("return Boolean(window.Terminal);");
    if (!hasTerminalLib) {
      throw new Error("terminal library missing");
    }

    await client.executeScript("if (typeof initTerminal === 'function') initTerminal();");
    await waitFor(async () => {
      const initialized = await client
        .executeScript(
          "return typeof terminalInitialized !== 'undefined' && terminalInitialized === true;"
        )
        .catch(() => false);
      return Boolean(initialized);
    }, 10000);

    const sessionId = await client.executeScript(
      "return typeof terminalSessionId !== 'undefined' ? terminalSessionId : null;"
    );
    if (!sessionId) {
      throw new Error("terminal session id not found");
    }

    await invokeTauri(client, "register_terminal_session", { ipcSessionId, sessionId });
    await invokeWithRetries(client, "start_terminal_session", {
      ipcSessionId,
      sessionId,
      cols: 120,
      rows: 30,
    });

    await waitFor(async () => {
      const ready = await client
        .executeScript(
          "return typeof terminal !== 'undefined' && terminal && terminal.cols > 0 && terminal.rows > 0;"
        )
        .catch(() => false);
      return Boolean(ready);
    }, 20000);

    await client.executeScript("window.__e2eTerminalEvents = [];");
    await invokeWithRetries(client, "terminal_send_input", {
      ipcSessionId,
      sessionId,
      text: "where codex\r\n",
    });
    await waitForTerminalOutputContains(client, "codex.cmd", 15000);

    const codexLaunch = buildCodexLaunchCommand();
    await invokeWithRetries(client, "terminal_send_input", {
      ipcSessionId,
      sessionId,
      text: `${codexLaunch}\r\n`,
    });
    await waitFor(async () => {
      const events = await client.executeScript("return window.__e2eTerminalEvents || [];");
      return events.some(
        (entry) =>
          entry &&
          entry.payload &&
          typeof entry.payload.chunk === "string" &&
          entry.payload.chunk.includes("OpenAI Codex")
      );
    }, 30000);
    const promptText = "Return the single word OK and stop.";
    await sendTerminalTextSlow(client, ipcSessionId, sessionId, promptText, 15);
    await invokeWithRetries(client, "terminal_send_input", {
      ipcSessionId,
      sessionId,
      text: "\r",
    });
    await sleep(8000);
    await sendTerminalTextSlow(client, ipcSessionId, sessionId, "exit", 15);
    await invokeWithRetries(client, "terminal_send_input", {
      ipcSessionId,
      sessionId,
      text: "\r",
    });

    const hookPreview = hookTail(5);
    if (hookPreview) {
      console.log("[e2e] hook preview", hookPreview);
    }

    try {
      await waitFor(async () => {
        const events = await client.executeScript("return window.__e2eHookEvents || [];");
        return events.some(
          (entry) => entry && entry.payload && entry.payload.source === "codex"
        );
      }, 60000);
    } catch (err) {
      let terminalEvents = [];
      try {
        terminalEvents = await client.executeScript("return window.__e2eTerminalEvents || [];");
      } catch {
        terminalEvents = [];
      }
      const hookLog = hookTail(10);
      throw new Error(
        `hook event not observed: ${err}\nterminalEvents=${JSON.stringify(terminalEvents).slice(0, 2000)}\nhookTail=${hookLog}`
      );
    }

    console.log("[e2e] codex hook event observed");
  } finally {
    if (client) {
      if (previousSettings && previousSettings.llm_tool !== "codex") {
        try {
          await invokeTauri(client, "save_settings", {
            ipcSessionId: await client.executeScript("return window.__ipcSessionId || null;"),
            settings: previousSettings,
          });
        } catch {
          // ignore
        }
      }
      await client.quit();
    }
    if (driver) {
      driver.kill();
    }
    restoreHookFile(hookSnapshot);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
