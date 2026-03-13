/* eslint-disable no-var */
// Agent event observation utilities (P0).
// エージェントイベント観測ユーティリティ（P0）。
//
// Goals / 目的:
// - Normalize hook payloads into minimal state changes.
//   フックpayloadを最小の状態変化に正規化する。
// - Keep the logic pure & testable in Node.
//   ロジックを純粋関数にして Node でテストできるようにする。

(function factory(root, init) {
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = init();
    return;
  }
  root.AgentEventObserver = init();
})(typeof window !== 'undefined' ? window : globalThis, function init() {
  'use strict';

  var ObservationState = Object.freeze({
    idle: 'idle',
    needInput: 'need-input',
    success: 'success',
    fail: 'fail',
  });

  /**
   * Normalize completion-hook payload into agent state.
   * completion-hook payload を agent 状態へ正規化する。
   *
   * @param {object} payload
   * @returns {{state:string, reason:string, source?:string}|null}
   */
  function observeHookPayload(payload) {
    if (!payload) return null;
    var kind = payload.kind;
    var state = payload.state || payload.judge_state;
    var source = payload.source;

    if (kind === 'need_input') {
      return { state: ObservationState.needInput, reason: 'hook need_input', source: source };
    }
    if (state === 'success') {
      return { state: ObservationState.success, reason: 'hook success', source: source };
    }
    if (state === 'failure') {
      return { state: ObservationState.fail, reason: 'hook failure', source: source };
    }
    if (state === 'need_input' || state === 'need-input') {
      return { state: ObservationState.needInput, reason: 'hook need_input', source: source };
    }
    return null;
  }

  return Object.freeze({
    ObservationState: ObservationState,
    observeHookPayload: observeHookPayload,
  });
});
