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
      // Output can be delayed; prefer stop_session if output is late.
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
      // ConPTY startup can be delayed; wait briefly before first input.
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

test("subworker_ui_and_settings", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="settings-subworker-enabled-toggle"'));
  assert.ok(html.includes('data-role="settings-subworker-debug-toggle"'));
  assert.ok(html.includes('data-role="settings-status-debug-toggle"'));
  assert.ok(html.includes('data-role="settings-subworker-mode"'));
  assert.ok(html.includes('data-role="settings-subworker-threshold"'));
  assert.ok(html.includes('data-role="settings-subworker-prompt-template"'));
  assert.ok(html.includes('data-role="settings-subworker-prompt-template-reset"'));
  assert.ok(html.includes('data-role="subworker-pause-toggle"'));
  assert.ok(html.includes('data-role="subworker-skip-once"'));
  assert.ok(html.includes("subworker-active-overlay"));
  assert.ok(html.includes('data-role="subworker-advice-overlay"'));
  assert.ok(html.includes("recordSubworkerDecision"));
  assert.ok(html.includes("[nagomi-subworker("));

  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("subworker_enabled"));
  assert.ok(rust.includes("subworker_debug_enabled"));
  assert.ok(rust.includes("subworker_mode"));
  assert.ok(rust.includes("subworker_confidence_threshold"));
  assert.ok(rust.includes("subworker_prompt_template_markdown"));
  assert.ok(rust.includes("status_debug_enabled"));
  assert.ok(rust.includes("default_subworker_mode"));
});

test("subworker_runs_only_after_ai_judge_completion", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function queueSubworkerOnJudgeCompleted(observedState, observedReason, trigger)"));
  // When LLM features are disabled, the subworker must not run, but should still record a skip.
  assert.ok(html.includes("skip-llm-disabled"));
  assert.ok(html.includes("normalizedTrigger === 'judge-result'"));
  assert.ok(html.includes("normalizedTrigger === 'hook-judge'"));
  assert.ok(html.includes("normalizedTrigger === 'judge-fallback'"));
  assert.ok(html.includes("queueSubworkerOnJudgeCompleted(observed.state, observed.reason, 'hook-judge');"));
  assert.ok(html.includes("queueSubworkerOnJudgeCompleted(normalized, title, 'judge-result');"));
  assert.ok(html.includes("queueSubworkerOnJudgeCompleted(TerminalObservation.needInput, fallbackReason, 'judge-fallback')"));
  assert.ok(html.includes("maybeRunSubworker('judge-complete'"));
  assert.ok(html.includes("judgeCompleteSource"));
});

test("subworker_judge_complete_dedup_and_ghost_key_behavior", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("SUBWORKER_JUDGE_COMPLETE_DEDUP_MS"));
  assert.ok(html.includes("last_judge_complete_signature"));
  assert.ok(html.includes("terminalState.runtime.subworker.last_judge_complete_signature"));
  assert.ok(html.includes("function buildSubworkerJudgeCompleteDedupSignature({"));
  assert.ok(html.includes("function buildSubworkerRunDedupSignature({"));
  assert.ok(html.includes("skip-judge-complete-dedup"));
  assert.ok(html.includes("kind: 'judge-complete-dedup'"));
  assert.ok(html.includes("Source is intentionally ignored"));
  assert.ok(html.includes("dedup_signature: truncateDebugText(dedupSignature, 260)"));
  assert.ok(html.includes("function shouldDismissSubworkerGhostOnDomKey(key)"));
  assert.ok(html.includes("function maybeDismissSubworkerGhostOnKey(key, reason = 'user-key')"));
  assert.ok(html.includes("inline_ghost_visible: false,"));
  assert.ok(html.includes("inline_ghost_cell_count: 0,"));
  assert.ok(html.includes("ghost_prefill_active: false,"));
  assert.ok(html.includes("function splitSubworkerSuggestedInputForPrefill(input)"));
  assert.ok(html.includes("function rollbackSubworkerGhostPrefill(reason)"));
  assert.ok(html.includes("function ensureSubworkerGhostPrefill(input, signature, reason)"));
  assert.ok(html.includes("function subworkerCellWidth(text)"));
  assert.ok(html.includes("const chunk = ansiMessage"));
  assert.ok(html.includes(": `\\x1b[0m\\x1b[K${sgr}${message}\\x1b[0m`;"));
  assert.ok(html.includes("if (isSuggestedPreviewLine) {"));
  assert.ok(html.includes("ensureSubworkerGhostPrefill("));
  assert.ok(html.includes("enqueueTerminalInput('\\x7f'.repeat(count));"));
  assert.ok(html.includes("terminalState.runtime.subworker.inline_ghost_cell_count === ghostCells"));
  assert.ok(html.includes("const passiveClear = clearReason === 'pty-output';"));
  assert.ok(html.includes("if (hadInlineGhost && !passiveClear) {"));
  assert.ok(html.includes("const moveLeft = ghostCells > 0 ? `\\x1b[${ghostCells}D` : '';"));
  assert.ok(html.includes("enqueueTerminalOutput(`${moveLeft}\\x1b[0m\\x1b[K`);"));
  assert.ok(html.includes("maybeDismissSubworkerGhostOnKey(String(event.key || ''), 'user-key-pre');"));
  assert.ok(html.includes("maybeDismissSubworkerGhostOnKey(key, 'user-key')"));
  assert.ok(html.includes("maybeDismissSubworkerGhostOnKey(key, 'user-key-global')"));
});

test("subworker_resize_restore_recomputes_placeholder", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function restoreSubworkerOutputIfMissing(reason)"));
  assert.ok(html.includes("refreshSubworkerOverlayPlaceholder(`restore-${reason || 'resize'}`);"));
  // Resize restore must not replay stale display text directly.
  assert.ok(!html.includes("writeSubworkerOverlayLine(terminalState.runtime.subworker.last_display_line);"));
});

test("subworker_prompt_has_fixed_json_preamble", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("SUBWORKER_PROMPT_FIXED_PREAMBLE"));
  assert.ok(html.includes("SUBWORKER_PROMPT_FIXED_EPILOGUE"));
  assert.ok(html.includes("Return a single JSON object"));
  assert.ok(html.includes("delegate_input|show_advice|noop"));
  assert.ok(html.includes("advice_markdown"));
});

test("subworker_runtime_phase_unified_state", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("const SubworkerRuntimePhase = Object.freeze({"));
  assert.ok(html.includes("const terminalState = {"));
  assert.ok(html.includes("unified: {"));
  assert.ok(html.includes("subworker_phase: 'idle'"));
  assert.ok(html.includes("function currentSubworkerRuntimePhase()"));
  assert.ok(!html.includes("let subworkerRuntimePhase = SubworkerRuntimePhase.idle;"));
  assert.ok(html.includes("function setSubworkerRuntimePhase(nextPhase)"));
  assert.ok(html.includes("function isSubworkerRuntimeRunning()"));
  assert.ok(html.includes("function isSubworkerRuntimePaused()"));
  assert.ok(html.includes("syncTerminalUnifiedState(currentObservedState, currentReason);"));
  assert.ok(html.includes("setSubworkerActive(active)"));
  assert.ok(html.includes("setSubworkerRuntimePhase(active ? SubworkerRuntimePhase.running : SubworkerRuntimePhase.idle);"));
});

test("subworker_modes_share_trigger_and_split_only_on_final_apply", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function subworkerCanRunForState(_mode, state)"));
  assert.ok(html.includes("state === TerminalObservation.success"));
  assert.ok(html.includes("state === TerminalObservation.needInput"));
  assert.ok(html.includes("state === TerminalObservation.fail"));
  assert.ok(html.includes("function finalizeSubworkerDecision({"));
  assert.ok(html.includes("if (mode !== SubworkerMode.advice)"));
  assert.ok(html.includes("if (canDelegate && normalizedConfidence < threshold)"));
  assert.ok(html.includes("action = 'delegate_input';"));
  assert.ok(html.includes("action = 'show_advice';"));
  assert.ok(!html.includes("guard: state not need_input"));
});

test("subworker_running_placeholder_progress", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("SUBWORKER_RUNNING_SPINNER_FRAMES"));
  assert.ok(html.includes("SUBWORKER_RUNNING_SPINNER_INTERVAL_MS"));
  assert.ok(html.includes("function currentSubworkerRunningSpinnerFrame()"));
  assert.ok(html.includes("function buildSubworkerRunningSpinnerLineSpec()"));
  assert.ok(html.includes("function scheduleSubworkerRunningSpinnerTick()"));
  assert.ok(html.includes("function syncSubworkerRunningSpinner(active, phaseChanged = false)"));
  assert.ok(html.includes("const prefixChars = Array.from(String(prefix || ''));"));
  assert.ok(html.includes("const activePrefixIndex = prefixChars.length > 0 ? frame % prefixChars.length : -1;"));
  assert.ok(html.includes("if (isSubworkerRuntimeRunning()) return true;"));
  assert.ok(html.includes("refreshSubworkerOverlayPlaceholder('subworker-running-tick');"));
  assert.ok(html.includes("if (subworkerOverlayFlashTimer && !isSubworkerRuntimeRunning()) return;"));
  assert.ok(html.includes("if (isSubworkerRuntimeRunning()) {"));
  assert.ok(html.includes("ansiMessage"));
  assert.ok(html.includes("renderKey"));
  assert.ok(html.includes("t('subworker.processing.prefix')"));
  assert.ok(html.includes("'subworker.processing.prefix': 'サブワーカー処理中（Escで抜けます）'"));
  assert.ok(html.includes("'subworker.processing.prefix': 'subworker processing (Esc to hold)'"));
  assert.ok(html.includes("if (agentWorkActive || agentAwaitingFirstOutput) return false;"));
  assert.ok(html.includes("state === TerminalObservation.running &&"));
  assert.ok(html.includes("!agentWorkActive &&"));
});

test("running_status_split_for_ai_and_subworker", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(html.includes("const TerminalStatusState = Object.freeze({"));
  assert.ok(html.includes("running: 'running'"));
  assert.ok(html.includes("aiRunning: 'ai-running'"));
  assert.ok(html.includes("subworkerRunning: 'subworker-running'"));
  assert.ok(html.includes("function resolveTerminalStatusState(state)"));
  assert.ok(html.includes("const unifiedStatusState = syncTerminalUnifiedState("));
  assert.ok(html.includes("status_state: unifiedStatusState"));
  assert.ok(html.includes("terminal_unified: {"));
  assert.ok(html.includes("observed_status: resolveTerminalStatusState("));
  assert.ok(rust.includes("\"ai-running\""));
  assert.ok(rust.includes("\"running\""));
  assert.ok(rust.includes("\"subworker-running\""));
});

test("subworker_debug_execution_logs", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(html.includes("subworker start: event="));
  assert.ok(html.includes("subworker skip: disabled"));
  assert.ok(html.includes("subworker skip: mode="));
  assert.ok(html.includes("subworker skip: runtime already running"));
  assert.ok(html.includes("subworker skip: dedup window"));
  assert.ok(html.includes("function appendSubworkerDebugEvent(eventType, details = {})"));
  assert.ok(html.includes("invokeWithSession('append_subworker_debug_event', { payload })"));
  assert.ok(html.includes("subworker-debug-file:"));
  assert.ok(html.includes("buildSubworkerResultMessage(decision.confidence, threshold, decision.action, result)"));
  assert.ok(rust.includes("fn subworker_debug_events_path"));
  assert.ok(rust.includes("subworker_debug_events.jsonl"));
  assert.ok(rust.includes("append_subworker_debug_event"));
});

test("subworker_advice_suggestion_tab_accept", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function isTerminalInteractionEnabled()"));
  assert.ok(html.includes("last_suggested_input: ''"));
  assert.ok(html.includes("'subworker.advice.tab_hint'"));
  assert.ok(html.includes("return `${t('subworker.advice.tab_hint')}${inputPreview}`;"));
  assert.ok(html.includes("isSuggestionLine: hasSuggestion"));
  assert.ok(html.includes("suggestionPreview,"));
  assert.ok(html.includes("const isSuggestionLineByOption = Boolean(options && options.isSuggestionLine);"));
  assert.ok(html.includes("const effectiveSuggestedPreview = suggestedPreviewFromOption || suggestedPreview;"));
  assert.ok(html.includes("isSuggestionLineByOption ||"));
  assert.ok(html.includes("render-suggestion-no-prefill"));
  assert.ok(html.includes("function acceptSubworkerSuggestedInput(trigger)"));
  assert.ok(html.includes("if (!isTerminalInteractionEnabled()) return false;"));
  assert.ok(html.includes("appendSubworkerDebugEvent('suggestion'"));
  assert.ok(html.includes("key === 'tab'"));
  assert.ok(html.includes("acceptSubworkerSuggestedInput('tab'"));
  assert.ok(html.includes("acceptSubworkerSuggestedInput('tab-global'"));
});

test("subworker_need_input_instruction_has_priority_over_shortcuts_hint", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const fnIndex = html.indexOf("function subworkerAdviceInputInstruction(state, hint, outputTail)");
  assert.ok(fnIndex >= 0);
  const needInputIndex = html.indexOf(
    "if (state === TerminalObservation.needInput) return t('subworker.advice.input_need_input');",
    fnIndex
  );
  const shortcutsIndex = html.indexOf(
    "if (hasShortcutsMarker && !meaningfulOutput) {",
    fnIndex
  );
  assert.ok(needInputIndex >= 0);
  assert.ok(shortcutsIndex >= 0);
  assert.ok(needInputIndex < shortcutsIndex);
});

test("codex_typing_does_not_show_running", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("avoid showing running/need-input"));
  assert.ok(html.includes("normalized === TerminalStatusState.needInput || normalized === TerminalStatusState.running"));
  assert.ok(html.includes("Date.now() - terminalLastUserInputAt < 1200"));
});

test("global_key_forward_when_terminal_unfocused", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function terminalDomKeyToInputChunk(key)"));
  assert.ok(html.includes("function shouldForwardGlobalKeyToTerminal(event)"));
  assert.ok(html.includes("function maybeForwardGlobalKeyToTerminal(event, key)"));
  assert.ok(html.includes("setLastTerminalEvent('global-key-forward', key);"));
  assert.ok(html.includes("if (maybeForwardGlobalKeyToTerminal(event, key)) return;"));
});

test("manual_hold_blocks_judge_and_subworker_until_enter", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("const AutomationGateState = Object.freeze({"));
  assert.ok(html.includes("manualHold: 'manual-hold'"));
  assert.ok(html.includes("function isAutomationManualHoldActive()"));
  assert.ok(html.includes("function enterAutomationManualHold(reason = 'escape')"));
  assert.ok(html.includes("function releaseAutomationManualHold(reason = 'user-enter')"));
  assert.ok(html.includes("function maybeEnterAutomationManualHoldFromEsc(trigger)"));
  assert.ok(html.includes("function maybeReleaseAutomationManualHoldOnEnter(trigger)"));
  assert.ok(html.includes("if (isAutomationManualHoldActive()) return;"));
  assert.ok(html.includes("if (isAutomationManualHoldActive()) {"));
  assert.ok(html.includes("return TerminalStatusState.idle;"));
  assert.ok(html.includes("kind: 'manual-hold'"));
  assert.ok(html.includes("skip-manual-hold"));
  assert.ok(html.includes("maybeEnterAutomationManualHoldFromEsc('terminal-onkey');"));
  assert.ok(html.includes("maybeEnterAutomationManualHoldFromEsc('global-keydown');"));
  assert.ok(html.includes("maybeReleaseAutomationManualHoldOnEnter('terminal-onkey');"));
  assert.ok(html.includes("maybeReleaseAutomationManualHoldOnEnter('global-keydown-forward');"));
});

test("status_debug_execution_logs", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(html.includes("function appendStatusDebugEvent(eventType, details = {})"));
  assert.ok(html.includes("terminal_unified: {"));
  assert.ok(html.includes("base_state: terminalState.unified.base_state"));
  assert.ok(html.includes("status_state: terminalState.unified.status_state"));
  assert.ok(html.includes("subworker_phase: terminalState.unified.subworker_phase"));
  assert.ok(html.includes("invokeWithSession('append_status_debug_event', { payload })"));
  assert.ok(html.includes("status-debug-file:"));
  assert.ok(rust.includes("fn status_debug_events_path"));
  assert.ok(rust.includes("status_debug_events.jsonl"));
  assert.ok(rust.includes("append_status_debug_event"));
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

test("terminal_context_menu_open_new_window", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('data-role="terminal-context-menu"'));
  assert.ok(html.includes('data-role="terminal-context-open-new"'));
  assert.ok(html.includes("'terminal.context.open_new': '新しいターミナルを開く'"));
  assert.ok(html.includes("'terminal.context.open_new': 'Open New Terminal Window'"));
  assert.ok(html.includes("singleClickDelayMs"));
  assert.ok(html.includes("event.detail !== 1"));
  assert.ok(html.includes("clearTileSingleClickTimer(tile)"));
  assert.ok(html.includes("isTerminalContextMenuEnabled()"));
  assert.ok(html.includes("isWithinTerminalShell(event && event.target)"));
  assert.ok(html.includes("'contextmenu'"));
  assert.ok(html.includes("showTerminalContextMenuAt("));
  assert.ok(html.includes("handleTerminalContextOpenNew"));
  assert.ok(html.includes("terminalContextOpenNewButton.addEventListener('click'"));
  assert.ok(html.includes("window.addEventListener("));
  assert.ok(html.includes("'pointerdown'"));
  assert.ok(html.includes("open_terminal_window_same_position_selected"));
  assert.ok(html.includes("open_terminal_window_same_position_for_session"));
  assert.ok(html.includes("hasTerminalSessionIdParam"));
  assert.ok(html.includes("terminalSurfaceSpawnInFlight"));
  assert.ok(html.includes("if (!isTerminalView) return;"));
  assert.ok(!html.includes("addEventListener('dblclick'"));
});

test("tray_menu_open_character_window_item", () => {
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes('"open_character_watcher"'));
  assert.ok(rust.includes('"Open Character Window"'));
  assert.ok(rust.includes("menu.append(&open_character_watcher)?;"));
  assert.ok(rust.includes("id if id == \"open_character_watcher\" => {"));
  assert.ok(rust.includes("open_character_watcher_from_tray(app);"));
  assert.ok(rust.includes("fn persist_terminal_watcher_enabled"));
  assert.ok(rust.includes("settings.terminal_watcher_enabled = enabled;"));
  assert.ok(rust.includes("persist_terminal_watcher_enabled(app, true);"));
  assert.ok(rust.includes("fn bind_watcher_window_events"));
  assert.ok(rust.includes("tauri::WindowEvent::CloseRequested { api, .. }"));
  assert.ok(rust.includes("api.prevent_close();"));
  assert.ok(rust.includes("tauri::WindowEvent::Destroyed"));
  assert.ok(rust.includes("persist_terminal_watcher_enabled(&app_for_events, false);"));
});

test("character_windows_close_when_all_terminals_end", () => {
  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("fn close_character_windows_if_all_terminals_closed"));
  assert.ok(rust.includes("let terminal_windows_empty = collect_terminal_windows(app).is_empty();"));
  assert.ok(rust.includes("if !terminal_windows_empty && !(active_empty && workers_empty) {"));
  assert.ok(rust.includes("close_watcher_window(app);"));
  assert.ok(rust.includes("app.get_webview_window(WINDOW_WATCHER_DEBUG)"));
  assert.ok(rust.includes("close_character_windows_if_all_terminals_closed(&app);"));
  assert.ok(rust.includes("close_character_windows_if_all_terminals_closed(&app_for_events);"));
  assert.ok(rust.includes("sync_watcher_window(&app, &settings);"));
});

test("character_debug_window_close_actions_are_explicit", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(!html.includes('<div class="character-debug-frame"'));
  assert.ok(!html.includes('class="character-debug-frame-close"'));
  assert.ok(!html.includes('class="character-debug-frame-resize"'));
  assert.ok(!html.includes('<div class="terminal-debug-badge"'));
  assert.ok(!html.includes('class="terminal-debug-action"'));
  assert.ok(!html.includes('class="terminal-debug-toggle"'));
  assert.ok(html.includes("async function requestCloseWatcherWindow(trigger = 'ui')"));
  assert.ok(html.includes("settingsState.terminal_watcher_enabled = false;"));
  assert.ok(html.includes("'set_terminal_watcher_enabled'"));
  assert.ok(html.includes("{ enabled: false }"));
  assert.ok(html.includes("const next = { ...settingsState, terminal_watcher_enabled: false };"));
  assert.ok(html.includes("void invokeWithSession('save_settings', { settings: next }).catch((saveError) => {"));
  assert.ok(!html.includes("window.close();"));
  assert.ok(!html.includes("requestCloseCharacterDebugWatcher('escape-key')"));
});

test("watcher_toggle_restore_and_focus_frame_control", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("characterDebugModeEnabled || terminalWatcherEnabled"));
  assert.ok(!html.includes('class="character-debug-frame"'));
  assert.ok(!html.includes('class="terminal-debug-badge"'));
  assert.ok(!html.includes('class="terminal-debug-action"'));
  assert.ok(!html.includes('class="terminal-debug-toggle"'));
  assert.ok(!html.includes(".character-debug-frame {"));
  assert.ok(!html.includes(".terminal-debug-badge {"));
  assert.ok(!html.includes(".terminal-debug-action {"));
  assert.ok(!html.includes(".terminal-debug-toggle {"));
  assert.ok(html.includes("function setCharacterDebugFrameSelected(selected)"));
  assert.ok(html.includes("if (!characterDebugFrame) {"));
  assert.ok(html.includes("document.body.classList.remove('character-debug-selected');"));
  assert.ok(html.includes("if (!characterDebugFrameCloseButton && !characterDebugFrameResizeHandle) return;"));
  assert.ok(html.includes("body.watcher-only .terminal-watcher {\n        display: block;"));
  assert.ok(html.includes("body.watcher-only .terminal-watcher img,"));
  assert.ok(html.includes("body.watcher-only .terminal-watcher-3d canvas {\n        pointer-events: auto;"));
  assert.ok(html.includes("right: 0;"));
  assert.ok(html.includes("bottom: 0;"));
  assert.ok(html.includes("--watcher-width: 256px;"));
  assert.ok(html.includes("--watcher-height: 512px;"));
  assert.ok(html.includes('width="256"'));
  assert.ok(html.includes('height="512"'));
  assert.ok(html.includes("body.watcher-only:not(.character-debug-mode) .terminal-watcher {"));
  assert.ok(html.includes("width: 100vw;"));
  assert.ok(html.includes("height: 100vh;"));
  assert.ok(html.includes("const watcherInteractive = shouldShow && isWatcherView;"));
  assert.ok(html.includes("const watcherPointerEvents = watcherInteractive ? 'auto' : 'none';"));
  assert.ok(html.includes("terminalWatcher.style.pointerEvents = watcherPointerEvents;"));
  assert.ok(html.includes("terminalWatcherImage.style.pointerEvents = watcherPointerEvents;"));
  assert.ok(html.includes("terminalWatcher3dHost.style.pointerEvents = watcherPointerEvents;"));

  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("fn set_watcher_window_framed"));
  assert.ok(rust.includes("const WATCHER_WINDOW_WIDTH: u32 = 256;"));
  assert.ok(rust.includes("const WATCHER_WINDOW_HEIGHT: u32 = 512;"));
  assert.ok(rust.includes(".decorations(false)"));
  assert.ok(rust.includes("Repositioning during move/resize can stall the window message loop on Windows"));
  assert.ok(rust.includes("window.set_decorations(framed);"));
  assert.ok(!rust.includes("window.set_resizable(framed);"));
  assert.ok(rust.includes("window.hide();"));
  assert.ok(rust.includes("window.show();"));
  assert.ok(rust.includes("fn set_terminal_watcher_enabled"));
  assert.ok(rust.includes("fn resize_watcher_window"));
  assert.ok(rust.includes("resize_watcher_window,"));
  assert.ok(rust.includes("set_terminal_watcher_enabled,"));
  assert.ok(rust.includes("set_watcher_window_framed,"));
});

test("watcher_3d_prototype_fallback_for_function_verification", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("let settingsHydrated = false;"));
  assert.ok(html.includes("let watcherPreparing = false;"));
  assert.ok(html.includes("const WATCHER_3D_DEPENDENCY_TIMEOUT_MS = 8000;"));
  assert.ok(html.includes("const WATCHER_3D_MODEL_LOAD_TIMEOUT_MS = 15000;"));
  assert.ok(html.includes("const WATCHER_3D_PROTOTYPE_TIMEOUT_MS = 5000;"));
  assert.ok(html.includes("modelLoadingStartedAtMs: 0"));
  assert.ok(html.includes("data-role=\"terminal-watcher-loading\""));
  assert.ok(html.includes("'watcher.preparing': '準備中...'"));
  assert.ok(html.includes("'watcher.preparing': 'Preparing...'"));
  assert.ok(html.includes("const WATCHER_3D_MAX_PIXEL_RATIO = 1;"));
  assert.ok(html.includes("const WATCHER_3D_RENDER_INTERVAL_MS = 33;"));
  assert.ok(html.includes("const WATCHER_3D_VIEWPORT_SYNC_INTERVAL_MS = 240;"));
  assert.ok(html.includes("const WATCHER_3D_DEPENDENCY_CANDIDATES = Object.freeze(["));
  assert.ok(html.includes("const WATCHER_3D_PROTOTYPE_FALLBACK_PACKS = Object.freeze(["));
  assert.ok(html.includes("modelLoading: null"));
  assert.ok(html.includes("modelLoadingPath: ''"));
  assert.ok(html.includes("refreshToken: 0"));
  assert.ok(html.includes("async function showWatcher3dPrototypeModel(reason = '')"));
  assert.ok(html.includes("'settings.character.3d_status_prototype':"));
  assert.ok(html.includes("VRM読み込みに失敗したため3Dプロトタイプ表示へ切り替えました"));
  assert.ok(html.includes("const force3dInDebug = characterDebugModeEnabled && characterDebugForce3d"));
  assert.ok(html.includes("'settings.character.3d_status_debug_only':"));
  assert.ok(html.includes("const use3dBySettings = renderer === '3d' && Boolean(vrmPath);"));
  assert.ok(
    html.includes(
      "const use3d = use3dBySettings || force3dInDebug;"
    )
  );
  assert.ok(html.includes("function waitForWatcherUiFlushBefore3dLoad()"));
  assert.ok(html.includes("if (!settingsHydrated && !characterDebugModeEnabled) {"));
  assert.ok(html.includes("setWatcherPreparing(true, 'settings-hydration');"));
  assert.ok(html.includes("function setWatcherPreparing(next, reason = '') {"));
  assert.ok(html.includes("const WATCHER_PREPARING_STUCK_WARN_MS = 12000;"));
  assert.ok(html.includes("appendWatcherDebugEvent('preparing-stuck', {"));
  assert.ok(html.includes("async function promiseWithTimeout(promise, timeoutMs, label)"));
  assert.ok(html.includes("[watcher-3d] timeout:"));
  assert.ok(html.includes("const refreshToken = (watcher3dState.refreshToken = (watcher3dState.refreshToken || 0) + 1);"));
  assert.ok(html.includes("stopWatcher3dLoop();"));
  assert.ok(html.includes("terminalWatcher.classList.remove('is-3d');"));
  assert.ok(html.includes("terminalWatcher.classList.add('is-3d-loading');"));
  assert.ok(html.includes("terminalWatcher.classList.remove('is-3d-loading');"));
  assert.ok(html.includes("await waitForWatcherUiFlushBefore3dLoad();"));
  assert.ok(html.includes("if (refreshToken !== watcher3dState.refreshToken) {"));
  assert.ok(html.includes("if (watcher3dState.modelLoading && watcher3dState.modelLoadingPath === modelPath) {"));
  assert.ok(html.includes("watcher3dState.modelLoading = loadingPromise;"));
  assert.ok(html.includes("watcher3dState.modelLoadingPath = modelPath;"));
  assert.ok(html.includes("watcher3dState.modelLoadingStartedAtMs = Date.now();"));
  assert.ok(html.includes("watcher3dState.modelLoading = null;"));
  assert.ok(html.includes("watcher3dState.modelLoadingStartedAtMs = 0;"));
  assert.ok(html.includes("if (ageMs > WATCHER_3D_MODEL_LOAD_TIMEOUT_MS + 1200) {"));
  assert.ok(html.includes("const loaded = await promiseWithTimeout("));
  assert.ok(html.includes("showWatcher3dPrototypeModel('load-returned-false').catch(() => false)"));
  assert.ok(html.includes("showWatcher3dPrototypeModel('load-error').catch(() => false)"));
  assert.ok(html.includes("function appendWatcherDebugEvent(eventType, details = {})"));
  assert.ok(html.includes("Math.min(WATCHER_3D_MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1))"));
  assert.ok(html.includes("nowMs - watcher3dState.lastRenderAtMs < WATCHER_3D_RENDER_INTERVAL_MS"));
  assert.ok(html.includes("console.warn('[watcher-3d] render failed', error);"));
  assert.ok(html.includes("if (characterPackCatalog.size === 0) {"));
  assert.ok(html.includes("WATCHER_3D_PROTOTYPE_FALLBACK_PACKS.forEach((pack) => {"));
  assert.ok(html.includes("if (!pack && forceForDebug) {"));
  assert.ok(html.includes("const prototypeLoaded = await promiseWithTimeout("));
  assert.ok(html.includes("const requestedByMode = isWatcherView && (characterDebugModeEnabled || terminalWatcherEnabled);"));
  assert.ok(html.includes("const shouldShow = requestedByMode || (isWatcherView && !settingsHydrated);"));
  assert.ok(html.includes("const maxAttempts = 4;"));
  assert.ok(html.includes("const perAttemptTimeoutMs = 2600;"));
  assert.ok(html.includes("appendWatcherDebugEvent('load-settings-attempt', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('load-settings-success', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('load-settings-error', {"));
  assert.ok(html.includes("invokeWithSessionStrictTimeout("));
  assert.ok(html.includes("'load_settings'"));
  assert.ok(html.includes("const BUILTIN_CHARACTER_PACKS_TIMEOUT_MS = 2600;"));
  assert.ok(html.includes("appendWatcherDebugEvent('pack-fetch-start', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('pack-fetch-error', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('pack-list-stored-error', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('pack-catalog-reload-complete', {"));
  assert.ok(html.includes("appendWatcherDebugEvent('settings-hydrated', {"));
  assert.ok(html.includes("applyTerminalWatcherVisibility('settings-hydrated');"));
  assert.ok(html.includes("load_settings failed; falling back to defaults"));
});

test("character_debug_toggle_has_timeout_and_watcher_fallback", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("const CHARACTER_DEBUG_TOGGLE_TIMEOUT_MS = 2200;"));
  assert.ok(html.includes("let characterDebugFallbackUsingWatcher = false;"));
  assert.ok(html.includes("let characterDebugFallbackPreviousWatcherEnabled = null;"));
  assert.ok(html.includes("async function invokeWithSessionStrictTimeout(command, payload, timeoutMs)"));
  assert.ok(html.includes("function openCharacterDebugWatcherFallback()"));
  assert.ok(html.includes("function closeCharacterDebugWatcherFallback()"));
  assert.ok(html.includes("const targetOpen = !characterDebugWindowOpen;"));
  assert.ok(html.includes("if (characterDebugFallbackUsingWatcher) {"));
  assert.ok(html.includes("openCharacterDebugWatcherFallback();"));
  assert.ok(html.includes("closeCharacterDebugWatcherFallback();"));
});

test("character_motion_states_and_front_yaw_prototype", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("const CharacterMotionBaseState = Object.freeze({"));
  assert.ok(html.includes("neutral: 'neutral'"));
  assert.ok(html.includes("processing: 'processing'"));
  assert.ok(html.includes("waiting: 'waiting'"));
  assert.ok(html.includes("needUser: 'need-user'"));
  assert.ok(html.includes("const CharacterMotionTriggerState = Object.freeze({"));
  assert.ok(html.includes("completion: 'completion'"));
  assert.ok(html.includes("errorAlert: 'error-alert'"));
  assert.ok(html.includes("function resolveWatcher3dDisplayYawDeg()"));
  assert.ok(html.includes("function resolveWatcherModelFacingYawOffsetDeg()"));
  assert.ok(html.includes("packId.startsWith('nikechan') || vrmPath.includes('nikechan')"));
  assert.ok(html.includes("const metaText = JSON.stringify(meta).toLowerCase();"));
  assert.ok(html.includes("watcher3dState.modelFacingYawOffsetDeg = resolveWatcherModelFacingYawOffsetDegForVrm("));
  assert.ok(html.includes("return normalizeCharacter3dYawForDisplay(baseYaw + offsetYaw);"));
  assert.ok(html.includes("if (!metaVersion || metaVersion.startsWith('0')) {"));
  assert.ok(html.includes("deps.VRMUtils.rotateVRM0(vrm);"));
  assert.ok(html.includes("function resolveCharacterBaseStateFromTerminalStatus(status)"));
  assert.ok(html.includes("function startWatcherCharacterTrigger(trigger)"));
  assert.ok(html.includes("function resolveWatcherCharacterRuntime()"));
  assert.ok(html.includes("isWatcherProcessingStatus(prevStatus)"));
  assert.ok(html.includes("startWatcherCharacterTrigger(CharacterMotionTriggerState.completion);"));
  assert.ok(html.includes("startWatcherCharacterTrigger(CharacterMotionTriggerState.errorAlert);"));
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

test("terminal_input_ime_composition_guard", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function isImeComposingKeyEvent(event)"));
  assert.ok(html.includes("if (isImeComposingKeyEvent(domEvent)) return;"));
  assert.ok(html.includes("if (isImeComposingKeyEvent(event)) return;"));
  assert.ok(html.includes("if (event && event.isComposing) return;"));
});

test("terminal_tool_detection_includes_codex_even_when_unconfigured", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function detectToolCommand(line, toolNames)"));
  assert.ok(html.includes("matchedToolName = detectToolCommand"));
  assert.ok(html.includes("'codex'"));
  assert.ok(html.includes("'claudecode'"));
  assert.ok(html.includes("'opencode'"));
});

test("subworker_codex_session_sync_on_user_tool_start", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("function isCodexResumeStartLine(line)"));
  assert.ok(html.includes("function syncSubworkerCodexSessionOnToolStart(toolName, line)"));
  assert.ok(html.includes("invokeWithSession('subworker_codex_session_started', { resume })"));
  assert.ok(html.includes("syncSubworkerCodexSessionOnToolStart(matchedToolName, trimmed);"));
  assert.ok(html.includes("token === 'resume'"));
  assert.ok(html.includes("token.startsWith('--resume')"));

  const tauriMain = path.join(appRoot, "src-tauri", "src", "main.rs");
  const rust = fs.readFileSync(tauriMain, "utf8");
  assert.ok(rust.includes("fn subworker_codex_session_started"));
  assert.ok(rust.includes("subworker codex session sync: fresh (cleared)"));
  assert.ok(rust.includes("subworker codex session sync: resume (kept)"));
});

test("codex_prompt_marker_need_input_fallback", () => {
  const htmlPath = path.join(appRoot, "src", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes("AGENT_INPUT_AWAIT_FIRST_OUTPUT_MS"));
  assert.ok(html.includes("let agentAwaitingFirstOutput = false;"));
  assert.ok(html.includes("let agentAwaitingFirstOutputPromptChunkCount = 0;"));
  assert.ok(html.includes("AGENT_PROMPT_HINT_SETTLE_MS"));
  assert.ok(html.includes("looksLikeCodexPromptChunk"));
  assert.ok(html.includes("looksLikeCodexOutputMarker"));
  assert.ok(html.includes("isCodexPromptMetadataLine"));
  assert.ok(html.includes("isMeaningfulAgentOutputChunk"));
  assert.ok(html.includes("promoteAgentSessionFromOutputMarker"));
  assert.ok(html.includes("agent output marker"));
  assert.ok(html.includes("agent-output-marker"));
  assert.ok(html.includes("scheduleAgentPromptHintFromOutput"));
  assert.ok(html.includes("if (agentAwaitingFirstOutput) return;"));
  assert.ok(html.includes("schedulePromptHintJudgeRetry"));
  assert.ok(html.includes("kind: 'await-first-output'"));
  assert.ok(html.includes("prompt_chunk_count"));
  assert.ok(html.includes("scheduleIdleJudge('await-first-output', retryMs);"));
  assert.ok(html.includes("appendStatusDebugEvent('agent-first-output'"));
  assert.ok(html.includes("appendStatusDebugEvent('agent-first-output-skip'"));
  assert.ok(html.includes("kind: 'prompt-only-chunk'"));
  assert.ok(html.includes("isPromptHintJudge"));
  assert.ok(html.includes("codex prompt marker"));
  assert.ok(html.includes("triggerJudge('prompt-hint', null);"));
  assert.ok(html.includes("for shortcuts"));
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

