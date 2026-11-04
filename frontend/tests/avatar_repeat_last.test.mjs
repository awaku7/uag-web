import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpeaker, createAvatarRelay } from '../src/lib/avatar.js';

function mockRuntime(utterances) {
  return {
    tts: {
      async *speakStream(text) {
        utterances.push(text);
        yield { pcm: new Float32Array([0.5]), sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      async speakStream(chunks) { for await (const _chunk of chunks) {} },
      stop() {},
      destroy() {},
    },
  };
}

test('Again replays only the final sentence, never a tool announcement or a full answer', async () => {
  const spoken = [];
  const remembered = [];
  const speaker = createSpeaker(mockRuntime(spoken), () => assert.fail('unexpected TTS error'),
    null, (phrase) => remembered.push(phrase));

  await speaker.speak('ツールを利用します。');
  assert.deepEqual(remembered, [], 'tool speech must not enable replay');
  await speaker.repeatLast();
  assert.deepEqual(spoken, ['ツールを利用します。']);

  await speaker.speak('最初の文章です。最後の文章です。', { measureFinal: true });
  assert.deepEqual(remembered, ['最後の文章です。']);
  assert.deepEqual(spoken, [
    'ツールを利用します。', '最初の文章です。', '最後の文章です。',
  ]);

  await speaker.repeatLast();
  await speaker.repeatLast();
  assert.deepEqual(spoken.slice(-2), ['最後の文章です。', '最後の文章です。']);
  assert.deepEqual(remembered, ['最後の文章です。'], 'replay must not modify retained text');
  speaker.destroy();
  assert.deepEqual(remembered, ['最後の文章です。', '']);
});

test('a new turn clears the phrase and never replays an earlier answer', async () => {
  const spoken = [];
  const remembered = [];
  const speaker = createSpeaker(mockRuntime(spoken), () => assert.fail('unexpected TTS error'),
    null, (phrase) => remembered.push(phrase));
  const relay = createAvatarRelay((text, options) => speaker.speak(text, options), () => speaker.stop());
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'message', message: { role: 'assistant', content: '古い回答です。最後の文です。' } });
  relay({ type: 'assistant_turn_complete' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(remembered.at(-1), '最後の文です。');

  relay({ type: 'avatar_stop', reason: 'new_input' });
  assert.equal(remembered.at(-1), '');
  const count = spoken.length;
  await speaker.repeatLast();
  assert.equal(spoken.length, count);

  relay({ type: 'tool_activity', name: 'search' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(remembered.at(-1), '', 'tool announcement cannot be replayed');
  speaker.destroy();
});

test('cancelled synthesis cannot enable replay after an earlier audio chunk', async () => {
  let started;
  let release;
  const entered = new Promise((resolve) => { started = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const spoken = [];
  const remembered = [];
  const runtime = mockRuntime(spoken);
  runtime.avatar.speakStream = async (chunks) => {
    for await (const _part of chunks) {
      started();
      await waiting;
    }
  };
  const speaker = createSpeaker(runtime, () => assert.fail('unexpected TTS error'), null,
    (phrase) => remembered.push(phrase));

  const speech = speaker.speak('中断される回答です。', { measureFinal: true });
  await entered;
  speaker.stop();
  release();
  await speech;
  await speaker.repeatLast();
  assert.deepEqual(spoken, ['中断される回答です。']);
  assert.deepEqual(remembered, []);
  speaker.destroy();
});

test('a failed final-answer stream never enables replay', async () => {
  const remembered = [];
  const errors = [];
  const runtime = mockRuntime([]);
  runtime.avatar.speakStream = async () => { throw Error('playback failed'); };
  const speaker = createSpeaker(runtime, (error) => errors.push(error.message), null,
    (phrase) => remembered.push(phrase));
  await speaker.speak('再生できない文章です。', { measureFinal: true });
  await speaker.repeatLast();
  assert.deepEqual(errors, ['playback failed']);
  assert.deepEqual(remembered, []);
  speaker.destroy();
});

test('Again button preserves automatic stop/resume and mic pause while repeating', () => {
  const panel = readFileSync(new URL('../src/lib/components/AvatarPanel.svelte', import.meta.url), 'utf8');
  assert.match(panel, /repeat: 'もう一度'/);
  assert.match(panel, /repeat: 'Again'/);
  assert.match(panel, /onclick=\{repeatLastPhrase\}/);
  assert.match(panel, /disabled=\{!canRepeat \|\| loading \|\| repeating\}/);
  assert.match(panel, /dictation\?\.pause\(\)/);
  assert.match(panel, /dictation\?\.resume\(\)/);
  assert.match(panel, /installAvatarAudioActivation\(/);
  assert.doesNotMatch(panel, /\{labels\.(?:stop|retry)\}/);
});
