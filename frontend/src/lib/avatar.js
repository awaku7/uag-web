// Own integration code only. ZEN SDKs and weights are installed by the operator.
import { classifyEmotion, emotionBlend, splitSpeechSegments } from './emotion.js';

export const assetBase = '/api/avatar/files';
export async function loadAvatar(container, voice) {
  if (!['marine', 'hashiro', 'kikka'].includes(voice)) throw new Error('Unknown avatar');
  if (!globalThis.isSecureContext || !navigator.gpu) throw new Error('WebGPU requires a supported browser and HTTPS or localhost.');
  const sdkUrl = `${assetBase}/sdk/dist/index.js`;
  const ttsUrl = `${assetBase}/tts/dist/index.js`;
  const [{ create }, { ZenTts }] = await Promise.all([
    import(/* @vite-ignore */ sdkUrl), import(/* @vite-ignore */ ttsUrl),
  ]);
  let avatar;
  let tts;
  try {
    avatar = await create({ container, avatar: `${assetBase}/avatars/avatars/${voice}/avatar.json` });
    tts = await ZenTts.load({ model: `${assetBase}/models/${voice}.ztm`, modelsUrl: `${assetBase}/tts/models`, cpuWasmUrl: `${assetBase}/tts/cpu/tts-cpu.wasm`, backend: 'cpu' });
    return { avatar, tts };
  } catch (error) {
    avatar?.destroy(); tts?.destroy(); throw error;
  }
}

export function spokenText(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '').replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#`_]/g, '').trim();
}

// Cancelled synthesis cannot play later, even if the SDK finishes after stop().
export function createSpeaker(runtime, onError = () => {}) {
  let generation = 0;
  let queue = Promise.resolve();
  return {
    speak(text) {
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
export function createAvatarRelay(speak, stop, cancelCapture = () => {}, pauseCapture = () => {}, resumeCapture = () => {}, toolPhrase = 'ツールを利用します。少々お待ちください。') {
  let id = null;
  let text = '';
  let streamAnswer = '';
  let storedAnswer = '';
  let turnActive = false;
  let toolAnnounced = false;

  function speakAndResume(value) {
    let playback;
    try { playback = speak(value); }
    catch (_) { resumeCapture(); return; }
    Promise.resolve(playback).catch(() => {}).finally(resumeCapture);
  }

  return (event) => {
    if (['init', 'avatar_stop', 'assistant_stream_interrupted', 'human_ask'].includes(event.type)) {
      id = null;
      text = '';
      streamAnswer = '';
      storedAnswer = '';
      turnActive = event.type === 'avatar_stop' && event.reason === 'new_input';
      toolAnnounced = false;
      stop();
      const keepCapture = event.type === 'assistant_stream_interrupted'
        || event.preserveCapture === true
        || turnActive;
      if (turnActive) pauseCapture();
      // An acknowledgement of our barge-in must not cancel the new dictation.
      if (!keepCapture) cancelCapture();
      if (event.type === 'assistant_stream_interrupted') resumeCapture();
    } else if (!turnActive) {
      // Reconnect snapshots and messages from already-cancelled turns stay silent.
      return;
    } else if (event.type === 'assistant_stream_start') {
      if (event.snapshot) return;
      id = event.id;
      text = '';
      pauseCapture();
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
      if (answer.trim()) speakAndResume(answer);
      else resumeCapture();
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
export function createContinuousDictation(makeRecognition, onText, onState, onError, silenceMs = 1100) {
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
      clearTimer();
      silenceTimer = setTimeout(() => {
        if (active !== recognition) return;
        try { recognition.stop(); }
        catch (_) { recognition.onend?.(); }
      }, silenceMs);
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
          paused = false;
          scheduleStart();
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
