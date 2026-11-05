import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/lib/stores.svelte.js', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('export {'))
  .join('\n')
  .replaceAll('export ', '');

function makeHarness(debug = true) {
  const logs = [];
  const sockets = [];
  let elapsed = 0;
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() {
      this.readyState = FakeSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    close() { this.readyState = 3; }
  }
  const context = createContext({
    $state: (value) => value,
    URL,
    WebSocket: FakeSocket,
    document: { documentElement: { lang: 'en' } },
    history: { replaceState() {} },
    performance: { now: () => elapsed },
    console: { info: (message) => logs.push(message), warn() {} },
    window: {
      location: {
        href: `https://example.test/room/alpha${debug ? '?uag_latency=1' : ''}`,
        host: 'example.test',
        protocol: 'https:',
      },
    },
  });
  runInContext(source, context);
  runInContext('connect()', context);
  const socket = sockets[0];
  socket.readyState = FakeSocket.OPEN;
  socket.onopen();
  return {
    logs,
    socket,
    setElapsed(value) { elapsed = value; },
    send(text = 'test prompt') { return runInContext(`sendUserInput(${JSON.stringify(text)}, [])`, context); },
    event(value) { socket.onmessage({ data: JSON.stringify(value) }); },
  };
}

test('opt-in latency probe records first tool and first working tool once', () => {
  const h = makeHarness();
  assert.equal(h.send('private prompt'), true);
  h.setElapsed(50);
  h.event({ type: 'status', status: { busy: true, label: 'QUEUED' } });
  h.setElapsed(120);
  h.event({ type: 'status', status: { busy: true, label: 'BUSY' } });
  h.setElapsed(300);
  h.event({ type: 'tool_activity', name: 'tool_catalog' });
  h.setElapsed(450);
  h.event({ type: 'tool_activity', name: 'tool_load' });
  h.setElapsed(750);
  h.event({ type: 'tool_activity', name: 'read_file' });
  h.setElapsed(950);
  h.event({ type: 'assistant_stream_start', id: 'asst_1' });
  h.setElapsed(1000);
  h.event({ type: 'tool_activity', name: 'write_file' });
  assert.deepEqual(h.logs, [
    '[uag-latency] queued=50ms',
    '[uag-latency] busy=120ms',
    '[uag-latency] first_tool=300ms (tool_catalog)',
    '[uag-latency] first_work_tool=750ms (read_file)',
    '[uag-latency] first_response=950ms',
  ]);
  assert.equal(h.logs.some((message) => message.includes('private prompt')), false);
});

test('latency logging is off without an explicit URL parameter', () => {
  const h = makeHarness(false);
  assert.equal(h.send(), true);
  h.setElapsed(300);
  h.event({ type: 'tool_activity', name: 'read_file' });
  assert.deepEqual(h.logs, []);
});

test('new user input restarts timing and ignores empty tool activity', () => {
  const h = makeHarness();
  h.send();
  h.setElapsed(200);
  h.event({ type: 'tool_activity', name: '' });
  h.setElapsed(400);
  h.send();
  h.setElapsed(460);
  h.event({ type: 'tool_activity', name: 'cmd_exec' });
  assert.deepEqual(h.logs, [
    '[uag-latency] first_tool=60ms (cmd_exec)',
    '[uag-latency] first_work_tool=60ms (cmd_exec)',
  ]);
});
