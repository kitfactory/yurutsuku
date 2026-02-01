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

  return Object.freeze({
    merge: merge,
  });
});
