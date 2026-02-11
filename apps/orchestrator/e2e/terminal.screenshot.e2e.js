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

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fn();
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timeout waiting for condition");
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

  const driverPort = 4452;
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
      `e2e-screen-${Date.now()}`
    );
    console.log("[e2e] terminal window", terminalWindow);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 10000);
    await waitFor(async () => {
      const initialized = await client.executeScript(
        "return typeof terminalInitialized !== 'undefined' && terminalInitialized === true;"
      );
      return Boolean(initialized);
    }, 10000);
    await waitFor(async () => {
      const ready = await client.executeScript(
        "return typeof terminal !== 'undefined' && terminal && terminal.cols > 0 && terminal.rows > 0;"
      );
      return Boolean(ready);
    }, 10000);

    const startupProbe = await client.executeAsyncScript(function (timeoutMs, done) {
      const deadline = Date.now() + timeoutMs;
      const normalize = (value) =>
        String(value || "")
          .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const snapshot = () => {
        try {
          if (
            typeof terminal === "undefined" ||
            !terminal ||
            !terminal.buffer ||
            !terminal.buffer.active
          ) {
            return { clean: "", raw: "" };
          }
          const buf = terminal.buffer.active;
          const end = Math.max(0, Number(buf.baseY || 0) + Number(buf.cursorY || 0));
          const start = Math.max(0, end - 80);
          const lines = [];
          for (let i = start; i <= end; i += 1) {
            const line = buf.getLine(i);
            if (!line) continue;
            lines.push(line.translateToString(true));
          }
          const raw = lines.join("\n");
          return { clean: normalize(raw), raw };
        } catch {
          return { clean: "", raw: "" };
        }
      };
      const tick = () => {
        const current = snapshot();
        if (/[A-Za-z0-9]/.test(current.clean)) {
          done({ ok: true, snapshot: current.clean.slice(-220) });
          return;
        }
        if (Date.now() >= deadline) {
          done({
            error: "startup terminal text not visible",
            snapshot: current.clean.slice(-220),
          });
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    }, 12000);
    if (!startupProbe || startupProbe.error) {
      throw new Error(
        `startup text probe failed: ${
          startupProbe && startupProbe.error ? startupProbe.error : "unknown"
        } snapshot=${startupProbe && startupProbe.snapshot ? startupProbe.snapshot : ""}`
      );
    }
    console.log("[e2e] startup text", startupProbe.snapshot);

    const diagnostics = await client.executeScript(`
      const viewport = document.querySelector('.xterm-viewport');
      const html = document.documentElement;
      const body = document.body;
      const viewportStyle = viewport ? getComputedStyle(viewport) : null;
      return {
        html: { clientHeight: html.clientHeight, scrollHeight: html.scrollHeight },
        body: { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight },
        viewport: viewport
          ? {
              clientWidth: viewport.clientWidth,
              scrollWidth: viewport.scrollWidth,
              clientHeight: viewport.clientHeight,
              scrollHeight: viewport.scrollHeight,
              overflowY: viewportStyle ? viewportStyle.overflowY : null,
              overflow: viewportStyle ? viewportStyle.overflow : null
            }
          : null
      };
    `);
    console.log("[e2e] terminal diagnostics", diagnostics);

    const png = await client.takeScreenshot();
    const outputPath = path.join(repoRoot, "terminal-screen.png");
    fs.writeFileSync(outputPath, png, "base64");
    console.log(`[e2e] screenshot saved: ${outputPath}`);
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
