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
  const tauriDriverPath = resolveTauriDriverPath();
  if (process.platform === "win32" && !tauriDriverPath) {
    throw new Error("tauri-driver not found in PATH");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-orchestrator.exe")) {
    throw new Error("yurutsuku-orchestrator already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-worker.exe")) {
    throw new Error("yurutsuku-worker already running");
  }

  const driverPort = 4452;
  const driver = spawn(tauriDriverPath, ["--port", String(driverPort)], { stdio: "inherit" });
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

    await client.executeScript("applyView('terminal'); if (typeof initTerminal==='function') initTerminal();");
    await waitFor(async () => {
      const initialized = await client.executeScript(
        "return typeof terminalInitialized !== 'undefined' && terminalInitialized === true;"
      );
      return Boolean(initialized);
    }, 10000);
    await waitFor(async () => {
      const hasRows = await client.executeScript(
        "return Boolean(document.querySelector('.xterm-rows'));"
      );
      return Boolean(hasRows);
    }, 10000);

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
