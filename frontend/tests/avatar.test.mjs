import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker, createAvatarRelay, createContinuousDictation, spokenText } from '../src/lib/avatar.js';
import { classifyEmotion } from '../src/lib/emotion.js';

test('avatar relay speaks only a completed live response, using replacement text', () => {
  const spoken = []; let stopped = 0;
  const relay = createAvatarRelay((text) => spoken.push(text), () => stopped++);
  relay({ type: 'init', messages: [{ role: 'assistant', content: 'history' }] });
  relay({ type: 'assistant_stream_end', id: 'old' });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'new' });
  relay({ type: 'assistant_stream_delta', id: 'old', delta: 'wrong room' });
  relay({ type: 'assistant_stream_delta', id: 'new', delta: 'draft' });
  relay({ type: 'assistant_stream_replace', id: 'new', content: 'final' });
  relay({ type: 'assistant_stream_end', id: 'new' });
  relay({ type: 'assistant_stream_end', id: 'new' });
  relay({ type: 'message', message: { role: 'assistant', content: 'final' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['final']); assert.equal(stopped, 2);
});

test('avatar relay speaks a completed assistant message when no stream was sent', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'init', messages: [{ role: 'assistant', content: 'history' }] });
  relay({ type: 'message', message: { role: 'assistant', content: 'history replay' } });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'message', message: { role: 'user', content: 'hello' } });
  relay({ type: 'message', message: { role: 'assistant', content: 'fresh answer' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['fresh answer']);
});

test('assistant message accompanying a stream is captured but spoken only once', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'live' });
  relay({ type: 'assistant_stream_delta', id: 'live', delta: 'partial' });
  relay({ type: 'message', message: { role: 'assistant', content: 'complete answer' } });
  relay({ type: 'assistant_stream_end', id: 'live' });
  relay({ type: 'message', message: { role: 'assistant', content: 'complete answer' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['complete answer']);
});

test('manual stop does not arm fallback speech for an unstreamed response', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'stop' });
  relay({ type: 'message', message: { role: 'assistant', content: 'not requested' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, []);
});

test('tool activity announces once per user turn and ignores activity outside a turn', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {}, () => {}, () => {}, () => {}, 'tool cue');
  relay({ type: 'tool_activity', name: 'search' });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'status', status: { busy: false } });
  relay({ type: 'tool_activity', name: 'search' });
  relay({ type: 'tool_activity', name: 'browser' });
  relay({ type: 'status', status: { busy: false } });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'tool_activity', name: 'command' });
  assert.deepEqual(spoken, ['tool cue', 'tool cue']);
});

test('continuous dictation submits an utterance after silence and waits for resume', async () => {
  const recognitions = [];
  const sent = [];
  const states = [];
  const dictation = createContinuousDictation(
    () => {
      const recognition = {
        start() {},
        stop() { this.onend?.(); },
        abort() {},
      };
      recognitions.push(recognition);
      return recognition;
    },
    (text) => { sent.push(text); return true; },
    (state) => states.push(state),
    () => assert.fail('unexpected recognition error'),
    10,
  );

  dictation.start();
  recognitions[0].onresult({
    results: [{ 0: { transcript: 'こんにちは' }, isFinal: true }],
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(sent, ['こんにちは']);
  assert.equal(recognitions.length, 1);

  dictation.resume();
  assert.equal(recognitions.length, 2);
  dictation.cancel();
  assert.equal(states.at(-1), false);
});

test('continuous listening pauses during assistant speech and resumes after playback', async () => {
  const events = [];
  let finishPlayback;
  const playback = new Promise((resolve) => { finishPlayback = resolve; });
  const relay = createAvatarRelay(
    () => { events.push('speak'); return playback; },
    () => {},
    () => events.push('cancel'),
    () => events.push('pause'),
    () => events.push('resume'),
  );
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'live' });
  relay({ type: 'assistant_stream_delta', id: 'live', delta: 'answer' });
  relay({ type: 'assistant_stream_end', id: 'live' });
  relay({ type: 'message', message: { role: 'assistant', content: 'answer' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(events, ['pause', 'pause', 'speak']);
  finishPlayback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), 'resume');
});

test('stream speech uses accumulated text only after turn completion', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'live' });
  relay({ type: 'assistant_stream_delta', id: 'live', delta: 'complete response' });
  relay({ type: 'assistant_stream_end', id: 'live' });
  assert.deepEqual(spoken, []);
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['complete response']);
});

test('empty reasoning stream does not suppress the final assistant message', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'reasoning' });
  relay({ type: 'assistant_stream_end', id: 'reasoning' });
  relay({ type: 'message', message: { role: 'assistant', content: 'final answer' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['final answer']);
});

test('interrupt, human ask and connection reset discard pending speech', () => {
  for (const type of ['assistant_stream_interrupted', 'human_ask', 'init', 'avatar_stop']) {
    const spoken = []; let stopped = 0;
    const relay = createAvatarRelay((text) => spoken.push(text), () => stopped++);
    relay({ type: 'assistant_stream_start', id: 1 });
    relay({ type: 'assistant_stream_delta', id: 1, delta: 'private content' });
    relay({ type, id: 1 });
    relay({ type: 'assistant_stream_end', id: 1 });
    relay({ type: 'assistant_turn_complete' });
    // A fresh remote stream and the subsequent interruption each stop playback.
    assert.deepEqual(spoken, []); assert.equal(stopped, 2);
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

test('emotion lexicon classifies clear cues, handles simple negation, and defaults to neutral', () => {
  assert.equal(classifyEmotion('おめでとうございます。'), 'happy');
  assert.equal(classifyEmotion('申し訳ありません。'), 'apologetic');
  assert.equal(classifyEmotion('お悔やみ申し上げます。'), 'sad');
  assert.equal(classifyEmotion('嬉しくない結果でした。'), 'neutral');
  assert.equal(classifyEmotion('今日は会議があります。'), 'neutral');
});

test('speaker applies dictionary-derived emotion per sentence', async () => {
  const requests = [];
  const runtime = {
    tts: {
      async *speakStream(text, options) {
        requests.push({ text, options });
        yield { pcm: [1], sampleRate: 44100 };
      },
      destroy() {},
    },
    avatar: {
      async speakStream(chunks) { for await (const _chunk of chunks) {} },
      stop() {},
      destroy() {},
    },
  };
  const speaker = createSpeaker(runtime);
  await speaker.speak('おめでとうございます。嬉しくない結果です。申し訳ありません。');
  assert.deepEqual(requests.map(({ options }) => Object.keys(options.emotion).find((key) => options.emotion[key] > 0)), [
    'happy', 'neutral', 'apologetic',
  ]);
  speaker.destroy();
});

test('a reconnect snapshot is never spoken, even when an active retained stream ends later', () => {
  for (const ended of [true, false]) {
    const spoken=[];
    const relay=createAvatarRelay(text=>spoken.push(text),()=>{});
    relay({type:'init'});
    relay({type:'assistant_stream_start',id:'retained',snapshot:true});
    relay({type:'assistant_stream_replace',id:'retained',content:'previous response',snapshot:true});
    if (!ended) relay({type:'assistant_stream_delta',id:'retained',delta:' continued'});
    relay({type:'assistant_stream_end',id:'retained',snapshot:ended});
    assert.deepEqual(spoken,[]);
    relay({type:'avatar_stop',reason:'new_input'});
    relay({type:'assistant_stream_start',id:'live'});
    relay({type:'assistant_stream_delta',id:'live',delta:'new response'});
    relay({type:'assistant_stream_end',id:'live'});
    relay({type:'message',message:{role:'assistant',content:'new response'}});
    relay({type:'assistant_turn_complete'});
    assert.deepEqual(spoken,['new response']);
  }
});

test('cancelled dictation cannot submit its saved result callback in a new session', async () => {
  const {createDictation}=await import('../src/lib/avatar.js');
  const sent=[]; const states=[];
  const dictation=createDictation(text=>sent.push(text),value=>states.push(value),()=>{});
  const first={start(){},stop(){},abort(){this.aborted=true;}};
  dictation.start(first);
  const lateResult=first.onresult;
  dictation.cancel();
  const second={start(){},stop(){},abort(){}};
  dictation.start(second);
  lateResult({results:[[{transcript:'old session'}]]});
  second.onresult({results:[[{transcript:'new session'}]]});
  assert.equal(first.aborted,true);
  assert.deepEqual(sent,['new session']);
  dictation.cancel();
  assert.equal(states.at(-1),false);
});

test('an agent interruption acknowledgement preserves new dictation, but context resets cancel it', () => {
  let cancelled=0;
  const relay=createAvatarRelay(()=>{},()=>{},()=>cancelled++);
  relay({type:'assistant_stream_interrupted',id:'previous'});
  assert.equal(cancelled,0);
  for (const type of ['avatar_stop','init','human_ask']) relay({type});
  assert.equal(cancelled,3);
});

test('reasoning and final assistant messages in one turn speak only the final answer', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'reasoning' });
  relay({ type: 'reasoning', content: 'private thinking' });
  relay({ type: 'assistant_stream_end', id: 'reasoning' });
  relay({ type: 'message', message: { role: 'assistant', content: 'private thinking', reasoning_content: 'private thinking' } });
  relay({ type: 'status', status: { busy: false } });
  // Completion can be announced after IDLE; wait for the actual final message.
  assert.deepEqual(spoken, []);
  relay({ type: 'message', message: { role: 'assistant', content: '確定した回答です。' } });
  assert.deepEqual(spoken, []);
  relay({ type: 'assistant_turn_complete' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['確定した回答です。']);
});

test('tool-call messages and reasoning-only messages never replace final speech', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'message', message: { role: 'assistant', content: 'searching', tool_calls: [{ id: 'tool1' }] } });
  relay({ type: 'message', message: { role: 'assistant', content: '', reasoning_content: 'private analysis' } });
  relay({ type: 'assistant_stream_start', id: 'final' });
  relay({ type: 'assistant_stream_delta', id: 'final', delta: 'draft' });
  relay({ type: 'assistant_stream_end', id: 'final' });
  relay({ type: 'message', message: { role: 'assistant', content: 'final stored response', reasoning_content: 'private analysis' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['final stored response']);
});

test('reasoning-only turns and cancelled turns do not speak', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'think' });
  relay({ type: 'reasoning', content: 'hidden reasoning' });
  relay({ type: 'assistant_stream_end', id: 'think' });
  relay({ type: 'message', message: { role: 'assistant', content: '', reasoning_content: 'hidden reasoning' } });
  relay({ type: 'assistant_turn_complete' });
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'cancel' });
  relay({ type: 'assistant_stream_delta', id: 'cancel', delta: 'stale answer' });
  relay({ type: 'avatar_stop', reason: 'interrupt' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, []);
});

test('memory projection revocation discards buffered speech and resumes listening', async () => {
  const spoken = [];
  const listening = [];
  const relay = createAvatarRelay(
    (text) => spoken.push(text),
    () => {},
    () => listening.push('cancel'),
    () => listening.push('pause'),
    () => listening.push('resume'),
  );
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'revoked' });
  relay({ type: 'assistant_stream_delta', id: 'revoked', delta: 'revoked answer' });
  relay({ type: 'assistant_turn_cancelled' });
  relay({ type: 'assistant_stream_end', id: 'revoked' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, []);
  assert.equal(listening.at(-1), 'resume');

  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'message', message: { role: 'assistant', content: 'safe new answer' } });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['safe new answer']);
});

test('worker crash recovery clears buffered reply instead of speaking error text', () => {
  const spoken = [];
  const states = [];
  const relay = createAvatarRelay(
    (text) => spoken.push(text),
    () => {},
    () => states.push('cancel'),
    () => states.push('pause'),
    () => states.push('resume'),
  );
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'crashed' });
  relay({ type: 'assistant_stream_delta', id: 'crashed', delta: 'unfinished' });
  relay({ type: 'assistant_stream_end', id: 'crashed' });
  relay({ type: 'message', message: { role: 'assistant', content: 'unfinished' } });
  relay({ type: 'message', message: { role: 'assistant', content: '[FATAL] Worker crashed.' } });
  relay({ type: 'assistant_turn_cancelled' });
  assert.deepEqual(spoken, []);
  assert.equal(states.at(-1), 'resume');
});

test('another room client can trigger a final avatar answer after reasoning', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'init', messages: [{ role: 'assistant', content: 'historical answer' }] });
  relay({ type: 'message', message: { role: 'user', content: 'sent from another tab' } });
  relay({ type: 'assistant_stream_start', id: 'remote' });
  relay({ type: 'reasoning', content: 'reasoning only' });
  relay({ type: 'assistant_stream_end', id: 'remote' });
  relay({ type: 'message', message: { role: 'assistant', content: '', reasoning_content: 'reasoning only' } });
  relay({ type: 'message', message: { role: 'assistant', content: 'reply to another tab' } });
  assert.deepEqual(spoken, []);
  relay({ type: 'assistant_turn_complete' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['reply to another tab']);
});

test('a new live stream activates a remote turn without a user event', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'init' });
  relay({ type: 'assistant_stream_start', id: 'snapshot', snapshot: true });
  relay({ type: 'assistant_stream_replace', id: 'snapshot', content: 'old answer', snapshot: true });
  relay({ type: 'assistant_stream_end', id: 'snapshot', snapshot: true });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, []);

  relay({ type: 'assistant_stream_start', id: 'new-live-stream' });
  relay({ type: 'assistant_stream_delta', id: 'new-live-stream', delta: 'fresh answer' });
  relay({ type: 'assistant_stream_end', id: 'new-live-stream' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['fresh answer']);
});

test('manual stop and cancellation block same-turn streams until a fresh user message', () => {
  const spoken = [];
  const relay = createAvatarRelay((text) => spoken.push(text), () => {});
  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'first' });
  relay({ type: 'avatar_stop', reason: 'stop' });
  relay({ type: 'assistant_stream_start', id: 'late' });
  relay({ type: 'assistant_stream_delta', id: 'late', delta: 'must not speak' });
  relay({ type: 'assistant_stream_end', id: 'late' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, []);

  relay({ type: 'message', message: { role: 'user', content: 'new user turn' } });
  relay({ type: 'assistant_stream_start', id: 'new' });
  relay({ type: 'assistant_stream_delta', id: 'new', delta: 'fresh response' });
  relay({ type: 'assistant_stream_end', id: 'new' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['fresh response']);

  relay({ type: 'avatar_stop', reason: 'new_input' });
  relay({ type: 'assistant_stream_start', id: 'cancelled' });
  relay({ type: 'assistant_turn_cancelled' });
  relay({ type: 'assistant_stream_start', id: 'late-cancelled' });
  relay({ type: 'assistant_stream_delta', id: 'late-cancelled', delta: 'revoked' });
  relay({ type: 'assistant_turn_complete' });
  assert.deepEqual(spoken, ['fresh response']);
});
