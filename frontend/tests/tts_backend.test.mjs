import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAvatar, zenTtsLoadOptions } from '../src/lib/avatar.js';

test('ZEN-TTS keeps CPU as the default backend', () => {
  const options = zenTtsLoadOptions('marine');
  assert.equal(options.backend, 'cpu');
  assert.equal(options.model, '/api/avatar/files/models/marine.ztm');
  assert.equal(options.modelsUrl, '/api/avatar/files/tts/models');
  assert.equal(options.cpuWasmUrl, '/api/avatar/files/tts/cpu/tts-cpu.wasm');
});

test('ZEN-TTS supports an explicit WebGPU backend for every published voice', () => {
  for (const voice of ['marine', 'hashiro', 'kai', 'kikka']) {
    const options = zenTtsLoadOptions(voice, 'webgpu');
    assert.equal(options.backend, 'webgpu');
    assert.equal(options.model, `/api/avatar/files/models/${voice}.ztm`);
  }
});

test('unknown voices and backend values fail before loading an SDK', async () => {
  assert.throws(() => zenTtsLoadOptions('unpublished', 'cpu'), /Unknown voice/);
  assert.throws(() => zenTtsLoadOptions('marine', 'auto'), /Unknown TTS backend/);
  await assert.rejects(loadAvatar(null, 'marine', 'marine', 'auto'), /Unknown TTS backend/);
  await assert.rejects(loadAvatar(null, 'hashiro', 'kai', 'webgpu'), /WebGPU requires/);
});
