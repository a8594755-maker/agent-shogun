import { spawn } from 'node:child_process';
import { sleep } from './io.mjs';
import { ownChild, terminateOwned } from './process-owner.mjs';

/**
 * Reads the signed-in Grok plan's billing period through the CLI's own agent protocol (ACP, JSON-RPC over stdio):
 * `grok agent --no-leader stdio`, then `initialize` and the xAI extension `_x.ai/billing`. This is a control call:
 * no session, no prompt, no model turn. The CLI uses its own sign-in; roster never reads `~/.grok/auth.json`.
 * `--no-leader` starts a short-lived local agent instead of attaching to the user's shared leader process.
 * `_x.ai/billing` is an undocumented extension: callers must treat any failure as "unknown", never as 0 %.
 */
export async function readGrokBilling(binary, { timeoutMs = 15000 } = {}) {
  const child = spawn(binary.file, [...binary.args, 'agent', '--no-leader', 'stdio'], { shell: false, windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', pending, timer, closed = false, rejected;
  const exit = new Promise(resolve => child.once('close', () => { closed = true; pending?.reject(new Error('Grok agent closed before replying.')); resolve(); }));
  child.on('error', () => { rejected = new Error('Cannot start the Grok agent.'); pending?.reject(rejected); });
  child.stdin.on('error', () => { pending?.reject(new Error('Grok agent input closed.')); });
  child.stderr.resume(); // Never print diagnostics: they can hold account or host data.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    if (buffer.length > 1024 * 1024) { pending?.reject(new Error('Grok agent reply exceeds 1 MiB.')); buffer = ''; return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (pending && message.id === pending.id) {
        if (message.error) pending.reject(Object.assign(new Error('Grok agent rejected the request.'), { code: message.error.code }));
        else pending.resolve(message.result);
      }
    }
  });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const request = (id, method, params) => new Promise((resolve, reject) => {
    pending = { id, resolve, reject };
    if (rejected || closed) { reject(rejected || new Error('Grok agent is closed.')); return; }
    send({ jsonrpc: '2.0', id, method, params });
  });
  try {
    await ownChild(child);
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Grok billing request timed out.')), timeoutMs); });
    return await Promise.race([timeout, (async () => {
      await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
      return request(2, '_x.ai/billing', {});
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
