// Own integration code only. ZEN SDKs and weights are installed by the operator.
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
      if (!value) return;
      const current = generation;
      queue = queue.then(async () => {
        if (current !== generation) return;
        async function* chunks() {
          for await (const part of runtime.tts.speakStream(value)) {
            if (current !== generation) return;
            yield { pcm: part.pcm, sampleRate: part.sampleRate };
          }
        }
        await runtime.avatar.speakStream(chunks());
      }).catch((error) => { if (current === generation) onError(error); });
    },
    stop() { generation++; runtime.avatar.stop(); },
    destroy() { generation++; runtime.avatar.stop(); runtime.avatar.destroy(); runtime.tts.destroy(); },
  };
}

// Only live, completed responses are spoken; history/reconnect never replays.
export function createAvatarRelay(speak, stop) {
  let id = null;
  let text = '';
  return (event) => {
    if (['init', 'avatar_stop', 'assistant_stream_interrupted', 'human_ask'].includes(event.type)) {
      id = null; text = ''; stop();
    } else if (event.type === 'assistant_stream_start') {
      id = event.id; text = '';
    } else if (id !== null && event.id === id) {
      if (event.type === 'assistant_stream_delta') text += event.delta || '';
      if (event.type === 'assistant_stream_replace') text = event.content || '';
      if (event.type === 'assistant_stream_end') { speak(text); id = null; text = ''; }
    }
  };
}
