const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { Builder, Capabilities, until, By } = require("selenium-webdriver");
const { ensureDriversOnPath, resolveTauriDriverPath } = require("./driver_paths");

const repoRoot = path.join(__dirname, "..", "..", "..");
process.env.NAGOMI_ENABLE_TEST_ENDPOINTS =
  process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

function appPath() {
  const base = path.join(repoRoot, "target", "debug", "nagomi-orchestrator");
  return process.platform === "win32" ? `${base}.exe` : base;
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

function settingsJsonPath() {
  const base = process.env.APPDATA || "";
  return path.join(base, "com.kitfactory.nagomi", "settings.json");
}

function readUtf8(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

async function openSettingsView(client) {
  await client.executeScript(`window.location.search = 'view=settings';`);
  await client.wait(
    until.elementLocated(By.css("[data-role='settings-status-debug-toggle']")),
    30000
  );
}

async function waitForSettingsRuntimeReady(client) {
  for (let i = 0; i < 80; i += 1) {
    const snap = await client.executeScript(`
      try {
        return {
          ipcSessionId: window.__ipcSessionId || null,
          hasSave: typeof saveSettingsToBackend === 'function',
          hasSettingsState: typeof settingsState !== 'undefined' && settingsState ? true : false
        };
      } catch (e) {
        return { error: String(e) };
      }
    `);
    if (
      snap &&
      typeof snap.ipcSessionId === "string" &&
      snap.ipcSessionId.length > 0 &&
      snap.hasSave &&
      snap.hasSettingsState
    ) {
      return;
    }
    await sleep(200);
  }
  throw new Error("settings runtime not ready (ipc/save/settingsState)");
}

async function readStatusDebugEnabled(client) {
  return await client.executeScript(`
    try {
      return (typeof settingsState !== 'undefined' && settingsState)
        ? Boolean(settingsState.status_debug_enabled)
        : null;
    } catch (e) {
      return null;
    }
  `);
}

async function toggleStatusDebugEnabled(client) {
  const toggle = await client.findElement(By.css("[data-role='settings-status-debug-toggle']"));
  await toggle.click();
}

async function buildClient(driverPort, targetApp) {
  const caps = new Capabilities();
  caps.set("browserName", "webview2");
  caps.set("tauri:options", {
    application: targetApp,
    args: [],
  });
  const client = await new Builder()
    .usingServer(`http://127.0.0.1:${driverPort}`)
    .forBrowser("webview2")
    .withCapabilities(caps)
    .build();
  await client.manage().setTimeouts({ script: 20000, implicit: 0, pageLoad: 30000 });
  return client;
}

async function main() {
  const targetApp = appPath();
  if (!fs.existsSync(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }

  // Avoid colliding with a background orchestrator on default port.
  if (!process.env.NAGOMI_ORCH_HEALTH_PORT) {
    const port = await pickFreePort();
    process.env.NAGOMI_ORCH_HEALTH_PORT = String(port);
  }

  const { tauriPath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    throw new Error("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
  }

  const driverPort = 4446;
  const driver = spawn(tauriPath || resolveTauriDriverPath(), ["--port", String(driverPort)], {
    stdio: "inherit",
  });

  const settingsPath = settingsJsonPath();
  const originalSettings = readUtf8(settingsPath);

  let client1 = null;
  let client2 = null;
  try {
    await waitForDriver(driverPort, 10000);

    client1 = await buildClient(driverPort, targetApp);
    await client1.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);
    await openSettingsView(client1);
    await waitForSettingsRuntimeReady(client1);

    const before = await readStatusDebugEnabled(client1);
    if (before !== false) {
      // Make this test stable: force it OFF first.
      await toggleStatusDebugEnabled(client1);
      await sleep(200);
    }
    await toggleStatusDebugEnabled(client1);
    const afterClick = await readStatusDebugEnabled(client1);
    if (afterClick !== true) {
      throw new Error(`toggle click did not enable status_debug: afterClick=${afterClick}`);
    }
    // Give the app a moment to persist the setting (user typically closes after this).
    let wroteFile = false;
    for (let i = 0; i < 20; i += 1) {
      const raw = readUtf8(settingsPath);
      if (raw.includes('"status_debug_enabled": true')) {
        wroteFile = true;
        break;
      }
      await sleep(100);
    }
    if (!wroteFile) {
      const diag = await client1.executeScript(`
        try {
          const saveSource = (() => {
            try {
              return typeof saveSettingsToBackend === 'function' ? String(saveSettingsToBackend) : '';
            } catch {
              return '';
            }
          })();
          return {
            attempts: typeof window.__settingsSaveAttempts === 'number' ? window.__settingsSaveAttempts : null,
            lastAt: typeof window.__settingsSaveLastAt === 'number' ? window.__settingsSaveLastAt : null,
            lastOkAt: typeof window.__settingsSaveLastOkAt === 'number' ? window.__settingsSaveLastOkAt : null,
            lastError: typeof window.__settingsSaveLastError === 'string' ? window.__settingsSaveLastError : null,
            ipcSessionId: window.__ipcSessionId || null,
            hasInvoke: Boolean(
              window.__TAURI__ &&
                ((window.__TAURI__.core && window.__TAURI__.core.invoke) || window.__TAURI__.invoke)
            ),
            hasSave: typeof saveSettingsToBackend === 'function',
            saveHasTelemetry: saveSource.includes('__settingsSaveAttempts'),
          };
        } catch (e) {
          return { error: String(e) };
        }
      `);
      throw new Error(
        `settings.json not updated before exit: ${settingsPath} diag=${JSON.stringify(diag)}`
      );
    }

    // Simulate user: close settings, quit app immediately after toggling.
    await client1.quit();
    client1 = null;

    client2 = await buildClient(driverPort, targetApp);
    await client2.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);
    await openSettingsView(client2);

    const after = await readStatusDebugEnabled(client2);
    if (after !== true) {
      throw new Error(`status_debug_enabled not persisted across restart: after=${after}`);
    }

    // Allow the pending flush to persist to settings.json.
    for (let i = 0; i < 20; i += 1) {
      const raw = readUtf8(settingsPath);
      if (raw.includes('"status_debug_enabled": true')) break;
      await sleep(200);
    }
    const finalRaw = readUtf8(settingsPath);
    if (!finalRaw.includes('"status_debug_enabled": true')) {
      throw new Error(`settings.json not updated: ${settingsPath}`);
    }
  } finally {
    if (client1) await client1.quit();
    if (client2) await client2.quit();
    driver.kill();

    // Restore user's original settings.json (best-effort).
    try {
      if (originalSettings) {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, originalSettings, "utf8");
      }
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
