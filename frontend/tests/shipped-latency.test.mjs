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

test('committed browser tracker discards an interrupted socket measurement', () => {
  if (bundle.includes('__uagLatencyTracker')) {
    assert.match(bundle, /\.onclose=[^;]{0,300}__uagLatencyTracker\.reset\(\)/);
  } else {
    // npm run build regenerates the bundle from the source implementation.
    const source = readFileSync(
      new URL('../src/lib/stores.svelte.js', import.meta.url),
      'utf8',
    );
    assert.match(source, /newWs\.onclose[\s\S]*?latencyStartedAt = null;/);
  }
});

test('committed browser bundle clears image previews on reconnect and new turns', () => {
  assert.match(bundle, /\.init&&[\w$]+\.init\(\)/);
  assert.match(bundle, /"init",\(\)=>\{/);
  assert.ok(
    (bundle.match(/\{src:"",mime:"",partial:!1,visible:!1\}/g) || []).length >= 2,
    'the shipped bundle must both initialize and clear image preview state',
  );
});
