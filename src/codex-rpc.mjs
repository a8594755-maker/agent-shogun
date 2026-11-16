import { spawn } from 'node:child_process';
import { exec, sleep } from './io.mjs';
import { ownChild, terminateOwned } from './process-owner.mjs';

export async function readRateLimits(binary, { timeoutMs = 15000 } = {}) {
  const child = spawn(binary.file, [...binary.args, 'app-server', '--stdio'], { shell: false, windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', pending, timer, closed = false, rejected;
  const exit = new Promise(resolve => child.once('close', () => { closed = true; pending?.reject(new Error('Codex app-server closed before replying.')); resolve(); }));
  child.on('error', () => { rejected = new Error('Cannot start Codex app-server.'); pending?.reject(rejected); });
  child.stdin.on('error', () => { pending?.reject(new Error('Codex app-server input closed.')); });
  child.stderr.resume(); // Never dump diagnostics that could contain account or host data.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    if (buffer.length > 1024 * 1024) { pending?.reject(new Error('Codex app-server reply exceeds 1 MiB.')); buffer = ''; return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (pending && message.id === pending.id) {
        if (message.error) pending.reject(new Error('Codex app-server rejected the usage request.'));
        else pending.resolve(message.result);
      }
    }
  });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const request = (id, method, params) => new Promise((resolve, reject) => {
    pending = { id, resolve, reject };
    if (rejected || closed) { reject(rejected || new Error('Codex app-server is closed.')); return; }
    send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
  });
  try {
    await ownChild(child);
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Codex app-server usage timed out.')), timeoutMs); });
    return await Promise.race([timeout, (async () => {
      await request(1, 'initialize', { clientInfo: { name: 'agent-shogun', version: '0.1.0' }, capabilities: { experimentalApi: false } });
      send({ jsonrpc: '2.0', method: 'initialized' });
      return request(2, 'account/rateLimits/read');
    })()]);
  } finally {
    clearTimeout(timer); child.stdin.end();
    await Promise.race([exit, sleep(500)]);
    if (!closed) {
      await terminateOwned(child);
      await exit;
    }
  }
}
