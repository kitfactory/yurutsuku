const test = require('node:test');
const assert = require('node:assert/strict');

const integrator = require('../src/state_integrator.js');

test('merge: agent state overrides terminal state', () => {
  const merged = integrator.merge(
    { state: 'running', reason: 'terminal running' },
    { state: 'need-input', reason: 'agent waiting' }
  );
  assert.deepEqual(merged, { state: 'need-input', reason: 'agent waiting' });
});

test('merge: terminal state used when agent is missing', () => {
  const merged = integrator.merge({ state: 'running' }, null);
  assert.deepEqual(merged, { state: 'running', reason: 'terminal' });
});

test('merge: default when neither state is available', () => {
  const merged = integrator.merge(null, null);
  assert.deepEqual(merged, { state: 'idle', reason: 'default' });
});

test('mergeWithGuard: idle -> need-input is guarded to running', () => {
  const result = integrator.mergeWithGuard(
    { state: 'idle', reason: 'idle' },
    { state: 'idle', reason: 'idle' },
    { state: 'need-input', reason: 'hook need_input' }
  );
  assert.equal(result.guarded, true);
  assert.deepEqual(result.next, {
    state: 'running',
    reason: 'guard running-before-need-input',
  });
});

test('mergeWithGuard: success -> need-input is guarded to running', () => {
  const result = integrator.mergeWithGuard(
    { state: 'success', reason: 'success' },
    { state: 'success', reason: 'success' },
    { state: 'need-input', reason: 'hook need_input' }
  );
  assert.equal(result.guarded, true);
  assert.deepEqual(result.next, {
    state: 'running',
    reason: 'guard running-before-need-input',
  });
});

test('mergeWithGuard: fail -> need-input is guarded to running', () => {
  const result = integrator.mergeWithGuard(
    { state: 'fail', reason: 'failure' },
    { state: 'fail', reason: 'failure' },
    { state: 'need-input', reason: 'hook need_input' }
  );
  assert.equal(result.guarded, true);
  assert.deepEqual(result.next, {
    state: 'running',
    reason: 'guard running-before-need-input',
  });
});

test('mergeWithGuard: running -> need-input stays need-input', () => {
  const result = integrator.mergeWithGuard(
    { state: 'running', reason: 'running' },
    { state: 'running', reason: 'running' },
    { state: 'need-input', reason: 'hook need_input' }
  );
  assert.equal(result.guarded, false);
  assert.deepEqual(result.next, {
    state: 'need-input',
    reason: 'hook need_input',
  });
});
