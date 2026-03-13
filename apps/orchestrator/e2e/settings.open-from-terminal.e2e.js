const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const { Builder, Capabilities, until, By } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

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
  if (process.platform !== "win32") return false;
  const result = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`], {
    encoding: "utf8",
  });
  return result.stdout && result.stdout.toLowerCase().includes(imageName.toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke
          ? window.__TAURI__.core.invoke
          : window.__TAURI__ && window.__TAURI__.invoke
          ? window.__TAURI__.invoke
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
  if (process.platform === "win32" && isWindowsProcessRunning("msedgedriver.exe")) {
    throw new Error("msedgedriver already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("nagomi-orchestrator.exe")) {
    throw new Error("nagomi-orchestrator already running");
  }

  const driverPort = 4453;
  const driver = spawn(tauriPath, ["--port", String(driverPort)], { stdio: "inherit" });

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

    const terminalWindow = await openAndSwitchToTerminalWindow(
      client,
      `e2e-settings-open-${Date.now()}`,
      20000
    );
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);

    const ipcSessionId = await client.executeScript("return window.__ipcSessionId || null;");
    if (!ipcSessionId) {
      throw new Error("terminal ipc session not ready");
    }

    const startedAt = Date.now();
    await invokeTauri(client, "open_settings_window", { ipcSessionId });
    const invokeElapsedMs = Date.now() - startedAt;
    if (invokeElapsedMs > 3000) {
      throw new Error(`open_settings_window was too slow: ${invokeElapsedMs}ms`);
    }

    const deadline = Date.now() + 15000;
    let settingsWindow = null;
    let lastWindows = [];
    while (Date.now() < deadline) {
      const handles = await client.getAllWindowHandles();
      lastWindows = [];
      for (const handle of handles) {
        await client.switchTo().window(handle);
        const info = await client.executeScript(`
          const params = new URLSearchParams(window.location.search || '');
          return {
            href: window.location.href || '',
            ready: document.readyState || '',
            title: document.title || '',
            view: params.get('view') || '',
            hasSettingsToggle: Boolean(document.querySelector('[data-role="settings-status-debug-toggle"]')),
            bodyText: document.body && document.body.innerText ? document.body.innerText.slice(0, 160) : '',
          };
        `);
        lastWindows.push({ handle, ...info });
        if (info.view === "settings" && info.hasSettingsToggle) {
          settingsWindow = { handle, ...info };
          break;
        }
      }
      if (settingsWindow) break;
      await sleep(250);
    }

    if (!settingsWindow) {
      throw new Error(`settings window not ready: ${JSON.stringify(lastWindows)}`);
    }

    await client.switchTo().window(terminalWindow.handle);
    await client.close();
    await sleep(1200);
    const remainingHandles = await client.getAllWindowHandles();
    if (remainingHandles.includes(terminalWindow.handle)) {
      throw new Error(`terminal window still present after close: ${terminalWindow.handle}`);
    }

    console.log("[e2e] terminal -> settings window OK", {
      terminalWindow,
      settingsWindow,
      invokeElapsedMs,
      remainingHandles,
    });
  } finally {
    if (client) await client.quit();
    driver.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
