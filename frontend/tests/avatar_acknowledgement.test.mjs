import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpeaker } from '../src/lib/avatar.js';

function makeRuntime() {
  const synthesized = [];
  const played = [];
  let stopCount = 0;
  return {
    synthesized,
    played,
    get stopCount() { return stopCount; },
    tts: {
      async *speakStream(text) {
        synthesized.push(text);
        yield { pcm: new Float32Array([0.2, 0.3]), sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      async speakStream(chunks) {
        const parts = [];
        for await (const part of chunks) parts.push(part);
        played.push(parts);
      },
      stop() { stopCount++; },
      destroy() {},
    },
  };
}

test('acknowledgement is optional, precached and never synthesized on send', async () => {
  const runtime = makeRuntime();
  const speaker = createSpeaker(runtime, () => assert.fail('normal speech failed'));
  assert.equal(speaker.acknowledge('はい。'), false);
  await speaker.prepareAcknowledgement('はい。');
  assert.equal(runtime.synthesized.length, 1);
  assert.equal(speaker.acknowledge('Okay.'), false, 'skip stale language');
  assert.equal(speaker.acknowledge('はい。'), true);
  await speaker.speak('回答です。', { measureFinal: true });
  assert.deepEqual(runtime.synthesized, ['はい。', '回答です。']);
  speaker.destroy();
});

test('cached acknowledgements replay PCM without TTS or final reply state', async () => {
  const runtime = makeRuntime();
  const remembered = [];
  const speaker = createSpeaker(runtime, () => assert.fail('error'), null,
    (phrase) => remembered.push(phrase));
  await speaker.prepareAcknowledgement('はい。');
  assert.equal(speaker.acknowledge('はい。'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.played.length, 1);
  assert.deepEqual(Array.from(runtime.played[0][0].pcm), Array.from(new Float32Array([0.2, 0.3])));
  assert.deepEqual(runtime.synthesized, ['はい。']);
  assert.deepEqual(remembered, []);
  speaker.stop();
  assert.equal(speaker.acknowledge('はい。'), true, 'cache survives a new turn');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.played.length, 2);
  speaker.destroy();
});

test('final answer preempts an acknowledgement already playing', async () => {
  const runtime = makeRuntime();
  let started;
  let end;
  const entered = new Promise((resolve) => { started = resolve; });
  const stopped = new Promise((resolve) => { end = resolve; });
  runtime.avatar.speakStream = async (chunks) => {
    const parts = [];
    for await (const part of chunks) parts.push(part);
    if (Math.abs((parts[0]?.pcm?.[0] ?? 0) - 0.2) < 0.001) {
      started();
      await stopped;
    }
    runtime.played.push(parts);
  };
  runtime.avatar.stop = () => { end(); };
  const speaker = createSpeaker(runtime);
  await speaker.prepareAcknowledgement('はい。');
  assert.equal(speaker.acknowledge('はい。'), true);
  await entered;
  await speaker.speak('確定回答です。', { measureFinal: true });
  assert.deepEqual(runtime.synthesized, ['はい。', '確定回答です。']);
  speaker.destroy();
});

test('code-only final answer cancels pending acknowledgement before microphone resumes', async () => {
  const runtime = makeRuntime();
  const speaker = createSpeaker(runtime);
  await speaker.prepareAcknowledgement('はい。');
  const { createAvatarRelay } = await import('../src/lib/avatar.js');
  let resumes = 0;
  const relay = createAvatarRelay((text, opts) => speaker.speak(text, opts),
    () => speaker.stop(), () => {}, () => {}, () => { resumes++; });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  assert.equal(speaker.acknowledge('はい。'), true);
  relay({ type: 'message', message: { role: 'assistant', content: '`' + '`' + '`js\\n42\\n' + '`' + '`' + '`' } });
  relay({ type: 'assistant_turn_complete' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumes, 1);
  assert.equal(runtime.played.length, 0, 'acknowledgement must not outlive an unspoken final');
  speaker.destroy();
});

test('preparation failures and oversized cache never block a normal answer', async () => {
  const runtime = makeRuntime();
  runtime.tts.speakStream = async function* (text) {
    if (text === 'はい。') {
      yield { pcm: new Float32Array(288001), sampleRate: 44100 };
      return;
    }
    runtime.synthesized.push(text);
    yield { pcm: new Float32Array([0.1]), sampleRate: 44100 };
  };
  const speaker = createSpeaker(runtime);
  await speaker.prepareAcknowledgement('はい。');
  assert.equal(speaker.acknowledge('はい。'), false);
  await speaker.speak('正常な回答です。', { measureFinal: true });
  assert.deepEqual(runtime.synthesized, ['正常な回答です。']);
  speaker.destroy();
});

test('only successful voice input starts optional acknowledgement and deployment matches source', () => {
  const panel = readFileSync(new URL('../src/lib/components/AvatarPanel.svelte', import.meta.url), 'utf8');
  assert.match(panel, /speaker\?\.acknowledge\(getLang\(\) === 'ja'/);
  assert.match(panel, /speaker\.prepareAcknowledgement\(getLang\(\) === 'ja'/);
  const built = readFileSync(new URL('../../src/uag_web/static/assets/index.js', import.meta.url), 'utf8');
  assert.match(built, /\.acknowledge\(/);
  assert.match(built, /\.prepareAcknowledgement\(/);
});
