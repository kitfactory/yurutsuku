/* eslint-disable no-var */
// State integrator (P0).
// 状態統合ユーティリティ（P0）。
//
// Goals / 目的:
// - Merge terminal and agent states with a single priority rule.
//   ターミナルとエージェントの状態を単一の優先ルールで統合する。

(function factory(root, init) {
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = init();
    return;
  }
  root.StateIntegrator = init();
})(typeof window !== 'undefined' ? window : globalThis, function init() {
  'use strict';

  var ObservationState = Object.freeze({
    idle: 'idle',
    running: 'running',
    needInput: 'need-input',
    success: 'success',
    fail: 'fail',
  });

  /**
   * Merge terminal/agent states. Agent has priority when present.
   * ターミナル/エージェント状態を統合する。エージェントが優先。
   *
   * @param {{state:string, reason?:string}} terminal
   * @param {{state:string, reason?:string}|null} agent
   * @returns {{state:string, reason:string}}
   */
  function merge(terminal, agent) {
    if (agent && agent.state) {
      return { state: agent.state, reason: agent.reason || 'agent' };
    }
    if (terminal && terminal.state) {
      return { state: terminal.state, reason: terminal.reason || 'terminal' };
    }
    return { state: 'idle', reason: 'default' };
  }

  /**
   * Guard illegal transition to need-input.
   * need-input への直行遷移をガードする。
   *
   * Rule / ルール:
   * - need-input must pass running at least once.
   *   need-input は running を最低1回経由する。
   *
   * @param {{state:string, reason?:string}|null} previous
   * @param {{state:string, reason:string}} next
   * @returns {{next:{state:string, reason:string}, guarded:boolean}}
   */
  function guardNeedInputTransition(previous, next) {
    var prevState = previous && previous.state ? previous.state : ObservationState.idle;
    if (
      next &&
      next.state === ObservationState.needInput &&
      prevState !== ObservationState.running &&
      prevState !== ObservationState.needInput
    ) {
      return {
        next: {
          state: ObservationState.running,
          reason: 'guard running-before-need-input',
        },
        guarded: true,
      };
    }
    return { next: next, guarded: false };
  }

  /**
   * Merge states and enforce transition guard.
   * 状態統合と遷移ガードをまとめて行う。
   *
   * @param {{state:string, reason?:string}|null} previous
   * @param {{state:string, reason?:string}} terminal
   * @param {{state:string, reason?:string}|null} agent
   * @returns {{next:{state:string, reason:string}, guarded:boolean}}
   */
  function mergeWithGuard(previous, terminal, agent) {
    var merged = merge(terminal, agent);
    return guardNeedInputTransition(previous, merged);
  }

  return Object.freeze({
    merge: merge,
    mergeWithGuard: mergeWithGuard,
    ObservationState: ObservationState,
  });
});
