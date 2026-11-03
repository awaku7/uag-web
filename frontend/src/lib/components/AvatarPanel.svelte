<script>
  import { onMount } from 'svelte';
  import { getLang } from '../i18n.svelte.js';
  import { subscribeAvatar } from '../stores.svelte.js';
  import { loadAvatar, createSpeaker, createAvatarRelay, createContinuousDictation } from '../avatar.js';
  let { onSend, onInterrupt } = $props();
  let presets = $state([]);
  let voice = $state('marine');
  let enabled = $state(false);
  let loading = $state(false);
  let error = $state('');
  let container;
  let speaker;
  let runtime;
  let attempt = 0;
  let dictation;
  let relay;
  let listening = $state(false);
  let canListen = $state(false);
  const words = {
    ja: { title: '声・アバター', enable: 'アバターを開始', disable: '閉じる', loading: '読み込み中…', stop: '音声停止', listen: '連続聞き取り開始', end: '聞き取り停止', ai: 'AIによる映像', unavailable: '標準アバターは未セットアップです。', setup: 'セットアップ手順', failed: 'アバターを読み込めませんでした。', blocked: 'メッセージを送信できません。接続を確認してください。', micError: '音声認識を開始できません。マイクの接続とブラウザーの許可を確認してください。', mic: '無音が約1.1秒続くと発話を送信します。音声認識はブラウザ提供元へ送信される場合があります。', retry: '再生を再開' },
    en: { title: 'Voice & avatar', enable: 'Start avatar', disable: 'Close', loading: 'Loading…', stop: 'Stop voice', listen: 'Start continuous listening', end: 'Stop listening', ai: 'AI-generated avatar', unavailable: 'Standard avatars have not been set up.', setup: 'Setup instructions', failed: 'Could not load the avatar.', blocked: 'Message could not be sent. Check the connection.', micError: 'Speech recognition failed. Check microphone connection and browser permission.', mic: 'Speech is sent after about 1.1 seconds of silence. Audio may be sent to the browser provider.', retry: 'Resume playback' },
  };
  let labels = $derived(words[getLang()] || words.en);
  let selected = $derived(presets.find((item) => item.id === voice));

  function stop() { speaker?.stop(); }
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
    try {
      const loaded = await loadAvatar(target, voice);
      if (current !== attempt) { loaded.avatar.destroy(); loaded.tts.destroy(); return; }
      runtime = loaded;
      speaker = createSpeaker(loaded, () => { error = labels.failed; });
    } catch (_) { if (current === attempt) { close(); error = labels.failed; } }
    finally { if (current === attempt) loading = false; }
  }
  function listen() {
    if (listening) { dictation?.cancel(); return; }
    onInterrupt(); stopVoice(); error = '';
    dictation?.start();
  }
  onMount(() => {
    let mounted = true;
    canListen = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    fetch('/api/avatar/config').then(async (response) => {
      if (!response.ok) throw new Error();
      const config = await response.json();
      if (mounted) presets = config.presets;
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
      1100,
    );
    relay = createAvatarRelay((text) => speaker?.speak(text), stop, () => dictation?.cancel(), () => dictation?.pause(), () => dictation?.resume());
    const unsubscribe = subscribeAvatar(relay);
    return () => { mounted = false; unsubscribe(); close(); };
  });
</script>

<details class="avatar-panel" ontoggle={(event) => { if (!event.currentTarget.open) close(); }}>
  <summary>{labels.title}</summary>
  <div class="controls">
    <select aria-label={labels.title} bind:value={voice} onchange={close} disabled={loading}>
      {#each presets as item}<option value={item.id}>{item.name}</option>{/each}
    </select>
    {#if enabled}
      <button onclick={close}>{labels.disable}</button>
      <button onclick={stopVoice} disabled={loading}>{labels.stop}</button>
      <button onclick={() => runtime?.avatar.resume()} disabled={loading}>{labels.retry}</button>
    {:else}
      <button onclick={start} disabled={!selected?.ready}>{labels.enable}</button>
    {/if}
    {#if canListen}<button onclick={listen}>{listening ? labels.end : labels.listen}</button>{/if}
  </div>
  {#if !selected?.ready}<p>{labels.unavailable} <a href="https://github.com/awaku7/uag-web/blob/HEAD/docs/AVATAR.ja.md" target="_blank" rel="noopener noreferrer">{labels.setup}</a></p>{/if}
  <div class="avatar-stage" class:active={enabled} bind:this={container}></div>
  {#if enabled}<p>{selected?.name} — {labels.ai}</p>{/if}
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
  .avatar-stage { display: none; width: 220px; max-width: 100%; }
  .avatar-stage.active { display: block; }
  p { font-size: .8rem; margin: 4px 0; }
  .note { font-size: .7rem; opacity: .8; }
  a { text-decoration: underline; }
</style>
