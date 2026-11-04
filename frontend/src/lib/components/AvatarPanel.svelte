<script>
  import { onMount } from 'svelte';
  import { getLang } from '../i18n.svelte.js';
  import { subscribeAvatar } from '../stores.svelte.js';
  import { loadAvatar, createSpeaker, createAvatarRelay, createContinuousDictation, createAvatarLatency, AVATAR_FINAL_SILENCE_MS, installAvatarAudioActivation } from '../avatar.js';
  let { onSend, onInterrupt } = $props();
  let presets = $state([]);
  let voices = $state([]);
  let avatar = $state('marine');
  let voice = $state('marine');
  let useWebGpu = $state(false);
  let enabled = $state(false);
  let loading = $state(false);
  let error = $state('');
  let container;
  let speaker;
  let runtime;
  let attempt = 0;
  let dictation;
  let relay;
  const latency = createAvatarLatency();
  let listening = $state(false);
  let canListen = $state(false);
  const words = {
    ja: { title: '声・アバター', avatar: 'アバター', voice: '音声', ttsBackend: 'ZEN-TTS', backendHint: '切替時はアバターと音声合成を再初期化し、聞き取りを停止します。', backendFailed: 'WebGPUモードで開始できませんでした。CPUに戻して再試行してください。', kaiNote: 'カイは音声のみ公開されています。カイ専用のリップシンク用アバターはありません。', enable: 'アバターを開始', disable: '閉じる', loading: '読み込み中…', stop: '音声停止', listen: '連続聞き取り開始', end: '聞き取り停止', ai: 'AIによる映像', unavailable: 'アバターまたは音声モデルが未セットアップです。', setup: 'セットアップ手順', failed: 'アバターを読み込めませんでした。', blocked: 'メッセージを送信できません。接続を確認してください。', micError: '音声認識を開始できません。マイクの接続とブラウザーの許可を確認してください。', speechFailed: '音声の再生に失敗しました。ブラウザーの開発者ツールで原因を確認してください。', toolWait: 'ツールを利用します。少々お待ちください。', mic: '確定した音声認識結果から約0.8秒（未確定の場合は約1.1秒）の無音で送信します。音声認識はブラウザ提供元へ送信される場合があります。', retry: '再生を再開' },
    en: { title: 'Voice & avatar', avatar: 'Avatar', voice: 'Voice', ttsBackend: 'ZEN-TTS', backendHint: 'Switching reloads the avatar and TTS, and stops listening.', backendFailed: 'Could not start in WebGPU mode. Switch back to CPU and retry.', kaiNote: 'Kai is a TTS voice only; no matching lip-sync avatar has been published.', enable: 'Start avatar', disable: 'Close', loading: 'Loading…', stop: 'Stop voice', listen: 'Start continuous listening', end: 'Stop listening', ai: 'AI-generated avatar', unavailable: 'Avatar or voice models have not been set up.', setup: 'Setup instructions', failed: 'Could not load the avatar.', blocked: 'Message could not be sent. Check the connection.', micError: 'Speech recognition failed. Check microphone connection and browser permission.', speechFailed: 'Audio playback failed. Check the browser developer console for details.', toolWait: 'I will use a tool. Please wait a moment.', mic: 'Speech is sent after about 0.8 s of silence for a final transcript (1.1 s for interim results). Audio may be sent to the browser provider.', retry: 'Resume playback' },
  };
  let labels = $derived(words[getLang()] || words.en);
  let selectedAvatar = $derived(presets.find((item) => item.id === avatar));
  let selectedVoice = $derived(voices.find((item) => item.id === voice));

  function stop() { speaker?.stop(); }
  function changeTtsBackend(next) {
    if (useWebGpu === next) return;
    useWebGpu = next;
    if (enabled) void start();
  }
  function stopVoice() { relay?.({ type: 'avatar_stop', preserveCapture: true }); }
  function close() {
    attempt++;
    stopVoice(); dictation?.cancel();
    speaker?.destroy(); speaker = null; runtime = null;
    enabled = false; loading = false;
  }
  async function start() {
    close(); error = ''; enabled = true; loading = true;
    const current = attempt;
    // Keep a separate node for each load so a stale SDK cannot mutate a new avatar.
    const target = document.createElement('div');
    container.replaceChildren(target);
    const ttsBackend = useWebGpu ? 'webgpu' : 'cpu';
    try {
      const loaded = await loadAvatar(target, avatar, voice, ttsBackend);
      if (current !== attempt) { loaded.avatar.destroy(); loaded.tts.destroy(); return; }
      runtime = loaded;
      speaker = createSpeaker(loaded, (cause) => {
        console.error('[uagav] Avatar speech failed', cause);
        error = labels.speechFailed;
      }, latency);
      // Try once after loading; the next click/Enter will retry in a gesture.
      try { loaded.avatar.resume(); }
      catch (cause) { console.warn('[uagav] Could not resume avatar audio', cause); }
    } catch (cause) {
      if (current === attempt) {
        console.error('[uagav] Avatar initialization failed', cause);
        close();
        error = ttsBackend === 'webgpu' ? labels.backendFailed : labels.failed;
      }
    }
    finally { if (current === attempt) loading = false; }
  }
  function listen() {
    if (listening) { dictation?.cancel(); return; }
    onInterrupt(); stopVoice(); error = '';
    dictation?.start();
  }
  onMount(() => {
    let mounted = true;
    // The audio device may remain suspended if the first user gesture was
    // consumed by loading the ZEN SDK and models. Resume at later gestures.
    const removeAudioActivation = installAvatarAudioActivation(
      document,
      () => !loading ? runtime?.avatar : null,
      (cause) => console.warn('[uagav] Could not resume avatar audio', cause),
    );
    canListen = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    fetch('/api/avatar/config').then(async (response) => {
      if (!response.ok) throw new Error();
      const config = await response.json();
      if (mounted) {
        presets = config.presets || [];
        voices = config.voices || [];
      }
    }).catch(() => {});
    dictation = createContinuousDictation(
      () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = getLang() === 'ja' ? 'ja-JP' : getLang();
        return recognition;
      },
      (text) => {
        if (!onSend(text, [])) { error = labels.blocked; return false; }
        error = '';
        return true;
      },
      (value) => { listening = value; },
      () => { error = labels.micError; },
      AVATAR_FINAL_SILENCE_MS,
      latency,
    );
    relay = createAvatarRelay((text, options) => speaker?.speak(text, options), stop, () => dictation?.cancel(), () => dictation?.pause(), () => dictation?.resume(), () => labels.toolWait, latency);
    const unsubscribe = subscribeAvatar(relay);
    return () => {
      mounted = false;
      removeAudioActivation();
      unsubscribe();
      close();
      latency.reset();
    };
  });
</script>

<details class="avatar-panel" ontoggle={(event) => { if (!event.currentTarget.open) close(); }}>
  <summary>{labels.title}</summary>
  <div class="controls">
    <select aria-label={labels.avatar} bind:value={avatar} onchange={(event) => { voice = event.currentTarget.value; close(); }} disabled={loading}>
      {#each presets as item}<option value={item.id}>{item.name}</option>{/each}
    </select>
    <select aria-label={labels.voice} bind:value={voice} onchange={close} disabled={loading}>
      {#each voices as item}<option value={item.id}>{item.name}</option>{/each}
    </select>
    <label class="tts-switch" title={labels.backendHint}>
      <span>{labels.ttsBackend}</span>
      <input type="checkbox" role="switch" aria-label={labels.ttsBackend} aria-checked={useWebGpu} checked={useWebGpu} onchange={(event) => changeTtsBackend(event.currentTarget.checked)} disabled={loading} />
      <span>{useWebGpu ? 'WebGPU' : 'CPU'}</span>
    </label>
    {#if enabled}
      <button onclick={close}>{labels.disable}</button>
      <button onclick={stopVoice} disabled={loading}>{labels.stop}</button>
      <button onclick={() => runtime?.avatar.resume()} disabled={loading}>{labels.retry}</button>
    {:else}
      <button onclick={start} disabled={!selectedAvatar?.ready || !selectedVoice?.ready}>{labels.enable}</button>
    {/if}
    {#if canListen}<button onclick={listen}>{listening ? labels.end : labels.listen}</button>{/if}
  </div>
  {#if !selectedAvatar?.ready || !selectedVoice?.ready}<p>{labels.unavailable} <a href="https://github.com/awaku7/uag-web/blob/HEAD/docs/AVATAR.ja.md" target="_blank" rel="noopener noreferrer">{labels.setup}</a></p>{/if}
  {#if voice === 'kai'}<p class="note">{labels.kaiNote}</p>{/if}
  <div class="avatar-stage" class:active={enabled} bind:this={container}></div>
  {#if enabled}<p>{selectedAvatar?.name} / {selectedVoice?.name} — {labels.ai}</p>{/if}
  {#if loading}<p role="status">{labels.loading}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if canListen}<p class="note">{labels.mic}</p>{/if}
  <p class="note">音声合成：ZEN-TTS / リップシンク：ZEN-LipSync（<a href="https://zenryokukikai.com" target="_blank" rel="noopener noreferrer">https://zenryokukikai.com</a>）</p>
</details>

<style>
  .avatar-panel { flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 8px; padding: 8px; max-height: 45vh; overflow-y: auto; }
  summary { cursor: pointer; }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
  button, select { border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 8px; background: var(--bg-secondary); color: var(--text-primary); }
  button:disabled { opacity: .5; }
  .tts-switch { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; cursor: pointer; white-space: nowrap; }
  .tts-switch input { appearance: none; position: relative; box-sizing: border-box; width: 36px; height: 20px; margin: 0; border: 1px solid var(--border-color); border-radius: 999px; background: var(--bg-secondary); cursor: pointer; }
  .tts-switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-primary); transition: transform .15s ease; }
  .tts-switch input:checked { background: var(--accent-color, #2563eb); }
  .tts-switch input:checked::after { background: #fff; transform: translateX(16px); }
  .tts-switch input:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
  .tts-switch input:disabled { cursor: not-allowed; opacity: .55; }
  .tts-switch:has(input:disabled) { cursor: not-allowed; }
  .avatar-stage { display: none; width: 220px; max-width: 100%; }
  .avatar-stage.active { display: block; }
  p { font-size: .8rem; margin: 4px 0; }
  .note { font-size: .7rem; opacity: .8; }
  a { text-decoration: underline; }
</style>
