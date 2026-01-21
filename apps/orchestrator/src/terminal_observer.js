/* eslint-disable no-var */
// Terminal observation utilities (P0).
// ターミナル観測ユーティリティ（P0）。
//
// Goals / 目的:
// - Keep the core logic pure & testable in Node.
//   コアロジックを純粋関数にして Node でテストできるようにする。
// - Provide a browser-friendly global (`window.TerminalObserver`) without bundlers.
//   バンドラ無しでも使えるように `window.TerminalObserver` を提供する。

(function factory(root, init) {
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = init();
    return;
  }
  root.TerminalObserver = init();
})(typeof window !== 'undefined' ? window : globalThis, function init() {
  'use strict';

  var ObservationState = Object.freeze({
    running: 'running',
    needInput: 'need-input',
    stalled: 'stalled',
    success: 'success',
    fail: 'fail',
  });

  // P0 defaults (hard-coded OK for now).
  // P0 既定値（当面ハードコードでOK）。
  var DEFAULT_THRESHOLDS_MS = Object.freeze({
    observeTickMs: 1000,
    needInputMs: 15 * 1000,
    stalledMs: 60 * 1000,
  });

  function tailForObservation(text, maxChars) {
    if (!text) return '';
    var limit = typeof maxChars === 'number' ? maxChars : 400;
    var normalized = String(text).replace(/\r\n/g, '\n');
    return normalized.slice(Math.max(0, normalized.length - limit));
  }

  function looksLikeNeedInput(tail) {
    if (!tail) return false;
    // Heuristic prompt detection (limited to avoid false positives).
    // 限定的なプロンプト検知（誤爆回避優先）。
    var needle = String(tail).toLowerCase();
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

  /**
   * Compute observed state.
   * 観測状態を計算する。
   *
   * @param {object} input
   * @param {number} input.nowMs - current time (ms)
   * @param {number} input.lastOutputAtMs - last output time (ms)
   * @param {string} input.lastTail - tail text (recent output)
   * @param {number|null} input.exitCode - exit code or null when alive
   * @param {object} [input.thresholdsMs] - override thresholds
   * @returns {{state:string, reason:string, idleMs:number}}
   */
  function computeState(input) {
    var nowMs = input && typeof input.nowMs === 'number' ? input.nowMs : Date.now();
    var lastOutputAtMs =
      input && typeof input.lastOutputAtMs === 'number' ? input.lastOutputAtMs : nowMs;
    var lastTail = (input && input.lastTail) || '';
    var exitCode = input && Object.prototype.hasOwnProperty.call(input, 'exitCode') ? input.exitCode : null;
    var thresholds = (input && input.thresholdsMs) || DEFAULT_THRESHOLDS_MS;

    if (exitCode !== null && exitCode !== undefined) {
      if (exitCode === 0) {
        return { state: ObservationState.success, reason: 'exit 0', idleMs: 0 };
      }
      return { state: ObservationState.fail, reason: 'exit non-zero', idleMs: 0 };
    }

    var idleMs = Math.max(0, nowMs - lastOutputAtMs);
    if (idleMs >= thresholds.needInputMs && looksLikeNeedInput(lastTail)) {
      return { state: ObservationState.needInput, reason: 'prompt-like tail + idle', idleMs: idleMs };
    }
    if (idleMs >= thresholds.stalledMs) {
      return { state: ObservationState.stalled, reason: 'idle', idleMs: idleMs };
    }
    return { state: ObservationState.running, reason: 'recent output', idleMs: idleMs };
  }

  function assetPathForState(state) {
    switch (state) {
      case ObservationState.success:
        return 'assets/watcher/nagomisan_success.png';
      case ObservationState.fail:
        return 'assets/watcher/nagomisan_fail.png';
      case ObservationState.needInput:
        return 'assets/watcher/nagomisan_need-input.png';
      case ObservationState.stalled:
        return 'assets/watcher/nagomisan_stalled.png';
      default:
        return 'assets/watcher/nagomisan_running.png';
    }
  }

  return Object.freeze({
    ObservationState: ObservationState,
    DEFAULT_THRESHOLDS_MS: DEFAULT_THRESHOLDS_MS,
    tailForObservation: tailForObservation,
    looksLikeNeedInput: looksLikeNeedInput,
    computeState: computeState,
    assetPathForState: assetPathForState,
  });
});

