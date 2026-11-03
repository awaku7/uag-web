import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker, createAvatarRelay, spokenText } from '../src/lib/avatar.js';

test('avatar relay speaks only a completed live response, using replacement text', () => {
  const spoken = []; let stopped = 0;
  const relay = createAvatarRelay((text) => spoken.push(text), () => stopped++);
  relay({ type: 'init', messages: [{ role: 'assistant', content: 'history' }] });
  relay({ type: 'assistant_stream_end', id: 'old' });
  relay({ type: 'assistant_stream_start', id: 'new' });
  relay({ type: 'assistant_stream_delta', id: 'old', delta: 'wrong room' });
  relay({ type: 'assistant_stream_delta', id: 'new', delta: 'draft' });
  relay({ type: 'assistant_stream_replace', id: 'new', content: 'final' });
  relay({ type: 'assistant_stream_end', id: 'new' });
  relay({ type: 'assistant_stream_end', id: 'new' });
  assert.deepEqual(spoken, ['final']); assert.equal(stopped, 1);
});

test('interrupt, human ask and connection reset discard pending speech', () => {
  for (const type of ['assistant_stream_interrupted', 'human_ask', 'init', 'avatar_stop']) {
    const spoken = []; let stopped = 0;
    const relay = createAvatarRelay((text) => spoken.push(text), () => stopped++);
    relay({ type: 'assistant_stream_start', id: 1 });
    relay({ type: 'assistant_stream_delta', id: 1, delta: 'private content' });
    relay({ type, id: 1 });
    relay({ type: 'assistant_stream_end', id: 1 });
    assert.deepEqual(spoken, []); assert.equal(stopped, 1);
  }
});

test('synthesis finishing after stop cannot produce audible chunks', async () => {
  let release; let began;
  const started = new Promise((resolve) => { began = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const played = [];
  const runtime = {
    tts: { async *speakStream() { began(); await pending; yield { pcm: [1], sampleRate: 44100 }; }, destroy() {} },
    avatar: { async speakStream(chunks) { for await (const c of chunks) played.push(c); }, stop() {}, destroy() {} },
  };
  const speaker = createSpeaker(runtime);
  speaker.speak('hello'); await started; speaker.stop(); release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, []);
  speaker.destroy();
});

test('code blocks and image URLs are not read aloud', () => {
  assert.equal(spokenText('Hello ```js\nsecret()\n``` [link](https://example.com) ![image](a.png)'), 'Hello  link');
});
