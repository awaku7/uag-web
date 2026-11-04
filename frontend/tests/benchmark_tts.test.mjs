import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('manual ZEN-TTS backend benchmark is valid executable JavaScript', () => {
  const script = fileURLToPath(new URL('../../scripts/benchmark_tts_browser.mjs', import.meta.url));
  // Do not import/run the script in CI: real models, WebGPU, and Playwright
  // are intentionally installed only on an operator's own machine.
  const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
