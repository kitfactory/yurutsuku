const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");

const repoRoot = path.join(__dirname, "..", "..", "..");
process.env.NAGOMI_ENABLE_TEST_ENDPOINTS =
  process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

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

async function invokeTauri(client, command, payload) {
  const result = await client.executeAsyncScript(
    function (command, payload, done) {
      const invoke =
        window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke
          ? window.__TAURI__.core.invoke
          : null;
      if (!invoke) {
        done({ error: "invoke not available" });
        return;
      }
      invoke(command, payload)
        .then((value) => done({ ok: value }))
        .catch((err) => done({ error: String(err) }));
    },
    command,
    payload
  );
  if (result && result.error) {
    throw new Error(result.error);
  }
  return result ? result.ok : null;
}

async function getShellClasses(client) {
  return await client.executeScript(
    "const shell = document.querySelector('.terminal-shell'); return shell ? Array.from(shell.classList) : [];"
  );
}

async function sendInput(client, text) {
  return await client.executeScript(
    function (payload) {
      if (typeof sendTerminalInput === "function") {
        sendTerminalInput(payload);
        return true;
      }
      if (window.nagomiTest && window.nagomiTest.sendTerminalInput) {
        return window.nagomiTest.sendTerminalInput(payload);
      }
      return false;
    },
    text
  );
}

async function main() {
  const targetApp = appPath();
  if (!exists(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }
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

  const driverPort = 4453;
  const driver = spawn(tauriPath, ["--port", String(driverPort)], { stdio: "inherit" });
  let client;
  let previousSettings;
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
      .withCapabilities(caps)
      .build();

    await client.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);

    await waitFor(async () => {
      const hasInvoke = await client.executeScript(
        "return Boolean(window.__TAURI__ && ((window.__TAURI__.core && window.__TAURI__.core.invoke) || window.__TAURI__.invoke));"
      );
      return Boolean(hasInvoke);
    }, 10000);

    const ipcSnapshot = await invokeTauri(client, "ipc_session_open", { clientEpoch: Date.now() });
    const ipcSessionId =
      ipcSnapshot && ipcSnapshot.sessionId ? ipcSnapshot.sessionId : null;
    if (ipcSessionId) {
      await client.executeScript("window.__ipcSessionId = arguments[0];", ipcSessionId);
    }
    if (!ipcSessionId) {
      throw new Error("ipc session id not ready");
    }

    previousSettings = await invokeTauri(client, "load_settings", { ipcSessionId });
    if (!previousSettings) {
      throw new Error("settings not loaded");
    }
    const updatedSettings = {
      ...previousSettings,
      llm_enabled: false,
      llm_tool: "codex",
      silence_timeout_ms: 1000,
    };
    await invokeTauri(client, "save_settings", { ipcSessionId, settings: updatedSettings });
    await client.executeScript(
      function (settings) {
        if (typeof applySettings === "function") {
          applySettings(settings);
        }
      },
      updatedSettings
    );

    await client.executeScript("applyView('terminal');");
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);
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
    await invokeTauri(client, "start_terminal_session", {
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
    }, 15000);

    await waitFor(async () => {
      const classes = await getShellClasses(client);
      return (
        !classes.includes("state-running") &&
        !classes.includes("state-need-input") &&
        !classes.includes("state-fail")
      );
    }, 3000);

    await client.executeScript(
      function (settings) {
        if (typeof applySettings === "function") {
          applySettings(settings);
        } else if (typeof settingsState !== "undefined") {
          settingsState = { ...settingsState, ...settings };
        }
      },
      updatedSettings
    );
    // codex 起動直後は idle のまま / Keep idle right after `codex`.
    await sendInput(client, "codex\r");
    await waitFor(async () => {
      const classes = await getShellClasses(client);
      return (
        !classes.includes("state-running") &&
        !classes.includes("state-need-input") &&
        !classes.includes("state-fail")
      );
    }, 3000);

    // codex にプロンプト入力で running / Enter prompt input to start running.
    await sendInput(client, "ping\r");
    await waitFor(async () => {
      const classes = await getShellClasses(client);
      return classes.includes("state-running");
    }, 3000);

    await client.executeScript(
      function (payload) {
        return window.nagomiTest && window.nagomiTest.emitHookState
          ? window.nagomiTest.emitHookState(payload)
          : false;
      },
      {
        source: "codex",
        kind: "need_input",
        judge_state: "need_input",
        source_session_id: sessionId,
      }
    );

    await waitFor(async () => {
      const classes = await getShellClasses(client);
      return classes.includes("state-need-input");
    }, 3000);

    await client.executeScript(
      function (payload) {
        return window.nagomiTest && window.nagomiTest.emitHookState
          ? window.nagomiTest.emitHookState(payload)
          : false;
      },
      {
        source: "codex",
        kind: "completed",
        judge_state: "success",
        source_session_id: sessionId,
      }
    );

    await waitFor(async () => {
      const classes = await getShellClasses(client);
      return (
        !classes.includes("state-running") &&
        !classes.includes("state-need-input") &&
        !classes.includes("state-fail")
      );
    }, 3000);

    console.log("[e2e] terminal tint states verified");
  } finally {
    if (client) {
      if (previousSettings) {
        try {
          await invokeTauri(client, "save_settings", { ipcSessionId: await client.executeScript("return window.__ipcSessionId || null;"), settings: previousSettings });
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
