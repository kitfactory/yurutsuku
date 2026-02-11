const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
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

    await client.manage().setTimeouts({ script: 40000, implicit: 0, pageLoad: 30000 });
    await client.wait(until.elementLocated(By.css("[data-role='chat-main']")), 30000);

    const terminalWindow = await openAndSwitchToTerminalWindow(
      client,
      `e2e-smoke-${Date.now()}`
    );
    console.log("[e2e] terminal window", terminalWindow);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);

    const ready = await client.executeAsyncScript(function (done) {
      const listen =
        window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen
          ? window.__TAURI__.event.listen
          : null;
      if (!listen) {
        done({ error: "event.listen not available" });
        return;
      }
      if (!window.nagomiTest || !window.nagomiTest.getTerminalSessionId) {
        done({ error: "nagomiTest hook not available" });
        return;
      }
      const sessionId = window.nagomiTest.getTerminalSessionId();
      window.__e2eTerminalEvents = [];
      listen("terminal-output", (event) => {
        if (event && event.payload && event.payload.session_id === sessionId) {
          window.__e2eTerminalEvents.push(event.payload.chunk || "");
        }
      });
      done({ ok: true });
    });

    if (!ready || ready.error) {
      throw new Error(ready && ready.error ? ready.error : "terminal listener setup failed");
    }

    await client.executeScript(
      "return window.nagomiTest.sendTerminalInput(arguments[0]);",
      process.platform === "win32" ? "echo ok\r\n" : "echo ok\n"
    );

    const outputOk = await client.executeAsyncScript(function (done) {
      const deadline = Date.now() + 15000;
      const tick = () => {
        const chunks = window.__e2eTerminalEvents || [];
        const joined = chunks.join("");
        if (joined.toLowerCase().includes("ok")) {
          done({ ok: true });
          return;
        }
        if (Date.now() > deadline) {
          done({ error: "timeout waiting for output" });
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });

    if (!outputOk || outputOk.error) {
      throw new Error(outputOk && outputOk.error ? outputOk.error : "terminal output missing");
    }
    console.log("[e2e] terminal output ok");
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
