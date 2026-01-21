const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");

const repoRoot = path.join(__dirname, "..", "..", "..");

function appPath() {
  const base = path.join(repoRoot, "target", "debug", "yurutsuku-orchestrator");
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

function resolveMsEdgeDriverPath() {
  if (process.platform !== "win32") {
    return null;
  }
  const result = spawnSync("where", ["msedgedriver"], { encoding: "utf8" });
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
  const result = spawnSync("where", ["tauri-driver"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const line = (result.stdout || "").trim().split(/\r?\n/)[0];
  return line || null;
}

function workerLogTail(lineCount = 40) {
  if (process.platform !== "win32") {
    return "";
  }
  const appData = process.env.APPDATA || "";
  if (!appData) {
    return "";
  }
  const logPath = path.join(appData, "com.kitfactory.yurutsuku", "worker_smoke.log");
  try {
    const contents = fs.readFileSync(logPath, "utf8");
    const lines = contents.trimEnd().split(/\r?\n/);
    return lines.slice(-lineCount).join("\n");
  } catch {
    return "";
  }
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fn();
    if (ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("webdriver not responding");
}

async function main() {
  const targetApp = appPath();
  if (!exists(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }

  const tauriDriverPath = resolveTauriDriverPath();
  if (process.platform === "win32" && !tauriDriverPath) {
    throw new Error("tauri-driver not found in PATH");
  }
  const msedgedriverPath = resolveMsEdgeDriverPath();
  if (process.platform === "win32" && !msedgedriverPath) {
    throw new Error("msedgedriver not found in PATH");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("msedgedriver.exe")) {
    throw new Error("msedgedriver already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-orchestrator.exe")) {
    throw new Error("yurutsuku-orchestrator already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-worker.exe")) {
    throw new Error("yurutsuku-worker already running");
  }

  const driverPort = 4444;
  const driver = spawn(tauriDriverPath, ["--port", "4444"], { stdio: "inherit" });

  let client;
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

    const hasInvoke = await client.executeScript(
      "return Boolean(window.__TAURI__ && (window.__TAURI__.core || window.__TAURI__.invoke));"
    );
    if (!hasInvoke) {
      throw new Error("invoke not available");
    }
    const ipcSessionId = await waitFor(async () => {
      const sessionId = await client.executeScript("return window.__ipcSessionId || null;");
      return sessionId || null;
    }, 10000).then(async () => {
      return await client.executeScript("return window.__ipcSessionId || null;");
    });
    if (!ipcSessionId) {
      throw new Error("ipc session id not ready");
    }
    await client.executeScript("window.__e2eInvokeErrors = [];");
    const chatLocation = await client.executeScript("return window.location.href;");
    console.log("[e2e] chat window", { hasInvoke, chatLocation, ipcSessionId });
    await client.executeScript("applyView('terminal');");
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);
    const hasTerminalLib = await client.executeScript("return Boolean(window.Terminal);");
    if (!hasTerminalLib) {
      const location = await client.executeScript("return window.location.href;");
      throw new Error(`terminal library missing at ${location}`);
    }
    await client.executeScript("window.__e2eInvokeErrors = [];");
    const terminalLocation = await client.executeScript("return window.location.href;");
    const terminalInvoke = await client.executeScript(
      "return Boolean(window.__TAURI__ && (window.__TAURI__.core || window.__TAURI__.invoke));"
    );
    console.log("[e2e] terminal window", { terminalLocation, terminalInvoke });
    const eventProbe = await client.executeAsyncScript(function (done) {
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
        window.__e2eTerminalEvents.push({
          type: "output",
          payload: event && event.payload,
        });
      });
      listen("terminal-output-broadcast", (event) => {
        window.__e2eTerminalEvents.push({
          type: "output-broadcast",
          payload: event && event.payload,
        });
      });
      listen("terminal-exit", (event) => {
        window.__e2eTerminalEvents.push({
          type: "exit",
          payload: event && event.payload,
        });
      });
      listen("terminal-error", (event) => {
        window.__e2eTerminalEvents.push({
          type: "error",
          payload: event && event.payload,
        });
      });
      done({ ok: true });
    });
    if (eventProbe && eventProbe.error) {
      console.log("[e2e] event listen unavailable", eventProbe.error);
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
    await client.executeScript("window.__e2eSessionId = arguments[0];", sessionId);
    const registerResult = await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        invoke("register_terminal_session", { ipcSessionId, sessionId: id })
          .then(() => done({ ok: true }))
          .catch((err) => done({ error: String(err) }));
      },
      ipcSessionId,
      sessionId
    );
    if (registerResult && registerResult.error) {
      throw new Error(registerResult.error);
    }
    const debugEmitResult = await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        invoke("debug_emit_terminal_broadcast", { ipcSessionId, sessionId: id })
          .then(() => done({ ok: true }))
          .catch((err) => done({ error: String(err) }));
      },
      ipcSessionId,
      sessionId
    );
    if (debugEmitResult && debugEmitResult.error) {
      throw new Error(debugEmitResult.error);
    }
    try {
      await waitFor(async () => {
        const events = await client.executeScript("return window.__e2eTerminalEvents || [];");
        const activeSessionId = await client.executeScript(
          "return window.__e2eSessionId || null;"
        );
        return events.some(
          (entry) =>
            entry &&
            entry.type === "output-broadcast" &&
            entry.payload &&
            entry.payload.session_id === activeSessionId &&
            String(entry.payload.chunk || "").includes("[debug emit]")
        );
      }, 10000);
    } catch {
      let terminalEvents = [];
      try {
        terminalEvents = await client.executeScript("return window.__e2eTerminalEvents || [];");
      } catch {
        terminalEvents = [];
      }
      throw new Error(
        `debug broadcast not observed: ${JSON.stringify(terminalEvents).slice(0, 2000)}`
      );
    }
    const startResult = await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        let attempts = 0;
        const tryStart = () => {
          invoke("start_terminal_session", { ipcSessionId, sessionId: id, cols: 120, rows: 30 })
            .then(() => done({ ok: true }))
            .catch((err) => {
              attempts += 1;
              if (attempts > 20) {
                done({ error: String(err) });
                return;
              }
              setTimeout(tryStart, 300);
            });
        };
        tryStart();
      },
      ipcSessionId,
      sessionId
    );
    if (startResult && startResult.error) {
      throw new Error(startResult.error);
    }
    console.log("[e2e] start_terminal_session invoked");
    await client.executeScript(
      "const el = document.querySelector('#terminal-container'); if (el) el.click();"
    );

    try {
      await waitFor(async () => {
        const hasXterm = await client
          .executeScript("return Boolean(document.querySelector('.xterm-rows'));")
          .catch(() => false);
        return Boolean(hasXterm);
      }, 20000);
    } catch (err) {
      const diag = await client.executeScript(`
        return {
          hasContainer: Boolean(document.querySelector('#terminal-container')),
          hasXterm: Boolean(document.querySelector('.xterm')),
          hasRows: Boolean(document.querySelector('.xterm-rows')),
          terminalInitialized: typeof terminalInitialized !== 'undefined' ? terminalInitialized : null
        };
      `);
      throw new Error(`xterm not ready: ${JSON.stringify(diag)}`);
    }

    const inputResult = await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        let attempts = 0;
        const trySend = () => {
          invoke("terminal_send_input", { ipcSessionId, sessionId: id, text: "echo e2e\\r\\n" })
            .then(() => done({ ok: true }))
            .catch((err) => {
              attempts += 1;
              if (attempts > 20) {
                done({ error: String(err) });
                return;
              }
              setTimeout(trySend, 300);
            });
        };
        trySend();
      },
      ipcSessionId,
      sessionId
    );
    if (inputResult && inputResult.error) {
      throw new Error(inputResult.error);
    }

    try {
      await waitFor(async () => {
        const events = await client.executeScript("return window.__e2eTerminalEvents || [];");
        const activeSessionId = await client.executeScript(
          "return window.__e2eSessionId || null;"
        );
        return events.some(
          (entry) =>
            entry &&
            entry.type === "output" &&
            entry.payload &&
            entry.payload.session_id === activeSessionId &&
            String(entry.payload.chunk || "").toLowerCase().includes("e2e")
        );
      }, 20000);
    } catch {
      let snapshot = "";
      try {
        const rows = await client.findElement(By.css(".xterm-rows"));
        snapshot = (await rows.getText()).slice(0, 400);
      } catch {
        snapshot = "";
      }
      let chatErrors = [];
      try {
        chatErrors = await client.executeScript("return window.__e2eInvokeErrors || [];");
      } catch {
        chatErrors = [];
      }
      let terminalEvents = [];
      try {
        terminalEvents = await client.executeScript("return window.__e2eTerminalEvents || [];");
      } catch {
        terminalEvents = [];
      }
      const logTail = workerLogTail();
      const logNote = logTail ? `\nworker_smoke.log:\n${logTail}` : "";
      const invokeNote = `\ninvokeErrors chat=${JSON.stringify(chatErrors)}`;
      const eventsNote = `\nterminalEvents=${JSON.stringify(terminalEvents).slice(0, 2000)}`;
      throw new Error(
        `terminal output not observed: ${JSON.stringify(snapshot)}${invokeNote}${eventsNote}${logNote}`
      );
    }
  } finally {
    if (client) {
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
