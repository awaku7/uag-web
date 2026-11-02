import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stripVTControlCharacters } from 'node:util';

test('Vite development modules stay on the frontend server', { timeout: 30000 }, async () => {
  const child = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const exited = once(child, 'exit');
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  let readyTimer;
  try {
    const origin = await new Promise((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error(output || 'Vite did not start')), 15000);
      child.on('error', reject);
      child.on('exit', () => reject(new Error(output || 'Vite exited before startup')));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = stripVTControlCharacters(output).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    clearTimeout(readyTimer);
    for (const path of ['/@vite/client', '/src/main.js', '/src/App.svelte']) {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /javascript/, path);
      assert.ok((await response.text()).length > 0, path);
    }
  } finally {
    clearTimeout(readyTimer);
    child.kill();
    await exited;
  }
});
