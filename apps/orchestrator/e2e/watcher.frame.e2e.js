const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");

process.env.NAGOMI_ENABLE_TEST_ENDPOINTS = process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

function appPath() {
  const base = path.join(__dirname, "..", "..", "..", "target", "debug", "nagomi-orchestrator");
  return process.platform === "win32" ? `${base}.exe` : base;
}

const PROTOTYPE_VRM_URL =
  "https://raw.githubusercontent.com/tegnike/nikechan-assets/main/vrms/nikechan_v2.vrm";

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStrictE2E() {
  return process.env.NAGOMI_E2E_STRICT === "1";
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

function isWindowsProcessRunning(imageName) {
  if (process.platform !== "win32") return false;
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`], {
    encoding: "utf8",
  });
  return result.stdout && result.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function resolveCommandPathWindows(command) {
  if (process.platform !== "win32") {
    return null;
  }
  const entries = (process.env.PATH || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
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
      if (exists(candidate)) return candidate;
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
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
    await sleep(150);
  }
  throw new Error("webdriver not responding");
}

async function waitFor(check, timeoutMs, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await check();
    if (ok) return true;
    await sleep(intervalMs);
  }
  return false;
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
      invoke(command, payload || {})
        .then((value) => done({ ok: value }))
        .catch((err) => done({ error: String(err) }));
    },
    command,
    payload || {}
  );
  if (result && result.error) {
    throw new Error(result.error);
  }
  return result ? result.ok : null;
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
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-orchestrator.exe")) {
    failOrSkip("nagomi-orchestrator already running");
    return;
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-worker.exe")) {
    failOrSkip("nagomi-worker already running");
    return;
  }
  let edgeBinary = null;
  if (process.platform === "win32") {
    edgeBinary = resolveCommandPathWindows("msedge");
    if (!edgeBinary) {
      failOrSkip("msedge not found on PATH (required for webview2 webdriver bootstrap)");
      return;
    }
  }

  const driverPort = 4461;
  const driver = spawn(tauriPath, ["--port", String(driverPort)], { stdio: "inherit" });
  let client;
  let edgeUserDataDir = null;
  let chatHandle = null;
  let ipcSessionId = "";
  let previousSettings = null;

  try {
    await waitForDriver(driverPort, 10000);
    const caps = new Capabilities();
    caps.set("browserName", "webview2");
    if (process.platform === "win32" && edgeBinary) {
      edgeUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nagomi-edge-e2e-"));
      caps.set("ms:edgeOptions", {
        binary: edgeBinary,
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
    const invokeReady = await waitFor(async () => {
      return await client.executeScript(
        "return Boolean(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);"
      );
    }, 10000);
    if (!invokeReady) throw new Error("invoke not ready");

    chatHandle = await client.getWindowHandle();
    ipcSessionId = (await client.executeScript("return window.__ipcSessionId || '';")) || "";
    if (!ipcSessionId) {
      const snapshot = await invokeTauri(client, "ipc_session_open", { clientEpoch: Date.now() });
      ipcSessionId = snapshot && snapshot.sessionId ? snapshot.sessionId : "";
      if (ipcSessionId) {
        await client.executeScript("window.__ipcSessionId = arguments[0];", ipcSessionId);
      }
    }
    if (!ipcSessionId) {
      throw new Error("ipc session id not ready");
    }

    previousSettings = await invokeTauri(client, "load_settings", { ipcSessionId });
    if (!previousSettings || typeof previousSettings !== "object") {
      throw new Error("settings not loaded");
    }
    const updatedSettings = {
      ...previousSettings,
      terminal_watcher_enabled: true,
      character_renderer: "3d",
      character_3d_vrm_path: PROTOTYPE_VRM_URL,
      character_3d_scale: 1.0,
      character_3d_yaw_deg: 0.0,
    };
    await invokeTauri(client, "save_settings", {
      ipcSessionId,
      settings: updatedSettings,
    });
    await client.executeScript(
      function (settings) {
        if (typeof applySettings === "function") {
          applySettings(settings);
        }
      },
      updatedSettings
    );

    let watcherHandle = null;
    const watcherFound = await waitFor(async () => {
      const handles = await client.getAllWindowHandles();
      for (const handle of handles) {
        await client.switchTo().window(handle);
        const view = await client.executeScript(
          "return new URLSearchParams(window.location.search || '').get('view') || '';"
        );
        if (view === "watcher") {
          watcherHandle = handle;
          return true;
        }
      }
      return false;
    }, 15000);
    if (!watcherFound || !watcherHandle) {
      throw new Error("watcher window not found");
    }

    await client.switchTo().window(watcherHandle);
    await client.wait(until.elementLocated(By.css("[data-role='terminal-watcher']")), 10000);
    const watcherVisible = await waitFor(async () => {
      return await client.executeScript(
        `
        const node = document.querySelector('[data-role="terminal-watcher"]');
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      `
      );
    }, 10000);
    if (!watcherVisible) {
      throw new Error("watcher element not visible");
    }

    const readyToClick = await waitFor(async () => {
      return await client.executeScript(
        `
        const node = document.querySelector('[data-role="terminal-watcher"]');
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return style.pointerEvents === 'auto';
      `
      );
    }, 10000);
    if (!readyToClick) {
      throw new Error("watcher pointer-events was not auto");
    }

    const watcher3dReady = await waitFor(async () => {
      return await client.executeScript(
        `
        const watcher = document.querySelector('[data-role="terminal-watcher"]');
        const canvas = document.querySelector('[data-role="terminal-watcher-3d"] canvas');
        if (!watcher) return false;
        return watcher.classList.contains('is-3d') && Boolean(canvas);
      `
      );
    }, 25000);
    if (!watcher3dReady) {
      const snapshot = await client.executeScript(
        `
        const watcher = document.querySelector('[data-role="terminal-watcher"]');
        const host = document.querySelector('[data-role="terminal-watcher-3d"]');
        const canvas = host ? host.querySelector('canvas') : null;
        return {
          is3d: Boolean(watcher && watcher.classList.contains('is-3d')),
          hasCanvas: Boolean(canvas),
          hostDisplay: host ? window.getComputedStyle(host).display : null,
        };
      `
      );
      failOrSkip(`watcher 3d did not become ready: ${JSON.stringify(snapshot)}`);
    } else {
      console.log("[e2e] watcher 3d ready");
    }

    const before = await client.executeScript(
      `
      const frame = document.querySelector('[data-role="character-debug-frame"]');
      return {
        selected: document.body.classList.contains('character-debug-selected'),
        frameHidden: frame ? frame.getAttribute('aria-hidden') : null,
      };
    `
    );
    const watcherElement = await client.findElement(By.css("[data-role='terminal-watcher']"));
    await watcherElement.click();

    const selected = await waitFor(async () => {
      return await client.executeScript(
        "return document.body.classList.contains('character-debug-selected');"
      );
    }, 4000);
    const after = await client.executeScript(
      `
      const frame = document.querySelector('[data-role="character-debug-frame"]');
      const frameStyle = frame ? window.getComputedStyle(frame) : null;
      return {
        selected: document.body.classList.contains('character-debug-selected'),
        frameHidden: frame ? frame.getAttribute('aria-hidden') : null,
        frameDisplay: frameStyle ? frameStyle.display : '',
        frameOpacity: frameStyle ? frameStyle.opacity : '',
      };
    `
    );

    if (!selected || !after.selected || after.frameHidden !== "false") {
      throw new Error(
        `watcher frame did not activate: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
    }

    console.log("[e2e] watcher frame click OK", { before, after });
  } finally {
    if (client && chatHandle && ipcSessionId && previousSettings) {
      try {
        await client.switchTo().window(chatHandle);
        await invokeTauri(client, "save_settings", {
          ipcSessionId,
          settings: previousSettings,
        });
      } catch {
        // best effort
      }
    }
    if (client) {
      try {
        await client.quit();
      } catch {
        // ignore
      }
    }
    if (driver && !driver.killed) {
      try {
        driver.kill();
      } catch {
        // ignore
      }
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

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
