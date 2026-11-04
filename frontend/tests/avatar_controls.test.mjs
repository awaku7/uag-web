import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(
  new URL('../src/lib/components/AvatarPanel.svelte', import.meta.url),
  'utf8',
);

test('avatar hides manual stop and resume playback controls', () => {
  assert.doesNotMatch(panel, /\{labels\.(?:stop|retry)\}/);
  assert.doesNotMatch(panel, /<button[^>]*runtime\?\.avatar\.resume\(\)/);
  assert.doesNotMatch(panel, /(?:音声停止|Stop voice|再生を再開|Resume playback)/);
});

test('automatic stop and browser audio activation remain intact', () => {
  assert.match(panel, /function stop\(\) \{ speaker\?\.stop\(\); \}/);
  assert.match(panel, /function stopVoice\(\)/);
  assert.match(panel, /installAvatarAudioActivation\(/);
  assert.match(panel, /loaded\.avatar\.resume\(\)/);
});
