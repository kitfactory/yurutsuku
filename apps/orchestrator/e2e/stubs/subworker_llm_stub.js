#!/usr/bin/env node
/**
 * Minimal stub tool for nagomi subworker E2E.
 * Reads prompt from stdin (ignored) and prints a single JSON object to stdout.
 *
 * NOTE: Must output JSON only, last line is used by parser.
 */

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += String(chunk || "");
});
process.stdin.on("end", () => {
  // Intentionally return advice_markdown WITHOUT "次に入力:" to validate app-side enforcement.
  // Also include a long token to validate the clamp length change.
  const obj = {
    action: "show_advice",
    confidence: 0.9,
    input: "1\r",
    advice_markdown:
      "1/2 の選択肢が見えているなら、まず選択して進めてください。LONGTOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789",
    reason: "e2e stub",
  };
  process.stdout.write(JSON.stringify(obj) + "\n");
});
process.stdin.resume();

