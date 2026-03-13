const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

function appPath() {
  const base = path.join(__dirname, "..", "..", "..", "target", "debug", "nagomi-orchestrator");
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
    await sleep(150);
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

async function findSettingsHandle(client, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handles = await client.getAllWindowHandles();
    for (const handle of handles) {
      await client.switchTo().window(handle);
      const view = await client.executeScript(
        "return new URLSearchParams(window.location.search || '').get('view') || '';"
      );
      if (view === "settings") return handle;
    }
    await sleep(200);
  }
  throw new Error("settings window not found");
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

  const driverPort = 4463;
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
      `e2e-character-toggle-${Date.now()}`,
      20000
    );
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);

    const ipcSessionId = await client.executeScript("return window.__ipcSessionId || null;");
    if (!ipcSessionId) throw new Error("terminal ipc session not ready");

    await invokeTauri(client, "open_settings_window", { ipcSessionId });
    const settingsHandle = await findSettingsHandle(client);
    await client.switchTo().window(settingsHandle);
    await client.wait(until.elementLocated(By.css("[data-role='settings-character-watcher']")), 10000);

    for (let i = 0; i < 4; i += 1) {
      await (await client.findElement(By.css("[data-role='settings-character-watcher']"))).click();
      await sleep(500);
      const ui = await client.executeScript(`
        return {
          watcherEnabled: typeof terminalWatcherEnabled !== 'undefined' ? terminalWatcherEnabled : null,
          watcherStateLabel:
            document.querySelector('[data-role="settings-character-watcher-state"]')?.textContent || '',
        };
      `);

      await client.switchTo().window(terminalWindow.handle);
      const terminalProbe = await client.executeScript(`
        return {
          href: window.location.href || '',
          ready: document.readyState || '',
          hasTerminal: Boolean(document.querySelector('#terminal-container')),
          hasTextarea: Boolean(document.querySelector('.xterm-helper-textarea')),
          termOnly: Boolean(document.body && document.body.classList.contains('terminal-only')),
        };
      `);
      await client.executeScript("return 1 + 1;");
      await client.switchTo().window(settingsHandle);

      if (!terminalProbe.hasTerminal || !terminalProbe.hasTextarea || !terminalProbe.termOnly) {
        throw new Error(`terminal probe failed after toggle ${i}: ${JSON.stringify({ terminalProbe, ui })}`);
      }
    }

    await client.switchTo().window(terminalWindow.handle);
    await client.close();
    await sleep(1000);
    const remainingHandles = await client.getAllWindowHandles();
    if (remainingHandles.includes(terminalWindow.handle)) {
      throw new Error(`terminal window still present after close: ${terminalWindow.handle}`);
    }

    console.log("[e2e] character watcher toggle keeps terminal responsive", {
      terminalWindow,
      settingsHandle,
      remainingHandles,
    });
  } finally {
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
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
