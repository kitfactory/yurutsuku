const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const { Builder, Capabilities, until, By } = require("selenium-webdriver");
const { ensureDriversOnPath, resolveTauriDriverPath, resolveMsEdgeDriverPath } = require("./driver_paths");
const { openAndSwitchToTerminalWindow } = require("./terminal_window_helper");

const repoRoot = path.join(__dirname, "..", "..", "..");
process.env.NAGOMI_ENABLE_TEST_ENDPOINTS =
  process.env.NAGOMI_ENABLE_TEST_ENDPOINTS || "1";

function resolveHealthPort() {
  const raw = process.env.NAGOMI_ORCH_HEALTH_PORT;
  if (!raw) return 17707;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 17707;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fn();
    if (ok) return;
    await sleep(200);
  }
  throw new Error("timeout waiting for condition");
}

async function invokeTauri(client, command, payload) {
  const result = await client.executeAsyncScript(
    function (command, payload, done) {
      const invoke =
        (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
        (window.__TAURI__ && window.__TAURI__.invoke);
      if (!invoke) {
        done({ error: "invoke not available" });
        return;
      }
      invoke(command, payload)
        .then((data) => done({ ok: true, data }))
        .catch((err) => done({ error: String(err) }));
    },
    command,
    payload
  );
  if (!result || result.error) {
    throw new Error(result && result.error ? result.error : `${command} failed`);
  }
  return result.data;
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

function resetDebugFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing file
  }
}

function readJsonl(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function findLastEvent(entries, predicate) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (predicate(entry)) return entry;
  }
  return null;
}

async function ensureTestHooks(client) {
  await client.executeScript("if (typeof registerTestHooks === 'function') registerTestHooks();");
  await waitFor(async () => {
    const ok = await client
      .executeScript("return Boolean(window.nagomiTest && window.nagomiTest.getInternalState);")
      .catch(() => false);
    return Boolean(ok);
  }, 10000);
}

async function getIpcSessionIdFromInternalState(client) {
  const internal = await client.executeScript(
    "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
  );
  return internal && typeof internal.ipcSessionId === "string" && internal.ipcSessionId
    ? internal.ipcSessionId
    : null;
}

async function openAndSetIpcSessionId(client) {
  const snapshot = await invokeTauri(client, "ipc_session_open", {
    clientEpoch: Date.now(),
  });
  const sessionId = snapshot && snapshot.sessionId ? snapshot.sessionId : null;
  if (!sessionId) {
    throw new Error("ipc session id not ready");
  }
  await client.executeScript(
    "window.__ipcSessionId = arguments[0]; if (typeof ipcSessionId !== 'undefined') { ipcSessionId = arguments[0]; }",
    sessionId
  );
  return sessionId;
}

async function getTerminalSessionId(client) {
  return await client.executeScript(
    "return window.nagomiTest && window.nagomiTest.getTerminalSessionId ? window.nagomiTest.getTerminalSessionId() : null;"
  );
}

async function emitHookJudgeComplete(client, payload) {
  return await client.executeScript(
    "return window.nagomiTest && window.nagomiTest.emitHookState ? window.nagomiTest.emitHookState(arguments[0]) : false;",
    payload
  );
}

async function triggerSubworkerJudgeComplete(client, payload) {
  return await client.executeScript(
    "return window.nagomiTest && window.nagomiTest.triggerSubworkerJudgeComplete ? window.nagomiTest.triggerSubworkerJudgeComplete(arguments[0]) : false;",
    payload
  );
}

async function callQueueSubworkerOnJudgeCompleted(client, state, reason, trigger) {
  return await client.executeScript(
    "return typeof queueSubworkerOnJudgeCompleted === 'function' ? (queueSubworkerOnJudgeCompleted(arguments[0], arguments[1], arguments[2]), true) : false;",
    state,
    reason,
    trigger
  );
}

async function callApplyFallbackJudge(client, reason, hookKind) {
  return await client.executeScript(
    "return typeof applyFallbackJudge === 'function' ? (applyFallbackJudge(arguments[0], arguments[1]), true) : false;",
    reason,
    hookKind
  );
}

async function waitForSubworkerDecisionCount(client, minCount, timeoutMs) {
  await waitFor(async () => {
    const internal = await client.executeScript(
      "return window.nagomiTest && window.nagomiTest.getInternalState ? window.nagomiTest.getInternalState() : null;"
    );
    const count =
      internal &&
      internal.subworker &&
      internal.subworker.decisions &&
      Array.isArray(internal.subworker.decisions)
        ? internal.subworker.decisions.length
        : 0;
    return count >= minCount;
  }, timeoutMs);
}

async function waitForSettingsApplied(client, expected, timeoutMs) {
  await waitFor(async () => {
    const snapshot = await client.executeScript(`
      try {
        return {
          llmEnabled: typeof llmEnabled !== 'undefined' ? Boolean(llmEnabled) : null,
          llmTool: typeof settingsState !== 'undefined' && settingsState ? String(settingsState.llm_tool || '') : '',
          subworkerEnabled: typeof settingsState !== 'undefined' && settingsState ? Boolean(settingsState.subworker_enabled) : null,
          subworkerDebugEnabled: typeof settingsState !== 'undefined' && settingsState ? Boolean(settingsState.subworker_debug_enabled) : null,
          statusDebugEnabled: typeof settingsState !== 'undefined' && settingsState ? Boolean(settingsState.status_debug_enabled) : null,
          subworkerMode: typeof settingsState !== 'undefined' && settingsState ? String(settingsState.subworker_mode || '') : '',
          threshold: typeof settingsState !== 'undefined' && settingsState ? Number(settingsState.subworker_confidence_threshold) : null
        };
      } catch {
        return null;
      }
    `);
    if (!snapshot) return false;
    if (expected.llmEnabled !== undefined && snapshot.llmEnabled !== expected.llmEnabled) return false;
    if (expected.llmTool && snapshot.llmTool !== expected.llmTool) return false;
    if (expected.subworkerEnabled !== undefined && snapshot.subworkerEnabled !== expected.subworkerEnabled) return false;
    if (expected.subworkerDebugEnabled !== undefined && snapshot.subworkerDebugEnabled !== expected.subworkerDebugEnabled) return false;
    if (expected.statusDebugEnabled !== undefined && snapshot.statusDebugEnabled !== expected.statusDebugEnabled) return false;
    if (expected.subworkerMode && snapshot.subworkerMode !== expected.subworkerMode) return false;
    if (expected.threshold !== undefined && Number(snapshot.threshold) !== Number(expected.threshold)) return false;
    return true;
  }, timeoutMs);
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

async function main() {
  const targetApp = appPath();
  if (!exists(targetApp)) {
    throw new Error(`app binary not found: ${targetApp}`);
  }

  // Avoid colliding with a background orchestrator on default port.
  if (!process.env.NAGOMI_ORCH_HEALTH_PORT) {
    const port = await pickFreePort();
    process.env.NAGOMI_ORCH_HEALTH_PORT = String(port);
  }
  // Force tool_judge to fail deterministically for the judge-fallback case.
  if (!process.env.NAGOMI_TOOL_PATH) {
    process.env.NAGOMI_TOOL_PATH = "C:\\__nagomi_missing_tool__.exe";
  }

  const { tauriPath, edgePath } = ensureDriversOnPath();
  if (process.platform === "win32" && !tauriPath) {
    throw new Error("tauri-driver not found (set NAGOMI_TAURI_DRIVER or update PATH)");
  }
  if (process.platform === "win32" && !edgePath) {
    throw new Error("msedgedriver not found (set NAGOMI_EDGE_DRIVER or update PATH)");
  }
  const driverPort = 4444;
  const driver = spawn(tauriPath || resolveTauriDriverPath(), ["--port", String(driverPort)], {
    stdio: "inherit",
  });

  let client = null;
  let previousSettings = null;
  let debugFile = "";
  let statusFile = "";

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

    const opened = await openAndSwitchToTerminalWindow(client, `e2e-subworker-${Date.now()}`, 20000);
    await client.switchTo().window(opened.handle);
    await client.wait(until.elementLocated(By.css("#terminal-container")), 20000);

    await ensureTestHooks(client);
    const sessionId = await getTerminalSessionId(client);
    if (!sessionId) {
      throw new Error("terminal session id not found");
    }

    await waitFor(async () => {
      const readiness = await client.executeScript(`
        const internal = window.nagomiTest && window.nagomiTest.getInternalState
          ? window.nagomiTest.getInternalState()
          : null;
        return {
          terminalInitialized: typeof terminalInitialized !== 'undefined' ? terminalInitialized : false,
          ipcSessionId: internal ? internal.ipcSessionId : null
        };
      `);
      return Boolean(
        readiness &&
          readiness.terminalInitialized &&
          typeof readiness.ipcSessionId === "string" &&
          readiness.ipcSessionId.length > 0
      );
    }, 20000);

    // Force a fresh ipc session id (and ensure invokeWithSession sees it).
    const ipcSessionId = await openAndSetIpcSessionId(client);

    previousSettings = await invokeTauri(client, "load_settings", { ipcSessionId });
    if (!previousSettings) {
      throw new Error("settings not loaded");
    }

    // Enable AI judge + subworker (debug on) for deterministic subworker decisions.
    const baseSettings = {
      ...previousSettings,
      llm_enabled: true,
      // Use non-codex tool key; tool_judge falls back without external tools when NAGOMI_TOOL_ARGS is empty.
      llm_tool: "claude",
      subworker_enabled: true,
      subworker_debug_enabled: true,
      status_debug_enabled: true,
      subworker_confidence_threshold: 0.99,
      silence_timeout_ms: 300,
    };
    await invokeTauri(client, "save_settings", { ipcSessionId, settings: baseSettings });
    await waitForSettingsApplied(
      client,
      {
        llmEnabled: true,
        llmTool: "claude",
        subworkerEnabled: true,
        subworkerDebugEnabled: true,
        statusDebugEnabled: true,
        threshold: 0.99,
      },
      20000
    );

    // Resolve the actual debug file path from backend (do not assume APPDATA layout).
    const probePath = await invokeTauri(client, "append_subworker_debug_event", {
      ipcSessionId,
      payload: { source: "e2e", event_type: "probe" },
    });
    debugFile = typeof probePath === "string" ? probePath : "";
    if (!debugFile) {
      throw new Error("subworker debug file path not returned");
    }
    resetDebugFile(debugFile);

    const statusProbePath = await invokeTauri(client, "append_status_debug_event", {
      ipcSessionId,
      payload: { source: "e2e", event_type: "probe" },
    });
    statusFile = typeof statusProbePath === "string" ? statusProbePath : "";
    if (!statusFile) {
      throw new Error("status debug file path not returned");
    }
    resetDebugFile(statusFile);

    const cases = [
      {
        name: "careful need_input runs",
        mode: "careful",
        state: "need_input",
        trigger: "hook-judge",
        expectRun: true,
      },
      {
        name: "careful success runs",
        mode: "careful",
        state: "success",
        trigger: "hook-judge",
        expectRun: true,
      },
      {
        name: "gangan success runs",
        mode: "gangan",
        state: "success",
        trigger: "hook-judge",
        expectRun: true,
      },
      {
        name: "gangan failure runs",
        mode: "gangan",
        state: "failure",
        trigger: "hook-judge",
        expectRun: true,
      },
      {
        name: "advice failure runs (no delegate)",
        mode: "advice",
        state: "failure",
        trigger: "hook-judge",
        expectRun: true,
      },
      {
        name: "judge-fallback accepted",
        mode: "careful",
        state: "need_input",
        trigger: "judge-fallback",
        expectRun: true,
      },
    ];

    let decisionFloor = 0;
    const caseReports = [];
    for (const entry of cases) {
      const settings = {
        ...baseSettings,
        subworker_mode: entry.mode,
        llm_tool: entry.trigger === "judge-fallback" ? "codex" : baseSettings.llm_tool,
      };
      await invokeTauri(client, "save_settings", { ipcSessionId, settings });
      await waitForSettingsApplied(
        client,
        {
          subworkerMode: entry.mode,
          llmEnabled: true,
          subworkerEnabled: true,
          llmTool: settings.llm_tool,
        },
        20000
      );

      const before = readJsonl(debugFile).length;
      const reason = `e2e ${entry.name}`;

      if (entry.trigger === "hook-judge") {
        await emitHookJudgeComplete(client, {
          source: "e2e",
          kind: entry.state === "need_input" ? "need_input" : "completed",
          source_session_id: sessionId,
          judge_state: entry.state,
          summary: reason,
        });
      } else if (entry.trigger === "judge-fallback") {
        const ok = await triggerSubworkerJudgeComplete(client, {
          state: entry.state,
          reason,
          source: "judge-fallback",
        });
        if (!ok) {
          throw new Error("nagomiTest.triggerSubworkerJudgeComplete unavailable");
        }
      } else {
        await callQueueSubworkerOnJudgeCompleted(client, entry.state, reason, entry.trigger);
      }

      // Allow subworker to run; it is async.
      const minDelta = entry.expectRun ? 2 : 1;
      try {
        await waitFor(async () => readJsonl(debugFile).length >= before + minDelta, 20000);
      } catch (err) {
        const diag = await client.executeScript(`
          try {
            const internal = window.nagomiTest && window.nagomiTest.getInternalState
              ? window.nagomiTest.getInternalState()
              : null;
            return {
              llmEnabled: typeof llmEnabled !== 'undefined' ? Boolean(llmEnabled) : null,
              subworkerPhase: internal && internal.subworker ? internal.subworker.phase : null,
              subworkerEnabled: internal && internal.subworker ? internal.subworker.enabled : null,
              subworkerDebugEnabled: internal && internal.subworker ? internal.subworker.debug_enabled : null,
              subworkerMode: internal && internal.subworker ? internal.subworker.mode : null,
              lastResult: internal && internal.subworker ? internal.subworker.result : null,
              lastReason: internal && internal.subworker ? internal.subworker.reason : null,
              debugLogPath: internal && internal.subworker ? internal.subworker.debugLogPath : null,
              status: internal ? internal.statusState : null
            };
          } catch (e) {
            return { error: String(e) };
          }
        `);
        throw new Error(
          `[${entry.name}] debug events timeout: ${String(err)} diag=${JSON.stringify(diag)} file=${debugFile}`
        );
      }

      const afterEntries = readJsonl(debugFile);
      const after = afterEntries.length;
      if (after <= before) {
        throw new Error(`[${entry.name}] debug events not appended: ${debugFile}`);
      }
      const last = findLastEvent(afterEntries, (ev) => ev && ev.source === "subworker");
      if (!last) {
        throw new Error(`[${entry.name}] last subworker event missing`);
      }
      if (entry.trigger === "judge-fallback") {
        if (last.judge_complete_source !== "judge-fallback") {
          throw new Error(
            `[${entry.name}] judge_complete_source mismatch: ${JSON.stringify(last)}`
          );
        }
      }
      if (last.judge_complete_event && last.judge_complete_event !== "judge-complete") {
        throw new Error(
          `[${entry.name}] judge_complete_event mismatch: ${JSON.stringify(last)}`
        );
      }

      if (entry.expectRun) {
        const lastResult = findLastEvent(afterEntries, (ev) => ev && ev.event_type === "result");
        if (!lastResult) {
          throw new Error(`[${entry.name}] result event missing`);
        }
        if (entry.mode === "advice") {
          const action =
            lastResult &&
            lastResult.details &&
            typeof lastResult.details.action === "string"
              ? lastResult.details.action
              : "";
          if (action && action !== "show_advice") {
            throw new Error(`[${entry.name}] advice mode delegated: ${JSON.stringify(lastResult)}`);
          }
        }
      } else {
        const lastSkip = findLastEvent(afterEntries, (ev) => ev && String(ev.event_type).startsWith("skip-"));
        if (!lastSkip) {
          throw new Error(`[${entry.name}] expected skip event, none found`);
        }
      }

      const lastResult = findLastEvent(afterEntries, (ev) => ev && ev.event_type === "result");
      const lastSkip = findLastEvent(afterEntries, (ev) => ev && String(ev.event_type).startsWith("skip-"));
      const selected = entry.expectRun ? lastResult : lastSkip;
      caseReports.push({
        name: entry.name,
        mode: entry.mode,
        state: entry.state,
        trigger: entry.trigger,
        expectRun: entry.expectRun,
        beforeCount: before,
        afterCount: after,
        lastEventType: selected ? selected.event_type : null,
        lastAction:
          selected &&
          selected.details &&
          typeof selected.details.action === "string"
            ? selected.details.action
            : null,
        lastResult:
          selected &&
          selected.details &&
          typeof selected.details.result === "string"
            ? selected.details.result
            : null,
      });

      await sleep(1100);
    }

    const statusEntries = readJsonl(statusFile);
    const statusUiEntries = statusEntries.filter((ev) => ev && ev.source === "status");
    if (!statusUiEntries.some((ev) => ev && ev.event_type === "state-transition")) {
      throw new Error(`[e2e] status log missing state-transition: ${statusFile}`);
    }
    if (!statusUiEntries.some((ev) => ev && ev.event_type === "hook-event")) {
      throw new Error(`[e2e] status log missing hook-event: ${statusFile}`);
    }

    const tmpDir = path.join(repoRoot, "apps", "orchestrator", "tmp-e2e");
    ensureDir(tmpDir);
    const reportPath = path.join(tmpDir, `subworker-matrix-${Date.now()}.json`);
    const report = {
      ts_ms: Date.now(),
      app: targetApp,
      health_port: Number(process.env.NAGOMI_ORCH_HEALTH_PORT || 0) || null,
      debug_file: debugFile,
      status_file: statusFile,
      cases: caseReports,
      status_summary: {
        total: statusEntries.length,
        state_transition: statusUiEntries.filter((ev) => ev && ev.event_type === "state-transition").length,
        hook_event: statusUiEntries.filter((ev) => ev && ev.event_type === "hook-event").length,
        judge_result: statusUiEntries.filter((ev) => ev && ev.event_type === "judge-result").length,
        judge_fallback: statusUiEntries.filter((ev) => ev && ev.event_type === "judge-fallback").length,
      },
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log("[e2e] subworker matrix OK", { debugFile, statusFile, reportPath });
  } finally {
    if (client) {
      if (previousSettings) {
        try {
          const ipcSessionId =
            (await client.executeScript("return window.__ipcSessionId || null;")) ||
            (await getIpcSessionIdFromInternalState(client));
          if (ipcSessionId) {
            await invokeTauri(client, "save_settings", {
              ipcSessionId,
              settings: previousSettings,
            });
          }
        } catch {
          // ignore
        }
      }
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
