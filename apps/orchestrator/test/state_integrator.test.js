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
