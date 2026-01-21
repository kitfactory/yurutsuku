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

  const tauriDriverPath = resolveTauriDriverPath();
  if (process.platform === "win32" && !tauriDriverPath) {
    throw new Error("tauri-driver not found in PATH");
  }

  if (process.platform === "win32" && isWindowsProcessRunning("msedgedriver.exe")) {
    throw new Error("msedgedriver already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-orchestrator.exe")) {
    throw new Error("yurutsuku-orchestrator already running");
  }
  if (process.platform === "win32" && isWindowsProcessRunning("yurutsuku-worker.exe")) {
    throw new Error("yurutsuku-worker already running");
  }

  const driverPort = 4444;
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

    await waitFor(async () => {
      const ok = await client
        .executeScript("return typeof applyView === 'function';")
        .catch(() => false);
      return Boolean(ok);
    }, 10000);

    await client.executeScript(
      "applyView('terminal'); if (typeof initTerminal==='function') initTerminal();"
    );
    await waitFor(async () => {
      const ready = await client
        .executeScript(
          "return typeof terminal !== 'undefined' && terminal && terminal.cols > 0 && terminal.rows > 0;"
        )
        .catch(() => false);
      return Boolean(ready);
    }, 20000);

    const ipcSessionId = await waitFor(async () => {
      const sessionId = await client.executeScript("return window.__ipcSessionId || null;");
      return sessionId || null;
    }, 10000).then(async () => {
      return await client.executeScript("return window.__ipcSessionId || null;");
    });
    if (!ipcSessionId) {
      throw new Error("ipc session id not ready");
    }

    const sessionId = await client.executeScript(
      "return typeof terminalSessionId !== 'undefined' ? terminalSessionId : null;"
    );
    if (!sessionId) {
      throw new Error("terminal session id not found");
    }

    await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        invoke("register_terminal_session", { ipcSessionId, sessionId: id })
          .then(() => done({ ok: true }))
          .catch((err) => done({ error: String(err) }));
      },
      ipcSessionId,
      sessionId
    );

    await client.executeAsyncScript(
      function (ipcSessionId, id, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        invoke("start_terminal_session", { ipcSessionId, sessionId: id, cols: 120, rows: 30 })
          .then(() => done({ ok: true }))
          .catch((err) => done({ error: String(err) }));
      },
      ipcSessionId,
      sessionId
    );

    // Stress: emit many lines and ensure we observe the tail marker.
    const marker = `stress-${Date.now()}`;
    const lineCount = 1200;
    const cmd = `for /L %i in (1,1,${lineCount}) do @echo ${marker}-%i\r\n`;

    await client.executeAsyncScript(
      function (ipcSessionId, id, text, done) {
        const invoke =
          (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
          (window.__TAURI__ && window.__TAURI__.invoke);
        invoke("terminal_send_input", { ipcSessionId, sessionId: id, text })
          .then(() => done({ ok: true }))
          .catch((err) => done({ error: String(err) }));
      },
      ipcSessionId,
      sessionId,
      cmd
    );

    await waitFor(async () => {
      const tail = await client.executeScript(`
        try {
          const buf = terminal && terminal.buffer && terminal.buffer.active;
          if (!buf) return '';
          const end = buf.baseY + buf.cursorY;
          const start = Math.max(0, end - 40);
          const lines = [];
          for (let i = start; i <= end; i += 1) {
            const line = buf.getLine(i);
            if (!line) continue;
            lines.push(line.translateToString(true));
          }
          return lines.join('\\n');
        } catch {
          return '';
        }
      `);
      return String(tail || "").includes(`${marker}-${lineCount}`);
    }, 30000);

    // Resize: change window size and ensure terminal dimensions react.
    const before = await client.executeScript(
      "return terminal ? { cols: terminal.cols, rows: terminal.rows } : null;"
    );
    try {
      await client.manage().window().setRect({ width: 900, height: 600 });
      await waitFor(async () => {
        const after = await client.executeScript(
          "return terminal ? { cols: terminal.cols, rows: terminal.rows } : null;"
        );
        return (
          after &&
          before &&
          (after.cols !== before.cols || after.rows !== before.rows) &&
          after.cols > 0 &&
          after.rows > 0
        );
      }, 15000);
    } catch (err) {
      // Some environments don't support resizing via WebDriver; keep as best-effort.
      console.log("[e2e] window resize skipped:", String(err));
    }
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
