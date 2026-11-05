import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const bundle = readFileSync(
  new URL('../../src/uag_web/static/assets/index.js', import.meta.url),
  'utf8',
);

test('committed browser bundle contains the opt-in latency probe', () => {
  assert.match(bundle, /uag_latency/);
  assert.match(bundle, /\[uag-latency\]/);
  assert.match(bundle, /first_work_tool/);
});

test('committed browser bundle preserves the opt-in parameter on room navigation', () => {
  assert.match(bundle, /replaceState\([^;]+uag_latency=1/);
});
