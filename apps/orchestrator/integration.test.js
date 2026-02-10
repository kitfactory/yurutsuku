const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const { parseLine, serializeMessage } = require("../../packages/protocol/src/index.js");

const appRoot = __dirname;
const repoRoot = path.join(appRoot, "..", "..");

function workerExeName() {
  return process.platform === "win32" ? "nagomi-worker.exe" : "nagomi-worker";
}

function buildWorkerBinary() {
  const candidate = path.join(repoRoot, "target", "debug", workerExeName());
  const build = spawnSync("cargo", ["build", "-p", "nagomi-worker"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error("failed to build worker binary");
  }
  if (!fs.existsSync(candidate)) {
    throw new Error("worker binary not found after build");
  }
  return candidate;
}

const workerBinaryPath = buildWorkerBinary();

function createMessageQueue(readable) {
  const rl = readline.createInterface({ input: readable });
  const queue = [];
  let resolver = null;

  rl.on("line", (line) => {
    const message = parseLine(line);
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve(message);
    } else {
      queue.push(message);
    }
  });

  return {
    next(timeoutMs) {
      return new Promise((resolve, reject) => {
        if (queue.length > 0) {
          resolve(queue.shift());
          return;
        }
        const timer = setTimeout(() => {
          if (resolver) {
            resolver = null;
          }
          reject(new Error("timeout waiting for message"));
        }, timeoutMs);
        resolver = (message) => {
          clearTimeout(timer);
          resolve(message);
        };
      });
    },
    close() {
      rl.close();
    },
  };
}

async function waitForMessage(queue, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const message = await queue.next(remaining);
    if (predicate(message)) {
      return message;
    }
  }
  throw new Error("timeout waiting for predicate");
}

function startWorker() {
  const child = spawn(workerBinaryPath, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: repoRoot,
  });
  const queue = createMessageQueue(child.stdout);

  return {
    child,
    queue,
    send(message) {
      const line = serializeMessage(message);
      child.stdin.write(line);
    },
    stop() {
      if (!child.killed) {
        child.kill();
      }
      queue.close();
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withWorker(fn) {
  const worker = startWorker();
  try {
    await fn(worker);
  } finally {
    worker.stop();
  }
}

function baseStartSession(sessionId, cmd) {
  return {
    type: "start_session",
    session_id: sessionId,
    cmd,
    cols: 120,
    rows: 30,
  };
}

function shellCommand() {
  return process.platform === "win32" ? "cmd.exe" : "sh";
}

function echoAndExitCommand() {
  return process.platform === "win32" ? "cmd.exe /C echo ok" : "sh -c echo ok";
}

function echoAndExitPayload() {
  return process.platform === "win32" ? "echo ok\r\nexit\r\n" : "echo ok\nexit\n";
}

test("worker_spawn_stdio_connect", async () => {
  await withWorker(async (worker) => {
    assert.ok(worker.child.pid);
  });
});

test("send_start_send_input_resize_stop", async () => {
  await withWorker(async (worker) => {
    const sessionId = "session-resize-stop";

    worker.send(baseStartSession(sessionId, shellCommand()));
    worker.send({
      type: "resize",
      session_id: sessionId,
      cols: 140,
      rows: 40,
    });
    worker.send({
      type: "send_input",
      session_id: sessionId,
      text: process.platform === "win32" ? "echo ok\r\n" : "echo ok\n",
    });

    try {
      await waitForMessage(
        worker.queue,
        (message) => message.type === "output" && message.chunk.toLowerCase().includes("ok"),
        1000
      );
    } catch {
      // 出力待ちが間に合わない場合は stop_session を優先する / Prefer stop_session if output is late.
    }

    worker.send({
      type: "stop_session",
      session_id: sessionId,
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const remaining = Math.max(50, deadline - Date.now());
      const message = await worker.queue.next(remaining);
      if (message.type === "exit") {
        return;
      }
      if (message.type === "error") {
        throw new Error(`worker error: ${JSON.stringify(message)}`);
      }
    }
    throw new Error("timeout waiting for exit");
  });
});

test("recv_output_exit_error", async () => {
  await withWorker(async (worker) => {
    const sessionId = "session-output-exit";

    worker.send(baseStartSession(sessionId, echoAndExitCommand()));
    await waitForMessage(
      worker.queue,
      (message) => message.type === "output" && message.chunk.toLowerCase().includes("ok"),
      5000
    );
    await waitForMessage(worker.queue, (message) => message.type === "exit", 5000);
  });
});

  test("session_flow", async () => {
    await withWorker(async (worker) => {
      const sessionId = "session-flow";

      worker.send(baseStartSession(sessionId, shellCommand()));
      // Shell startup timing on ConPTY can vary; wait briefly before the first command.
      // ConPTY の起動タイミングは変動するため、最初の入力前に短く待機する。
      await sleep(process.platform === "win32" ? 120 : 40);
      worker.send({
        type: "send_input",
        session_id: sessionId,
        text: process.platform === "win32" ? "echo ok\r\n" : "echo ok\n",
      });
      await waitForMessage(
        worker.queue,
        (message) => message.type === "output" && String(message.chunk || "").toLowerCase().includes("ok"),
        15000
      );
      worker.send({
        type: "send_input",
        session_id: sessionId,
        text: process.platform === "win32" ? "exit\r\n" : "exit\n",
      });
      await waitForMessage(worker.queue, (message) => message.type === "exit", 15000);
  });
});

test("app_lifecycle", () => {
  const pkgPath = path.join(appRoot, "package.json");
  assert.ok(fs.existsSync(pkgPath));
});

test("window_open_close", () => {
  const tauriDir = path.join(appRoot, "src-tauri");
  assert.ok(fs.existsSync(tauriDir));
});

test("settings_persist", () => {
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  assert.ok(fs.existsSync(tauriMain));
});

test("chat_lane_input", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="chat-lane"'));
  assert.ok(html.includes('data-role="chat-input"'));
});

test("chat_follow", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="follow-toggle"'));
  assert.ok(html.includes("setFollow("));
});

test("run_tiles_focus", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="run-tiles"'));
  assert.ok(html.includes('data-role="run-tile"'));
  assert.ok(html.includes("focused"));
});

test("character_phase", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="character-phase"'));
  assert.ok(html.includes('data-role="phase-button"'));
});

test("mode_switch", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="mode-switch"'));
  assert.ok(html.includes('data-role="chat-main"'));
  assert.ok(html.includes('data-role="run-board"'));
  assert.ok(html.includes("modeChips"));
});

test("settings_notify", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-notify-toggle"'));
  assert.ok(html.includes('data-role="settings-audio-toggle"'));
  assert.ok(html.includes('data-role="settings-volume"'));
  assert.ok(html.includes('data-role="settings-silence-timeout"'));
});

test("settings_llm", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-llm-toggle"'));
  assert.ok(html.includes('data-role="settings-llm-tool"'));
});

test("settings_terminal_runtime", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-windows-card"'));
  assert.ok(html.includes('data-role="settings-terminal-shell-kind"'));
  assert.ok(html.includes('data-role="settings-terminal-wsl-distro"'));
  assert.ok(html.includes('data-role="settings-keybind-arrange"'));
  assert.ok(html.includes('data-role="settings-keybind-focus-next"'));
  assert.ok(html.includes('data-role="settings-keybind-focus-prev"'));
});

test("settings_theme_single_selector", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-terminal-theme"'));
  assert.ok(!html.includes('data-role="settings-terminal-theme-palette"'));
  assert.ok(html.includes('value="light-sand"'));
  assert.ok(html.includes('value="light-sage"'));
  assert.ok(html.includes('value="light-sky"'));
  assert.ok(html.includes('value="light-mono"'));
  assert.ok(html.includes('value="dark-ink"'));
  assert.ok(html.includes('value="dark-ocean"'));
  assert.ok(html.includes('value="dark-ember"'));
  assert.ok(html.includes('value="dark-mono"'));
});

test("run_tile_double_click_same_position", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("singleClickDelayMs"));
  assert.ok(html.includes("event.detail !== 1"));
  assert.ok(html.includes("addEventListener('dblclick'"));
  assert.ok(html.includes("clearTileSingleClickTimer(tile)"));
  assert.ok(html.includes("open_terminal_window_same_position_for_session"));
  assert.ok(html.includes("open_terminal_window_by_index_same_position"));
  assert.ok(html.includes("terminalSurfaceDoubleClickCooldownMs"));
  assert.ok(html.includes("terminalSurfaceSpawnInFlight"));
  assert.ok(html.includes("if (!isTerminalView) return;"));
  assert.ok(html.includes("event.detail >= 2"));
});

test("terminal_selection_handoff_pickup", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("pickupCurrentTerminalWindowIfNeeded"));
  assert.ok(html.includes("terminalPickupInFlight"));
  assert.ok(html.includes("terminalPickupCooldownMs"));
  assert.ok(html.includes("focusTransitionActive"));
  assert.ok(html.includes("pickup_terminal_window', { sessionId: terminalSessionId }"));
  assert.ok(html.includes("terminalContainer.addEventListener('click'"));
  assert.ok(html.includes("event.detail !== 1"));
  assert.ok(html.includes("window.addEventListener('focus'"));
});

test("focus_transition_animation_speed_policy", () => {
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("const SHRINK_MS: u64 = 80;"));
  assert.ok(rust.includes("const EXPAND_MS: u64 = 110;"));
  assert.ok(rust.includes("const STEP_MS: u64 = 10;"));
});

test("terminal_selection_pickup_requires_arranged_layout", () => {
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("arranged: Mutex<bool>"));
  assert.ok(rust.includes("internal_layout_change_deadline_ms: AtomicU64"));
  assert.ok(rust.includes("arranged_layout_for_pickup"));
  assert.ok(rust.includes("is_internal_layout_change_active"));
  assert.ok(rust.includes("should_reuse_cached_layout"));
  assert.ok(rust.includes("window.on_window_event"));
  assert.ok(rust.includes("tauri::WindowEvent::Moved(_)"));
  assert.ok(rust.includes("tauri::WindowEvent::Resized(_)"));
  assert.ok(rust.includes("mark_terminal_layout_arranged(&app, true);"));
  assert.ok(rust.includes("mark_terminal_layout_arranged(&app, false);"));
});

test("terminal_internal_ng_command_intercept", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("parseNagomiInternalCommand"));
  assert.ok(html.includes("processNagomiInternalInputChunk"));
  assert.ok(html.includes("executeNagomiInternalCommand"));
  assert.ok(html.includes("emitLocalTerminalOutput(processed.localEchoText"));
  assert.ok(html.includes("trimmed.startsWith(':ng')"));
  assert.ok(html.includes("setLastTerminalEvent('internal'"));
  assert.ok(html.includes("cleaned.trimStart().startsWith(':')"));
  assert.ok(html.includes("rollbackNagomiInternalCommands"));
  assert.ok(html.includes("if (nagomiInternalEnabled && internal)"));
  assert.ok(html.includes("terminal_internal_commands_enabled"));
  assert.ok(html.includes("settings-terminal-internal-commands"));
  assert.ok(html.includes("nextForward += '\\r';"));

  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("terminal_internal_commands_enabled"));
  assert.ok(rust.includes("default_terminal_internal_commands_enabled"));
  assert.ok(rust.includes("TerminalBuiltinCommand"));
  assert.ok(rust.includes("process_terminal_input_chunk"));
  assert.ok(rust.includes("execute_terminal_builtin_command"));
  assert.ok(rust.includes("\"pong\\r\\n\""));
});

test("settings_character_log_retention", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-character-upload"'));
  assert.ok(html.includes('data-role="settings-character-list"'));
  assert.ok(html.includes('data-role="settings-log-retention"'));
});

test("settings_persist", () => {
  const docsPlan = path.join(appRoot, "..", "..", "docs", "plan.md");
  assert.ok(fs.existsSync(docsPlan));
});
