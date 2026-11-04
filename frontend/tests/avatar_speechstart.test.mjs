import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarLatency, createSpeaker } from '../src/lib/avatar.js';

test('actual speechstart timing is distinct from first TTS PCM and excludes tool speech', async () => {
  let now = 0;
  const metrics = [];
  const latency = createAvatarLatency(
    () => now,
    (name, start, end) => metrics.push({ name, ms: end - start }),
  );
  const listeners = new Set();
  const runtime = {
    tts: {
      async *speakStream() {
        now += 40;
        yield { pcm: new Float32Array(100), sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      on(event, callback) {
        assert.equal(event, 'speechstart');
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      async speakStream(chunks) {
        for await (const chunk of chunks) {
          assert.equal(chunk.sampleRate, 44100);
          now += 10;
          for (const listener of [...listeners]) listener();
          for (const listener of [...listeners]) listener(); // SDK duplicates must not re-measure.
        }
      },
      stop() {},
      destroy() {},
    },
  };

  const speaker = createSpeaker(runtime, () => assert.fail('unexpected playback error'), latency);
  await speaker.speak('ツールを利用します。');
  assert.deepEqual(metrics, [], 'tool announcement does not time a final reply');
  latency.recognized();
  now = 100;
  latency.sent();
  now = 200;
  latency.completed();
  await speaker.speak('回答します。', { measureFinal: true });

  assert.deepEqual(metrics, [
    { name: 'uagav:mic-result-to-send', ms: 0 },
    { name: 'uagav:send-to-final', ms: 100 },
    { name: 'uagav:final-to-first-tts-chunk', ms: 40 },
    { name: 'uagav:final-to-speech-start', ms: 50 },
  ]);
  assert.equal(listeners.size, 0, 'SDK event listener must be removed after playback');
  speaker.destroy();
});

test('stopping playback detaches listeners and excludes stale speechstart callbacks', async () => {
  let now = 0;
  const metrics = [];
  const latency = createAvatarLatency(
    () => now,
    (name) => metrics.push(name),
  );
  const listeners = new Set();
  let lateSpeechStart;
  let releasePlayback;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const waiting = new Promise((resolve) => { releasePlayback = resolve; });
  const runtime = {
    tts: {
      async *speakStream() {
        yield { pcm: new Float32Array(1), sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      on(event, callback) {
        assert.equal(event, 'speechstart');
        lateSpeechStart = callback;
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      async speakStream(chunks) {
        started();
        await waiting;
        for await (const chunk of chunks) void chunk;
      },
      stop() {},
      destroy() {},
    },
  };
  const speaker = createSpeaker(runtime, () => assert.fail('unexpected playback error'), latency);
  latency.recognized();
  latency.sent();
  now = 100;
  latency.completed();
  const playback = speaker.speak('回答です。', { measureFinal: true });
  await entered;
  assert.equal(listeners.size, 1);
  speaker.stop();
  assert.equal(listeners.size, 0);
  now = 150;
  lateSpeechStart();
  assert.ok(!metrics.includes('uagav:final-to-speech-start'));
  releasePlayback();
  await playback;
  speaker.destroy();
});

test('older avatar SDK without speechstart events retains PCM measurement', async () => {
  const metrics = [];
  let now = 0;
  const latency = createAvatarLatency(
    () => now,
    (name) => metrics.push(name),
  );
  const runtime = {
    tts: {
      async *speakStream() {
        now = 40;
        yield { pcm: new Float32Array(1), sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      async speakStream(chunks) { for await (const chunk of chunks) void chunk; },
      stop() {},
      destroy() {},
    },
  };
  const speaker = createSpeaker(runtime, () => assert.fail('unexpected SDK error'), latency);
  latency.recognized();
  latency.sent();
  latency.completed();
  await speaker.speak('回答です。', { measureFinal: true });
  assert.ok(metrics.includes('uagav:final-to-first-tts-chunk'));
  assert.ok(!metrics.includes('uagav:final-to-speech-start'));
  speaker.destroy();
});
