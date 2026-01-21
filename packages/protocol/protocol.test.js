'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLine, serializeMessage } = require('./src/index.js');

const fixturesPath = path.join(__dirname, '..', '..', 'testdata', 'protocol_fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

test('serialize/parse known messages', () => {
  for (const message of fixtures) {
    const line = serializeMessage(message);
    const parsed = parseLine(line);
    assert.deepStrictEqual(parsed, message);
  }
});

test('unknown message type', () => {
  const line = '{"type":"mystery","value":1}';
  const parsed = parseLine(line);
  assert.equal(parsed.type, 'unknown');
  assert.deepStrictEqual(parsed.raw, { type: 'mystery', value: 1 });
});
