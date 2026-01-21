const test = require('node:test');
const assert = require('node:assert/strict');

const observer = require('../src/terminal_observer.js');

test('computeState: exit codes map to success/fail', () => {
  const ok = observer.computeState({
    nowMs: 1000,
    lastOutputAtMs: 0,
    lastTail: '',
    exitCode: 0,
  });
  assert.equal(ok.state, observer.ObservationState.success);

  const ng = observer.computeState({
    nowMs: 1000,
    lastOutputAtMs: 0,
    lastTail: '',
    exitCode: 1,
  });
  assert.equal(ng.state, observer.ObservationState.fail);
});

test('computeState: running when recent output', () => {
  const r = observer.computeState({
    nowMs: 10_000,
    lastOutputAtMs: 9_500,
    lastTail: 'hello',
    exitCode: null,
    thresholdsMs: { needInputMs: 15_000, stalledMs: 60_000 },
  });
  assert.equal(r.state, observer.ObservationState.running);
});

test('computeState: need-input requires prompt-like tail + idle >= needInputMs', () => {
  const r = observer.computeState({
    nowMs: 20_000,
    lastOutputAtMs: 0,
    lastTail: 'Continue? [y/n]',
    exitCode: null,
    thresholdsMs: { needInputMs: 15_000, stalledMs: 60_000 },
  });
  assert.equal(r.state, observer.ObservationState.needInput);

  const noPrompt = observer.computeState({
    nowMs: 20_000,
    lastOutputAtMs: 0,
    lastTail: 'running...',
    exitCode: null,
    thresholdsMs: { needInputMs: 15_000, stalledMs: 60_000 },
  });
  assert.notEqual(noPrompt.state, observer.ObservationState.needInput);
});

test('computeState: stalled when idle >= stalledMs (without prompt)', () => {
  const r = observer.computeState({
    nowMs: 70_000,
    lastOutputAtMs: 0,
    lastTail: 'still...',
    exitCode: null,
    thresholdsMs: { needInputMs: 15_000, stalledMs: 60_000 },
  });
  assert.equal(r.state, observer.ObservationState.stalled);
});

