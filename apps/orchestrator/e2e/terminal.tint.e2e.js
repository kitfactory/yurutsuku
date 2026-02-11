const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
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

function isStrictE2E() {
  return process.env.NAGOMI_E2E_STRICT === "1";
}

function resolveCommandPathWindows(command) {
  if (process.platform !== "win32") {
    return null;
  }
  const entries = (process.env.PATH || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }
  const hasExt = path.extname(command).length > 0;
  const exts = hasExt
    ? [""]
    : (process.env.PATHEXT || ".exe;.cmd;.bat")
        .split(";")
        .map((value) => value.trim())
        .filter(Boolean);
  for (const dir of entries) {
    if (hasExt) {
      const candidate = path.join(dir, command);
      if (exists(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function readVersionText(commandPath) {
  if (!commandPath) {
    return "";
  }
  const result = spawnSync(commandPath, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    return "";
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function majorVersion(text) {
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+)\./);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function knownInfraError(error) {
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return (
    message.includes("devtoolsactiveport") ||
    message.includes("session not created") ||
    message.includes("webdriver not responding")
  );
}

function skipMessage(message) {
  console.log(`[e2e] skipped: ${message}`);
}

function failOrSkip(message) {
  if (isStrictE2E()) {
    throw new Error(message);
  }
  skipMessage(message);
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

async function waitForNeutralState(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastClasses = [];
  let lastObserved = null;
  while (Date.now() < deadline) {
    lastClasses = await getShellClasses(client);
    lastObserved = await client
      .executeScript(
        "return window.nagomiTest && window.nagomiTest.getObservedState ? window.nagomiTest.getObservedState() : null;"
      )
      .catch(() => null);
    if (
      !lastClasses.includes("state-running") &&
      !lastClasses.includes("state-need-input") &&
      !lastClasses.includes("state-fail")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timeout waiting for neutral state classes=${JSON.stringify(lastClasses)} observed=${JSON.stringify(lastObserved)}`
  );
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

async function getStateTransitionDebug(client) {
  return await client
    .executeScript(
      `
      const api = window.nagomiTest || null;
      const internal = api && api.getInternalState ? api.getInternalState() : null;
      const observed = api && api.getObservedState ? api.getObservedState() : null;
      const badge = document.querySelector('[data-role="terminal-debug-badge"]');
      const transitionsFromInternal = internal && Array.isArray(internal.stateTransitions) ? internal.stateTransitions : [];
      const transitionsFromObserved = observed && Array.isArray(observed.transitions) ? observed.transitions : [];
      const transitions = transitionsFromInternal.length > 0 ? transitionsFromInternal : transitionsFromObserved;
      return {
        transitions,
        internal,
        observed,
        badge: badge ? badge.textContent : '',
      };
      `
    )
    .catch(() => ({ transitions: [], internal: null, observed: null, badge: "" }));
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
    failOrSkip(`app binary not found: ${targetApp}`);
    return;
  }
  const { tauriPath, edgePath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    failOrSkip("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
    return;
  }
  if (process.platform === "win32" && !edgePath) {
    failOrSkip("msedgedriver not found (set NAGOMI_EDGE_DRIVER or update PATH)");
    return;
  }
  let edgeBrowserPath = null;
  if (process.platform === "win32") {
    edgeBrowserPath = resolveCommandPathWindows("msedge");
    if (!edgeBrowserPath) {
      failOrSkip("msedge not found on PATH (required for webview2 webdriver bootstrap)");
      return;
    }
    const edgeVersion = majorVersion(readVersionText(edgeBrowserPath));
    const driverVersion = majorVersion(readVersionText(edgePath));
    if (edgeVersion && driverVersion && edgeVersion !== driverVersion) {
      failOrSkip(`version mismatch: msedge=${edgeVersion}, msedgedriver=${driverVersion}`);
      return;
    }
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-orchestrator.exe")) {
    failOrSkip("nagomi-orchestrator already running");
    return;
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-worker.exe")) {
    failOrSkip("nagomi-worker already running");
    return;
  }

  const driverPort = 4453;
  const driver = spawn(tauriPath, ["--port", String(driverPort)], { stdio: "inherit" });
  let client;
  let previousSettings;
  let edgeUserDataDir = null;
  try {
    try {
    await waitForDriver(driverPort, 10000);
    const caps = new Capabilities();
    caps.set("browserName", "webview2");
    if (process.platform === "win32" && edgeBrowserPath) {
      edgeUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nagomi-edge-e2e-"));
      caps.set("ms:edgeOptions", {
        binary: edgeBrowserPath,
        args: [
          `--user-data-dir=${edgeUserDataDir}`,
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
    }
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

    let ipcSessionId = null;
    await waitFor(async () => {
      ipcSessionId = await client.executeScript("return window.__ipcSessionId || null;");
      return Boolean(ipcSessionId);
    }, 10000).catch(() => false);
    if (!ipcSessionId) {
      const ipcSnapshot = await invokeTauri(client, "ipc_session_open", {
        clientEpoch: Date.now(),
      });
      ipcSessionId = ipcSnapshot && ipcSnapshot.sessionId ? ipcSnapshot.sessionId : null;
      if (ipcSessionId) {
        await client.executeScript("window.__ipcSessionId = arguments[0];", ipcSessionId);
      }
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
      silence_timeout_ms: 30000,
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

    await waitForNeutralState(client, 7000);

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
    await waitForNeutralState(client, 7000);

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

    const transitionDebug = await getStateTransitionDebug(client);
    const transitions = transitionDebug && Array.isArray(transitionDebug.transitions)
      ? transitionDebug.transitions
      : [];
    if (!Array.isArray(transitions) || transitions.length === 0) {
      throw new Error(
        `state transition history is empty badge=${transitionDebug.badge} internal=${JSON.stringify(transitionDebug.internal)} observed=${JSON.stringify(transitionDebug.observed)}`
      );
    }
    const needInputTransitions = transitions.filter((entry) => entry && entry.to === "need-input");
    if (needInputTransitions.length === 0) {
      throw new Error(`need-input transition not recorded: ${JSON.stringify(transitions)}`);
    }
    const illegalNeedInput = needInputTransitions.find(
      (entry) =>
        entry &&
        entry.from !== "running" &&
        entry.from !== "need-input"
    );
    if (illegalNeedInput) {
      throw new Error(`illegal need-input transition: ${JSON.stringify(illegalNeedInput)}`);
    }

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

    await waitForNeutralState(client, 7000);

    console.log("[e2e] terminal tint states verified");
    } catch (error) {
      if (!isStrictE2E() && knownInfraError(error)) {
        skipMessage(String(error && error.message ? error.message : error));
        return;
      }
      throw error;
    }
  } finally {
    if (client) {
      if (previousSettings) {
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
    if (edgeUserDataDir) {
      try {
        fs.rmSync(edgeUserDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
