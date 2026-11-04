// Manual integration test; requires locally installed official resources and Playwright.
// Run against a local uagav instance; WebSocket replies are synthetic, SDK/voices are real.
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--disable-vulkan-surface'] });
const page = await browser.newPage({ locale: 'ja-JP' });
let socket;
await page.addInitScript(() => {
  window.avatarAudio = {started:0, ended:0, samples:0};
  const original = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function(...args) {
    const source = original.apply(this,args);
    const start = source.start.bind(source);
    source.start = (...args) => { window.avatarAudio.started++; window.avatarAudio.samples += source.buffer?.length || 0; return start(...args); };
    source.addEventListener('ended',()=>window.avatarAudio.ended++);
    return source;
  };
});
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/avatar/')) console.log('HTTPERR', r.status(), r.url()); });
try {
  await page.routeWebSocket('**/ws?*', ws => { socket=ws; ws.send(JSON.stringify({type:'init',messages:[],status:{busy:false}})); });
  await page.goto(process.argv[2] || 'http://127.0.0.1:8000/');
  await page.locator('.avatar-panel summary').click();
  // Kai is TTS-only: pair it with the available Hashiro video avatar.
  for (const [avatar, voice] of [['marine', 'marine'], ['hashiro', 'hashiro'], ['kikka', 'kikka'], ['hashiro', 'kai']]) {
  await page.getByRole('combobox', {name:'アバター'}).selectOption(avatar);
  if (await page.getByRole('combobox', {name:'音声'}).inputValue() !== avatar) {
    throw new Error('Avatar switch did not reset the matched voice');
  }
  await page.getByRole('combobox', {name:'音声'}).selectOption(voice);
  await page.evaluate(() => window.avatarAudio = {started:0,ended:0,samples:0});
  await page.getByRole('button', {name: 'アバターを開始', exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.avatar-panel')?.textContent.includes('読み込み中'), null, {timeout:120000});
  console.log('UI', await page.locator('.avatar-panel').innerText());

  if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText());
  // Model loading is asynchronous. A real click after it completes is
  // required to unlock AudioContext in browsers enforcing autoplay policy.
  await page.locator('textarea').click();
  // The relay intentionally ignores assistant streams without an active user
  // turn. A synthetic user message is needed before synthetic assistant output.
  socket.send(JSON.stringify({type:'message',message:{role:'user',content:'音声の動作確認'}}));
  socket.send(JSON.stringify({type:'assistant_stream_start', id:'avatar-test'}));
  socket.send(JSON.stringify({type:'assistant_stream_delta', id:'avatar-test', delta:'こんにちは。'}));
  socket.send(JSON.stringify({type:'assistant_stream_end', id:'avatar-test'}));
  socket.send(JSON.stringify({type:'assistant_turn_complete'}));
  await page.waitForFunction(() => window.avatarAudio?.started > 0 || document.querySelector('[role=alert]'), null, {timeout:120000});
  if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText());
  await page.waitForFunction(() => window.avatarAudio?.ended > 0, null, {timeout:120000});
  console.log('SPEECH', avatar, voice, JSON.stringify(await page.evaluate(() => window.avatarAudio)));
  await page.getByRole('button', {name:'閉じる',exact:true}).click();
  }
  if (errors.length) throw new Error('Browser errors');

} finally { await browser.close(); }
