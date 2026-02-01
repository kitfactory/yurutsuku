const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const { Builder, By, Capabilities, until } = require("selenium-webdriver");
const { ensureDriversOnPath } = require("./driver_paths");

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

  const driverPort = 4450;
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

    const result = await client.executeAsyncScript(function (done) {
      const invoke =
        (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
        (window.__TAURI__ && window.__TAURI__.invoke);
      if (!invoke) {
        done({ error: "invoke not available" });
        return;
      }

      const clientEpoch = Date.now();
      let opened;

      invoke("ipc_session_open", { clientEpoch })
        .then((snapshot) => {
          if (!snapshot || !snapshot.sessionId) {
            throw new Error("ipc_session_open returned no session");
          }
          opened = snapshot;
          return invoke("ipc_session_echo", {
            sessionId: opened.sessionId,
            message: "ping",
          });
        })
        .then((echo) => {
          if (!echo || echo.message !== "ping") {
            throw new Error("ipc_session_echo mismatch");
          }
          return invoke("ipc_session_probe", { sessionId: opened.sessionId });
        })
        .then((probe) => {
          if (!probe || probe.sessionId !== opened.sessionId) {
            throw new Error("ipc_session_probe mismatch");
          }
          return invoke("ipc_session_close", { sessionId: opened.sessionId });
        })
        .then(() =>
          invoke("ipc_session_probe", { sessionId: opened.sessionId })
            .then(() => done({ error: "probe should fail after close" }))
            .catch(() => done({ ok: true }))
        )
        .catch((err) => done({ error: String(err) }));
    });

    if (!result || result.error) {
      throw new Error(result && result.error ? result.error : "ipc session e2e failed");
    }
    console.log("[e2e] ipc session ok");
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
