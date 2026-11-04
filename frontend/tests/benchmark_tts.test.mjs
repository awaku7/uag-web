import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openInertBenchmarkPage } from '../../scripts/benchmark_tts_origin.mjs';

test('manual ZEN-TTS backend benchmark is valid executable JavaScript', () => {
  const script = fileURLToPath(new URL('../../scripts/benchmark_tts_browser.mjs', import.meta.url));
  // Do not import/run the script in CI: real models, WebGPU, and Playwright
  // are intentionally installed only on an operator's own machine.
  const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('benchmark uses an inert same-origin page instead of bootstrapping UAG', async () => {
  const events = [];
  let fulfillNavigation;
  const page = {
    async route(url, handler) {
      events.push({ type: 'route', url });
      fulfillNavigation = handler;
    },
    async goto(url, options) {
      events.push({ type: 'goto', url, options });
      // Playwright routes are evaluated before any navigation response can run.
      await fulfillNavigation({ fulfill: async (payload) => {
        events.push({ type: 'fulfill', payload });
      } });
    },
  };
  await openInertBenchmarkPage(page, 'http://127.0.0.1:8000/');
  assert.deepEqual(events.map((item) => item.type), ['route', 'goto', 'fulfill']);
  assert.equal(events[0].url, events[1].url);
  assert.equal(events[2].payload.status, 200);
  assert.match(events[2].payload.contentType, /text\/html/);
  assert.doesNotMatch(events[2].payload.body, /<script|App\.svelte|websocket|connect\(/i);
  assert.match(events[2].payload.body, /<title>ZEN-TTS benchmark<\/title>/);
});
