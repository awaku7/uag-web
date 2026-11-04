// Own integration code only. ZEN SDKs and weights are installed by the operator.
import { classifyEmotion, emotionBlend, splitSpeechSegments } from './emotion.js';


// Only durations are recorded in browser Performance entries; no transcript or IDs.
export const AVATAR_FINAL_SILENCE_MS = 800;
export const AVATAR_INTERIM_SILENCE_MS = 1100;

export function createAvatarLatency(
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  record = (name, start, end) => {
    try {
      globalThis.performance?.clearMeasures?.(name);
      globalThis.performance?.measure?.(name, { start, end });
    } catch (_) { /* Browser timing APIs are optional. */ }
  },
) {
  let lastResult = null;
  let submitted = null;
  let finalReply = null;
  function duration(name, start, end) {
    if (start !== null && end !== null && end >= start) record(name, start, end);
  }
  return {
    recognized() { lastResult = now(); },
    sent() {
      if (lastResult === null) return;
      const end = now();
      duration('uagav:mic-result-to-send', lastResult, end);
      submitted = end;
      lastResult = null;
      finalReply = null;
    },
    completed() {
      if (submitted === null) return;
      finalReply = now();
      duration('uagav:send-to-final', submitted, finalReply);
      submitted = null;
    },
    firstAudioChunk() {
      if (finalReply === null) return;
      duration('uagav:final-to-first-tts-chunk', finalReply, now());
      finalReply = null;
    },
    // A new input supersedes the old turn. Keep an unsent mic sample because
    // sendUserInput emits avatar_stop(new_input) before dictation calls sent().
    newInput() { submitted = null; finalReply = null; },
    reset() { lastResult = null; submitted = null; finalReply = null; },
  };
}

// Load the independently installed SDK assets concurrently. If either fails,
// wait for both to settle and destroy any resource the other one created.
export async function initializeAvatarAndTts(makeAvatar, makeTts) {
  const [avatarResult, ttsResult] = await Promise.allSettled([
    Promise.resolve().then(makeAvatar),
    Promise.resolve().then(makeTts),
  ]);
  if (avatarResult.status === 'fulfilled' && ttsResult.status === 'fulfilled') {
    return { avatar: avatarResult.value, tts: ttsResult.value };
  }
  for (const result of [avatarResult, ttsResult]) {
    if (result.status === 'fulfilled') {
      try { result.value?.destroy?.(); } catch (_) { /* Keep the load error. */ }
    }
  }
  throw avatarResult.status === 'rejected' ? avatarResult.reason : ttsResult.reason;
}

export const assetBase = '/api/avatar/files';
export async function loadAvatar(container, avatarId, voiceId = avatarId, ttsBackend = 'cpu') {
  if (!['marine', 'hashiro', 'kikka'].includes(avatarId)) throw new Error('Unknown avatar');
  if (!['marine', 'hashiro', 'kai', 'kikka'].includes(voiceId)) throw new Error('Unknown voice');
  if (!['cpu', 'webgpu'].includes(ttsBackend)) throw new Error('Unknown TTS backend');
  if (!globalThis.isSecureContext || !navigator.gpu) throw new Error('WebGPU requires a supported browser and HTTPS or localhost.');
  const started = globalThis.performance?.now?.();
  const sdkUrl = `${assetBase}/sdk/dist/index.js`;
  const ttsUrl = `${assetBase}/tts/dist/index.js`;
  const [{ create }, { ZenTts }] = await Promise.all([
    import(/* @vite-ignore */ sdkUrl), import(/* @vite-ignore */ ttsUrl),
  ]);
  const resources = await initializeAvatarAndTts(
    () => create({ container, avatar: `${assetBase}/avatars/avatars/${avatarId}/avatar.json` }),
    () => ZenTts.load({ model: `${assetBase}/models/${voiceId}.ztm`, modelsUrl: `${assetBase}/tts/models`, cpuWasmUrl: `${assetBase}/tts/cpu/tts-cpu.wasm`, backend: ttsBackend }),
  );
  if (started !== undefined) {
    try {
      const name = 'uagav:avatar-startup';
      globalThis.performance?.clearMeasures?.(name);
      globalThis.performance?.measure?.(name, { start: started, end: globalThis.performance.now() });
    } catch (_) { /* Performance API is optional. */ }
  }
  return resources;
}

export function spokenText(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '').replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#`_]/g, '').trim();
}

// Cancelled synthesis cannot play later, even if the SDK finishes after stop().
export function createSpeaker(runtime, onError = () => {}, latency = null) {
  let generation = 0;
  let queue = Promise.resolve();
  return {
    speak(text, { measureFinal = false } = {}) {
      const value = spokenText(text);
      if (!value) return Promise.resolve();
      const segments = splitSpeechSegments(value);
      const current = generation;
      queue = queue.then(async () => {
        if (current !== generation) return;
        async function* chunks() {
          for (const segment of segments.length ? segments : [value]) {
            const options = { emotion: emotionBlend[classifyEmotion(segment)] };
            for await (const part of runtime.tts.speakStream(segment, options)) {
              if (current !== generation) return;
              if (measureFinal) latency?.firstAudioChunk();
              yield { pcm: part.pcm, sampleRate: part.sampleRate };
            }
          }
        }
        await runtime.avatar.speakStream(chunks());
      }).catch((error) => { if (current === generation) onError(error); });
      return queue;
    },
    stop() { generation++; runtime.avatar.stop(); },
    destroy() { generation++; runtime.avatar.stop(); runtime.avatar.destroy(); runtime.tts.destroy(); },
  };
}

// Speak only fresh completed responses; never replay history or stream snapshots.
export function createAvatarRelay(speak, stop, cancelCapture = () => {}, pauseCapture = () => {}, resumeCapture = () => {}, toolPhrase = 'ツールを利用します。少々お待ちください。', latency = null) {
  let id = null;
  let text = '';
  let streamAnswer = '';
  let storedAnswer = '';
  let turnActive = false;
  let suppressStreamStart = false;
  let toolAnnounced = false;
  let resumeStoppedTurn = false;
  const localUserMessageIds = new Set();

  function speakAndResume(value) {
    let playback;
    try { playback = speak(value, { measureFinal: true }); }
    catch (_) { resumeCapture(); return; }
    Promise.resolve(playback).catch(() => {}).finally(resumeCapture);
  }

  return (event) => {
    if (event.type === 'avatar_local_user_input') {
      // Correlate the browser's own request with its later server echo.
      if (event.client_message_id) localUserMessageIds.add(event.client_message_id);
      return;
    }
    if (['init', 'avatar_stop', 'assistant_stream_interrupted', 'assistant_turn_cancelled', 'human_ask'].includes(event.type)) {
      // Keep the unsent mic sample, but discard old-turn timers on new input.
      if (event.type === 'avatar_stop' && event.reason === 'new_input') latency?.newInput();
      else if (event.type === 'init' || event.type === 'assistant_stream_interrupted'
        || event.type === 'assistant_turn_cancelled'
        || (event.type === 'avatar_stop' && event.reason !== 'new_input')) latency?.reset();
      if (event.type === 'init' || (event.type === 'avatar_stop' && event.reason === 'reset')) {
        localUserMessageIds.clear();
      }
      // Stop voice can preserve an already paused microphone. Only terminal
      // cleanup for that same turn may resume it; its answer stays silent.
      resumeStoppedTurn = event.type === 'avatar_stop'
        && event.preserveCapture === true && (turnActive || resumeStoppedTurn);
      id = null;
      text = '';
      streamAnswer = '';
      storedAnswer = '';
      // human_ask temporarily pauses the existing turn. Its answer may arrive
      // without another stream start or server-side user message.
      const continueAfterAsk = event.type === 'human_ask' && turnActive;
      const wasSuppressed = suppressStreamStart;
      turnActive = (event.type === 'avatar_stop' && event.reason === 'new_input')
        || continueAfterAsk;
      // Keep explicit manual-stop suppression across human_ask.
      suppressStreamStart = event.type === 'human_ask'
        ? wasSuppressed : event.type !== 'init' && !turnActive;
      toolAnnounced = false;
      stop();
      const interrupted = event.type === 'assistant_stream_interrupted'
        || event.type === 'assistant_turn_cancelled';
      const keepCapture = interrupted || event.preserveCapture === true || turnActive;
      if (turnActive) pauseCapture();
      // An acknowledgement of our barge-in must not cancel the new dictation.
      if (!keepCapture) cancelCapture();
      if (interrupted) resumeCapture();
    } else if (event.type === 'message' && !event.snapshot && event.message?.role === 'user') {
      // A delayed echo of this tab's stopped request must not override Stop voice.
      const messageId = event.message.client_message_id;
      if (messageId && localUserMessageIds.delete(messageId)) return;
      // Other tabs/clients do not emit this tab's local avatar_stop(new_input).
      // The server's user message is the authoritative fresh-turn boundary.
      if (!turnActive) {
        turnActive = true;
        suppressStreamStart = false;
        resumeStoppedTurn = false;
        toolAnnounced = false;
        stop();
        pauseCapture();
      }
    } else if (event.type === 'assistant_stream_start' && !event.snapshot) {
      // Some providers start streaming before a stored user message arrives.
      // Never re-arm a manually stopped or cancelled turn from a late stream.
      if (!turnActive && !suppressStreamStart) {
        turnActive = true;
        resumeStoppedTurn = false;
        toolAnnounced = false;
        stop();
      }
      if (!turnActive) return;
      id = event.id;
      text = '';
      pauseCapture();
    } else if (event.type === 'assistant_turn_complete' && resumeStoppedTurn) {
      latency?.reset();
      // A manually stopped answer is never spoken, but listening must resume.
      resumeStoppedTurn = false;
      resumeCapture();
      return;
    } else if (!turnActive) {
      // Reconnect snapshots and messages from already-cancelled turns stay silent.
      return;
    } else if (event.type === 'tool_activity') {
      if (event.name && !toolAnnounced) {
        toolAnnounced = true;
        pauseCapture();
        const phrase = typeof toolPhrase === 'function' ? toolPhrase() : toolPhrase;
        try { speak(phrase); } catch (_) {}
      }
    } else if (event.type === 'message') {
      const message = event.message;
      if (event.snapshot || message?.role !== 'assistant') return;
      if (message.type === 'reasoning' || message.channel === 'analysis'
        || (Array.isArray(message.tool_calls) && message.tool_calls.length)) return;
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
      // Ignore reasoning-only entries. The final stored assistant answer wins.
      if (content.trim() && content.trim() !== reasoning.trim()) storedAnswer = content;
    } else if (event.type === 'assistant_turn_complete') {
      // The server sends this after all assistant messages and the stream end.
      // Do not speak intermediate reasoning/tool messages or a premature stream.
      const answer = storedAnswer || streamAnswer || text;
      turnActive = false;
      id = null;
      text = '';
      streamAnswer = '';
      storedAnswer = '';
      if (answer.trim()) {
        latency?.completed();
        speakAndResume(answer);
      } else {
        latency?.reset();
        resumeCapture();
      }
    } else if (id !== null && event.id === id) {
      if (event.type === 'assistant_stream_delta') text += event.delta || '';
      if (event.type === 'assistant_stream_replace') text = event.content || '';
      if (event.type === 'assistant_stream_end') {
        if (text.trim()) streamAnswer = text;
        id = null;
        text = '';
      }
    }
  };
}

// One-shot recognition helper retained for callers that need a single utterance.
export function createDictation(onText, onState, onError) {
  let active = null;
  function cancel() {
    const previous = active;
    active = null;
    if (previous) {
      previous.onresult = null;
      previous.onend = null;
      previous.onerror = null;
      previous.abort();
    }
    onState(false);
  }
  return {
    cancel,
    finish() { active?.stop(); },
    start(recognition) {
      cancel();
      active = recognition;
      recognition.onresult = (event) => {
        if (active !== recognition) return;
        const text = event.results[0]?.[0]?.transcript?.trim();
        if (text) onText(text);
      };
      recognition.onerror = () => { if (active === recognition) { cancel(); onError(); } };
      recognition.onend = () => { if (active === recognition) { active = null; onState(false); } };
      try { recognition.start(); onState(true); }
      catch (_) { cancel(); onError(); }
    },
  };
}

// Continuous browser speech recognition: a silence gap closes each utterance.
// The mic stays paused while the assistant responds and resumes after playback.
export function createContinuousDictation(makeRecognition, onText, onState, onError, silenceMs = AVATAR_FINAL_SILENCE_MS, latency = null) {
  let active = null;
  let enabled = false;
  let paused = false;
  let silenceTimer = null;

  function clearTimer() {
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function scheduleStart() {
    setTimeout(() => {
      if (enabled && !paused && !active) startRecognition();
    }, 250);
  }

  function startRecognition() {
    if (!enabled || paused || active) return;
    latency?.reset();
    let recognition;
    try {
      recognition = makeRecognition();
    } catch (error) {
      enabled = false;
      onState(false);
      onError(error);
      return;
    }

    let transcript = '';
    active = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (active !== recognition) return;
      transcript = Array.from(event.results || [])
        .map((result) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      if (!transcript) return;
      latency?.recognized();
      clearTimer();
      // Interim hypotheses can contain natural speech pauses; keep their longer gap.
      const lastResult = event.results?.[event.results.length - 1];
      const delay = lastResult?.isFinal === true
        ? silenceMs : Math.max(silenceMs, AVATAR_INTERIM_SILENCE_MS);
      silenceTimer = setTimeout(() => {
        if (active !== recognition) return;
        try { recognition.stop(); }
        catch (_) { recognition.onend?.(); }
      }, delay);
    };
    recognition.onerror = (event) => {
      if (active !== recognition) return;
      active = null;
      clearTimer();
      if (enabled && !paused && ['no-speech', 'aborted'].includes(event?.error)) {
        scheduleStart();
      } else {
        enabled = false;
        paused = false;
        onState(false);
        onError(event);
      }
    };
    recognition.onend = () => {
      if (active !== recognition) return;
      active = null;
      clearTimer();
      if (enabled && !paused && transcript) {
        paused = true;
        onState(true);
        if (onText(transcript) === false) {
          latency?.reset();
          paused = false;
          scheduleStart();
        } else {
          latency?.sent();
        }
      } else if (enabled && !paused) {
        scheduleStart();
      } else if (!enabled) {
        onState(false);
      }
    };

    try {
      recognition.start();
      onState(true);
    } catch (error) {
      active = null;
      enabled = false;
      paused = false;
      clearTimer();
      onState(false);
      onError(error);
    }
  }

  function pause() {
    if (!enabled || paused) return;
    paused = true;
    clearTimer();
    const previous = active;
    active = null;
    if (previous) {
      previous.onresult = null;
      previous.onend = null;
      previous.onerror = null;
      try { previous.abort(); } catch (_) {}
    }
  }

  function resume() {
    if (!enabled || !paused) return;
    paused = false;
    startRecognition();
  }

  function cancel() {
    enabled = false;
    paused = false;
    clearTimer();
    const previous = active;
    active = null;
    if (previous) {
      previous.onresult = null;
      previous.onend = null;
      previous.onerror = null;
      try { previous.abort(); } catch (_) {}
    }
    onState(false);
  }

  return {
    start() {
      if (enabled) return;
      enabled = true;
      paused = false;
      startRecognition();
    },
    pause,
    resume,
    cancel,
    finish: cancel,
  };
}
