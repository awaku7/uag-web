import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAvatarAudioActivation, createSpeaker } from '../src/lib/avatar.js';

function keydown(key) {
  const event = new Event('keydown');
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

test('a real browser gesture can resume the audio context after asynchronous model load', () => {
  const target = new EventTarget();
  const calls = [];
  let avatar = null;
  const remove = installAvatarAudioActivation(target, () => avatar);

  target.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(calls, [], 'model is not ready before load');
  avatar = { resume() { calls.push('resume'); } };

  target.dispatchEvent(new Event('pointerdown'));
  target.dispatchEvent(keydown('a'));
  target.dispatchEvent(keydown('Enter'));
  target.dispatchEvent(keydown(' '));
  assert.deepEqual(calls, ['resume', 'resume', 'resume']);

  avatar = null;
  target.dispatchEvent(new Event('pointerdown'));
  remove();
  avatar = { resume() { calls.push('leak'); } };
  target.dispatchEvent(new Event('pointerdown'));
  target.dispatchEvent(keydown('Enter'));
  assert.deepEqual(calls, ['resume', 'resume', 'resume'], 'listeners are removed on unmount');
});

test('audio activation failure can be reported and a later gesture retries', () => {
  const target = new EventTarget();
  const errors = [];
  let attempts = 0;
  const avatar = {
    resume() {
      attempts++;
      if (attempts === 1) throw Error('blocked');
    },
  };
  const remove = installAvatarAudioActivation(target, () => avatar, (e) => errors.push(e.message));
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(attempts, 1);
  assert.deepEqual(errors, ['blocked']);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(attempts, 2);
  remove();
});

test('speaker still works after a previous turn was stopped', async () => {
  const played = [];
  const runtime = {
    avatar: {
      async speakStream(chunks) {
        for await (const part of chunks) played.push(part.pcm[0]);
      },
      stop() {},
      destroy() {},
    },
    tts: {
      async *speakStream() {
        yield { pcm: new Float32Array([0.5]), sampleRate: 44100 };
      },
      destroy() {},
    },
  };
  const speaker = createSpeaker(runtime, () => assert.fail('unexpected synthesis error'));
  speaker.stop();
  await speaker.speak('読み上げ再開のテストです。');
  assert.deepEqual(played, [0.5]);
  speaker.destroy();
});
