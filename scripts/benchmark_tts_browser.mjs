// Manual device benchmark. It uses the same-origin official ZEN-TTS assets
// installed by the operator; no LLM traffic, microphone, chat text, or uploads.
// Usage: node scripts/benchmark_tts_browser.mjs [uagav-url] [voice-id]
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const serverUrl = process.argv[2] || 'http://127.0.0.1:8000/';
const voiceId = process.argv[3] || 'marine';
if (!['marine', 'hashiro', 'kai', 'kikka'].includes(voiceId)) {
  throw new Error('Unknown ZEN-TTS voice. Use marine, hashiro, kai, or kikka.');
}
const target = new URL(serverUrl);
if (!['http:', 'https:'].includes(target.protocol)) {
  throw new Error('The uagav URL must use HTTP or HTTPS.');
}

// Headful Chromium is intentional: do not force SwiftShader or software Vulkan
// and then present those numbers as physical-GPU measurements.
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ locale: 'ja-JP' });
page.setDefaultTimeout(180000);
try {
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async ({ voiceId }) => {
    const configResponse = await fetch('/api/avatar/config');
    if (!configResponse.ok) {
      throw new Error(`Avatar config returned HTTP ${configResponse.status}. Check the local uagav session.`);
    }
    const config = await configResponse.json();
    if (!config.voices?.some((item) => item.id === voiceId && item.ready)) {
      throw new Error(`ZEN-TTS voice "${voiceId}" is not ready. Run scripts/setup_avatar.py first.`);
    }
    const { ZenTts } = await import('/api/avatar/files/tts/dist/index.js');
    const sampleText = 'こんにちは。音声合成の速度を測定しています。';
    const repeats = 3;
    function median(values) {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }
    async function measure(tts) {
      const start = performance.now();
      let firstChunkMs = null;
      let audioSeconds = 0;
      let chunks = 0;
      for await (const part of tts.speakStream(sampleText)) {
        if (firstChunkMs === null) firstChunkMs = performance.now() - start;
        if (!part.pcm?.length || !part.sampleRate) throw new Error('ZEN-TTS returned an invalid PCM chunk.');
        audioSeconds += part.pcm.length / part.sampleRate;
        chunks++;
      }
      if (!chunks) throw new Error('ZEN-TTS returned no audio chunks.');
      const totalMs = performance.now() - start;
      return {
        firstChunkMs,
        totalMs,
        audioSeconds,
        rtf: totalMs / (audioSeconds * 1000),
      };
    }
    async function benchmark(backend) {
      let tts;
      try {
        const started = performance.now();
        tts = await ZenTts.load({
          backend,
          model: `/api/avatar/files/models/${voiceId}.ztm`,
          modelsUrl: '/api/avatar/files/tts/models',
          cpuWasmUrl: '/api/avatar/files/tts/cpu/tts-cpu.wasm',
        });
        const loadMs = performance.now() - started;
        // Ignore the first synthesis: kernel initialization and warm-up can
        // dominate a short utterance. Execute backends sequentially.
        await measure(tts);
        const samples = [];
        for (let i = 0; i < repeats; i++) samples.push(await measure(tts));
        return {
          requestedBackend: backend,
          actualBackend: tts.backend || backend,
          loadMs: Math.round(loadMs),
          medianFirstChunkMs: Math.round(median(samples.map((s) => s.firstChunkMs))),
          medianTotalMs: Math.round(median(samples.map((s) => s.totalMs))),
          medianRtf: Number(median(samples.map((s) => s.rtf)).toFixed(3)),
          medianAudioSeconds: Number(median(samples.map((s) => s.audioSeconds)).toFixed(2)),
          repeats,
        };
      } catch (error) {
        return { requestedBackend: backend, error: String(error?.message || error) };
      } finally {
        try { tts?.destroy?.(); } catch (_) { /* Keep original benchmark result. */ }
      }
    }
    return {
      voiceId,
      webgpuExposed: !!navigator.gpu,
      results: [await benchmark('cpu'), await benchmark('webgpu')],
    };
  }, { voiceId });
  console.log('ZEN-TTS device benchmark (fixed non-user sample text):');
  console.log(JSON.stringify(results, null, 2));
  console.log('Compare medianFirstChunkMs for response latency, and medianRtf for synthesis throughput.');
  console.log('These tests do not include concurrent lip-sync/WebGPU rendering; do not switch backends without a real conversation check.');
  if (results.results.every((entry) => entry.error)) process.exitCode = 1;
} finally {
  await browser.close();
}
