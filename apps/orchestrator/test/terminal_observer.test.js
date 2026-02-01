const test = require('node:test');
const assert = require('node:assert/strict');

const observer = require('../src/terminal_observer.js');

test('computeState: exit codes map to success/fail', () => {
  const ok = observer.computeState({
    nowMs: 1000,
    lastOutputAtMs: 0,
    lastTail: '',
    exitCode: 0,
    commandActive: true,
  });
  assert.equal(ok.state, observer.ObservationState.success);

  const ng = observer.computeState({
    nowMs: 1000,
    lastOutputAtMs: 0,
    lastTail: '',
    exitCode: 1,
    commandActive: true,
  });
  assert.equal(ng.state, observer.ObservationState.fail);
});

test('computeState: running when recent output', () => {
  const r = observer.computeState({
    nowMs: 10_000,
    lastOutputAtMs: 9_500,
    lastTail: 'hello',
    exitCode: null,
    commandActive: true,
  });
  assert.equal(r.state, observer.ObservationState.running);
});

test('computeState: need-input when tail looks like a prompt', () => {
  const r = observer.computeState({
    nowMs: 20_000,
    lastOutputAtMs: 0,
    lastTail: 'Continue? [y/n]',
    exitCode: null,
    commandActive: true,
  });
  assert.equal(r.state, observer.ObservationState.needInput);

  const noPrompt = observer.computeState({
    nowMs: 20_000,
    lastOutputAtMs: 0,
    lastTail: 'running...',
    exitCode: null,
    commandActive: true,
  });
  assert.notEqual(noPrompt.state, observer.ObservationState.needInput);
});

test('computeState: idle when no command is active', () => {
  const idle = observer.computeState({
    nowMs: 30_000,
    lastOutputAtMs: 29_000,
    lastTail: '',
    exitCode: null,
    commandActive: false,
  });
  assert.equal(idle.state, observer.ObservationState.idle);
});

test('computeState: shell prompt maps to success', () => {
  const done = observer.computeState({
    nowMs: 40_000,
    lastOutputAtMs: 39_500,
    lastTail: 'C:\\Users\\kitad> ',
    exitCode: null,
    commandActive: true,
  });
  assert.equal(done.state, observer.ObservationState.success);
});

test('computeState: prompt at tail end still maps to success', () => {
  const done = observer.computeState({
    nowMs: 50_000,
    lastOutputAtMs: 49_800,
    lastTail:
      'ping stats...\n\x1b[16;1HC:\\Users\\kitad>\x1b]0;C:\\Windows\\system32\\cmd.exe\x07',
    exitCode: null,
    commandActive: true,
  });
  assert.equal(done.state, observer.ObservationState.success);
});
