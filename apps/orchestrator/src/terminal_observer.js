/* eslint-disable no-var */
// Terminal observation utilities (P0).
// 繧ｿ繝ｼ繝溘リ繝ｫ隕ｳ貂ｬ繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ・・0・峨・//
// Goals / 逶ｮ逧・
// - Keep the core logic pure & testable in Node.
//   繧ｳ繧｢繝ｭ繧ｸ繝・け繧堤ｴ皮ｲ矩未謨ｰ縺ｫ縺励※ Node 縺ｧ繝・せ繝医〒縺阪ｋ繧医≧縺ｫ縺吶ｋ縲・// - Provide a browser-friendly global (`window.TerminalObserver`) without bundlers.
//   繝舌Φ繝峨Λ辟｡縺励〒繧ゆｽｿ縺医ｋ繧医≧縺ｫ `window.TerminalObserver` 繧呈署萓帙☆繧九・
(function factory(root, init) {
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = init();
    return;
  }
  root.TerminalObserver = init();
})(typeof window !== 'undefined' ? window : globalThis, function init() {
  'use strict';

  var ObservationState = Object.freeze({
    idle: 'idle',
    running: 'running',
    needInput: 'need-input',
    success: 'success',
    fail: 'fail',
  });

  // P0 defaults (hard-coded OK for now).
  var DEFAULT_THRESHOLDS_MS = Object.freeze({
    observeTickMs: 1000,
  });

  function tailForObservation(text, maxChars) {
    if (!text) return '';
    var limit = typeof maxChars === 'number' ? maxChars : 400;
    var normalized = String(text).replace(/\r\n/g, '\n');
    return normalized.slice(Math.max(0, normalized.length - limit));
  }

  function stripAnsi(text) {
    if (!text) return '';
    return String(text)
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b./g, '');
  }

  function looksLikeNeedInput(tail) {
    if (!tail) return false;
    // Heuristic prompt detection (limited to avoid false positives).
    var needle = stripAnsi(tail).toLowerCase();
    return (
      needle.includes('press enter') ||
      needle.includes('press return') ||
      needle.includes('[y/n]') ||
      needle.includes('(y/n)') ||
      needle.includes('continue?') ||
      needle.includes('password:') ||
      needle.includes('are you sure') ||
      /\b(y\/n)\b/i.test(tail)
    );
  }

  function looksLikeShellPrompt(tail) {
    if (!tail) return false;
    var cleaned = stripAnsi(tail);
    var trimmedAll = cleaned.replace(/\s+$/g, '');
    if (!trimmedAll) return false;
    var lines = cleaned.split('\n');
    var last = lines[lines.length - 1] || '';
    var trimmed = last.trim();
    if (trimmed) {
      if (/^PS\s+.+>\s*$/.test(trimmed)) return true;
      if (/^[A-Za-z]:[\\/].*>\s*$/.test(trimmed)) return true;
      if (/^[^@\s]+@[^\s]+:.*[#$]\s*$/.test(trimmed)) return true;
      if (/[^\s][#$]\s*$/.test(trimmed)) return true;
    }
    if (/PS\s+.+>\s*$/.test(trimmedAll)) return true;
    if (/[A-Za-z]:[\\/][^\r\n]*>\s*$/.test(trimmedAll)) return true;
    if (/[^@\s]+@[^\s]+:[^\r\n]*[#$]\s*$/.test(trimmedAll)) return true;
    return false;
  }

  function computeState(input) {
    var nowMs = input && typeof input.nowMs === 'number' ? input.nowMs : Date.now();
    var lastOutputAtMs =
      input && typeof input.lastOutputAtMs === 'number' ? input.lastOutputAtMs : nowMs;
    var lastTail = (input && input.lastTail) || '';
    var exitCode = input && Object.prototype.hasOwnProperty.call(input, 'exitCode') ? input.exitCode : null;
    var commandActive = input && Object.prototype.hasOwnProperty.call(input, 'commandActive')
      ? Boolean(input.commandActive)
      : true;

    if (exitCode !== null && exitCode !== undefined) {
      if (exitCode === 0) {
        return { state: ObservationState.success, reason: 'exit 0', idleMs: 0 };
      }
      return { state: ObservationState.fail, reason: 'exit non-zero', idleMs: 0 };
    }

    var idleMs = Math.max(0, nowMs - lastOutputAtMs);
    if (looksLikeNeedInput(lastTail)) {
      return { state: ObservationState.needInput, reason: 'prompt-like tail', idleMs: idleMs };
    }
    if (!commandActive) {
      return { state: ObservationState.idle, reason: 'idle', idleMs: idleMs };
    }
    if (looksLikeShellPrompt(lastTail)) {
      return { state: ObservationState.success, reason: 'shell prompt', idleMs: idleMs };
    }
    return { state: ObservationState.running, reason: 'running', idleMs: idleMs };
  }

  function assetPathForState(state) {
    switch (state) {
      case ObservationState.success:
        return 'assets/watcher/nagomisan_full_idle.png';
      case ObservationState.fail:
        return 'assets/watcher/nagomisan_full_fail.png';
      case ObservationState.needInput:
        return 'assets/watcher/nagomisan_full_need-input.png';
      case ObservationState.running:
        return 'assets/watcher/nagomisan_full_running.png';
      case ObservationState.idle:
        return 'assets/watcher/nagomisan_full_idle.png';
      default:
        return 'assets/watcher/nagomisan_full_idle.png';
    }
  }

  return Object.freeze({
    ObservationState: ObservationState,
    DEFAULT_THRESHOLDS_MS: DEFAULT_THRESHOLDS_MS,
    tailForObservation: tailForObservation,
    looksLikeNeedInput: looksLikeNeedInput,
    looksLikeShellPrompt: looksLikeShellPrompt,
    computeState: computeState,
    TerminalStateDetector: Object.freeze({
      computeState: computeState,
      tailForObservation: tailForObservation,
      looksLikeNeedInput: looksLikeNeedInput,
    }),
    assetPathForState: assetPathForState,
  });
});

