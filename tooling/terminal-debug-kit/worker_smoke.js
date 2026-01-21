const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { parseLine, serializeMessage } = require("../../packages/protocol/src/index.js");

function resolveWorkerPath() {
  const exeName = process.platform === "win32" ? "yurutsuku-worker.exe" : "yurutsuku-worker";
  const repoRoot = path.join(__dirname, "..", "..");
  const candidate = path.join(repoRoot, "target", "debug", exeName);
  return fs.existsSync(candidate) ? candidate : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    cmd: process.platform === "win32" ? "cmd.exe" : "sh",
    text: process.platform === "win32" ? "echo ok\r\n" : "echo ok\n",
    token: "ok",
    timeoutMs: 3000,
    out: path.join(__dirname, "worker_smoke.ndjson"),
    sessionId: `session-${Date.now()}`,
    build: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--cmd") options.cmd = args[i + 1] || options.cmd;
    if (arg === "--text") options.text = args[i + 1] || options.text;
    if (arg === "--token") options.token = args[i + 1] || options.token;
    if (arg === "--timeout-ms") options.timeoutMs = Number(args[i + 1] || options.timeoutMs);
    if (arg === "--out") options.out = args[i + 1] || options.out;
    if (arg === "--session-id") options.sessionId = args[i + 1] || options.sessionId;
    if (arg === "--build") options.build = true;
  }
  return options;
}

function ensureWorkerBinary(workerPath, shouldBuild) {
  if (workerPath) return workerPath;
  if (!shouldBuild) {
    throw new Error("worker binary not found; run with --build or build manually");
  }
  const repoRoot = path.join(__dirname, "..", "..");
  const build = spawnSync("cargo", ["build", "-p", "yurutsuku-worker"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error("failed to build worker binary");
  }
  const built = resolveWorkerPath();
  if (!built) {
    throw new Error("worker binary still missing after build");
  }
  return built;
}

async function main() {
  const options = parseArgs();
  const workerPath = ensureWorkerBinary(resolveWorkerPath(), options.build);
  const outStream = fs.createWriteStream(options.out, { flags: "w" });
  const child = spawn(workerPath, { stdio: ["pipe", "pipe", "inherit"] });

  const rl = readline.createInterface({ input: child.stdout });
  let sawToken = false;
  let exitCode = null;
  let rejectEarly = null;
  let resolveDone = null;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectEarly = reject;
  });

  const timer = setTimeout(() => {
    rejectEarly(new Error("timeout waiting for output token"));
  }, options.timeoutMs);

  rl.on("line", (line) => {
    outStream.write(`${line}\n`);
    const message = parseLine(line);
    if (message.type === "output") {
      const chunk = String(message.chunk || "").toLowerCase();
      if (chunk.includes(options.token.toLowerCase())) {
        sawToken = true;
        clearTimeout(timer);
        resolveDone();
      }
    }
    if (message.type === "exit") {
      exitCode = message.exit_code;
    }
    if (message.type === "error") {
      clearTimeout(timer);
      rejectEarly(new Error(`worker error: ${message.message}`));
    }
  });

  child.on("exit", (code) => {
    if (!sawToken) {
      rejectEarly(new Error(`worker exited before output (code ${code ?? "unknown"})`));
    }
  });

  // セッション開始を送る / Send start session.
  child.stdin.write(
    serializeMessage({
      type: "start_session",
      session_id: options.sessionId,
      cmd: options.cmd,
      cols: 120,
      rows: 30,
    })
  );

  // 入力送信まで少し待つ / Wait briefly before sending input.
  setTimeout(() => {
    child.stdin.write(
      serializeMessage({
        type: "send_input",
        session_id: options.sessionId,
        text: options.text,
      })
    );
  }, 100);

  try {
    await done;
    console.log(`[worker_smoke] output token "${options.token}" received`);
  } catch (err) {
    console.error(`[worker_smoke] failed: ${err.message}`);
  }

  child.stdin.write(
    serializeMessage({
      type: "stop_session",
      session_id: options.sessionId,
    })
  );

  setTimeout(() => {
    rl.close();
    outStream.end();
    if (!child.killed) child.kill();
    if (exitCode !== null) {
      console.log(`[worker_smoke] exit_code=${exitCode}`);
    }
    process.exitCode = sawToken ? 0 : 1;
  }, 300);
}

main().catch((err) => {
  console.error(`[worker_smoke] error: ${err.message}`);
  process.exitCode = 1;
});
