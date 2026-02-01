const test = require('node:test');
const assert = require('node:assert/strict');

const observer = require('../src/agent_event_observer.js');

test('observeHookPayload: need_input maps to need-input', () => {
  const result = observer.observeHookPayload({
    kind: 'need_input',
    source: 'codex',
  });
  assert.equal(result.state, observer.ObservationState.needInput);
  assert.equal(result.source, 'codex');
});

test('observeHookPayload: judge_state maps to success/fail/need-input', () => {
  const cases = [
    { judge_state: 'success', expected: observer.ObservationState.success },
    { judge_state: 'failure', expected: observer.ObservationState.fail },
    { judge_state: 'need_input', expected: observer.ObservationState.needInput },
  ];
  for (const testCase of cases) {
    const result = observer.observeHookPayload({
      kind: 'completed',
      judge_state: testCase.judge_state,
    });
    assert.equal(result.state, testCase.expected);
  }
});

test('observeHookPayload: unknown payload returns null', () => {
  const result = observer.observeHookPayload({ kind: 'noop' });
  assert.equal(result, null);
});
