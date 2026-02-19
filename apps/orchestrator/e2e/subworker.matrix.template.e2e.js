const path = require("node:path");
const fs = require("node:fs");

const repoRoot = path.join(__dirname, "..", "..", "..");
const sandboxRoot = path.join(__dirname, "sandbox", "isolated-workdir");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowTag() {
  const ts = Date.now();
  return `run-${ts}`;
}

function main() {
  ensureDir(sandboxRoot);

  const runDir = path.join(sandboxRoot, nowTag());
  const appConfigDir = path.join(runDir, "app-config");
  const appDataDir = path.join(runDir, "appdata");
  const hooksDir = path.join(runDir, "hooks");
  ensureDir(appConfigDir);
  ensureDir(appDataDir);
  ensureDir(hooksDir);

  const template = {
    run_dir: runDir,
    env: {
      // On Windows, APPDATA controls Tauri app_config_dir location (logs/settings).
      APPDATA: appDataDir,
      // Prefer app-config override for stable isolation across platforms.
      NAGOMI_APP_CONFIG_DIR: appConfigDir,
      NAGOMI_HOOKS_DIR: hooksDir,
      NAGOMI_ENABLE_TEST_ENDPOINTS: "1",
    },
    cases: [
      {
        id: "S1",
        name: "careful + advice",
        mode: "careful",
        expected: {
          final_state: "need_input",
          subworker_action: "show_advice",
        },
      },
      {
        id: "S2",
        name: "careful + delegate",
        mode: "careful",
        expected: {
          final_state: "need_input",
          subworker_action: "delegate_input",
        },
      },
      {
        id: "S3",
        name: "gangan + fail runs",
        mode: "gangan",
        expected: {
          final_state: "failure",
          subworker_action: "show_advice",
        },
      },
      {
        id: "S4",
        name: "advice-only",
        mode: "advice",
        expected: {
          final_state: "need_input",
          subworker_action: "show_advice",
        },
      },
    ],
    notes: [
      "This is a template. Fill in concrete steps/inputs as needed.",
      "Run `node e2e/codex.prime-minister.e2e.js` with NAGOMI_E2E_ISOLATED_DIR=run_dir to execute inside this run directory.",
    ],
  };

  const outPath = path.join(runDir, "scenario-matrix.template.json");
  fs.writeFileSync(outPath, JSON.stringify(template, null, 2), "utf8");

  console.log("[e2e] matrix template generated", {
    outPath,
    runDir,
    appConfigDir,
    appDataDir,
    hooksDir,
  });
}

main();
