import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { adapters } from './adapters/index.mjs';
import { limitedMessage } from './adapters/common.mjs';
import { childEnv, agySettings } from './guards.mjs';
import { readJson, writeJson, sleep, gitState, exec } from './io.mjs';
import { turnDir, sessionDir } from './sessions.mjs';

async function run() {
  const [, , root, name, n] = process.argv;
  const dir = turnDir(root, name, Number(n));
  const { meta, config, binary, nonce } = await readJson(path.join(dir, 'request.json'));
  let child, stopped = false, interrupted = false, tickBusy = false, timer, stderrTail = '', stdoutTail = '', parsed = {}, failure;
  const answerFile = path.join(dir, 'answer.txt'), events = path.join(dir, 'events.jsonl');
  const beat = () => writeJson(path.join(dir, 'heartbeat.json'), { nonce, at: new Date().toISOString() });
  async function killTree() {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      // This PID comes from our live ChildProcess, never from session metadata.
      if (child.exitCode === null && child.signalCode === null) await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
  }
  const interrupt = async () => { stopped = true; await killTree(); };
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  try {
    // The launching process publishes ownership before this supervisor launches any provider.
    for (let i = 0; i < 100; i++) {
      const record = await readJson(path.join(dir, 'running.json'), null);
      if (record?.nonce === nonce && record.pid === process.pid) break;
      if (i === 99) throw new Error('Launcher did not publish supervisor ownership.');
      await sleep(50);
    }
    await beat();
    const prompt = await fsp.readFile(path.join(dir, 'prompt.txt'), 'utf8');
    const settings = path.join(dir, 'settings.json');
    if (meta.provider === 'agy') await writeJson(settings, agySettings(config, meta.web, meta.access));
    const invocation = adapters[meta.provider].build({ ...meta, answer: answerFile, prompt, settings });
    const outFd = fs.openSync(events, 'a'), errFd = fs.openSync(path.join(dir, 'stderr.txt'), 'a');
    let exitCode;
    try {
      child = spawn(binary.file, [...binary.args, ...invocation.args], { cwd: meta.directory, env: childEnv(config), shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { fs.writeSync(outFd, data); stdoutTail = (stdoutTail + data.toString()).slice(-16384); });
      child.stderr.on('data', data => { fs.writeSync(errFd, data); stderrTail = (stderrTail + data.toString()).slice(-16384); });
      child.stdin.on('error', () => {});
      child.stdin.end(invocation.stdin ? prompt : undefined);
      timer = setInterval(async () => {
        if (tickBusy) return;
        tickBusy = true;
        try {
          const stop = await readJson(path.join(dir, 'stop.json'), null);
          const result = await readJson(path.join(dir, 'result.json'), null);
          if (result?.error === 'interrupted') { interrupted = true; await interrupt(); }
          else if (stop?.nonce === nonce) await interrupt();
          else await beat();
        } catch (e) { failure = e.message; await interrupt(); }
        finally { tickBusy = false; }
      }, 200);
      exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? `signal:${signal}`)); });
    } finally { clearInterval(timer); fs.closeSync(outFd); fs.closeSync(errFd); }
    try { parsed = await adapters[meta.provider].parse(events); }
    catch (e) { failure = `Invalid provider output: ${e.message}`; }
    if (parsed.answer) await fsp.writeFile(answerFile, parsed.answer);
    if (!fs.existsSync(answerFile)) await fsp.writeFile(answerFile, '');
    if (interrupted) failure = 'interrupted';
    else if (stopped) failure = 'stopped';
    else if (exitCode !== 0) failure ||= `Provider exited ${exitCode}`;
    else if (!parsed.ok) failure ||= parsed.error || 'Provider did not report a successful completed turn.';
    const limitText = [parsed.error, parsed.ok ? '' : parsed.answer, stderrTail, stdoutTail].filter(Boolean).join('\n');
    const limited = !!failure && limitedMessage(limitText);
    const messageLine = limitText.split(/\r?\n/).find(limitedMessage) || '';
    const result = { provider: meta.provider, state: failure ? 'failed' : 'done', error: failure, exitCode, startedAt: meta.startedAt, endedAt: new Date().toISOString(), sessionId: parsed.sessionId || meta.sessionId, tokens: parsed.usage || { total: 0 }, details: parsed.details, limited, ...(limited ? { limitMessage: messageLine.slice(0, 500) } : {}), ...await gitState(meta.directory) };
    if ((await readJson(path.join(dir, 'result.json'), null))?.error === 'interrupted') return;
    await writeJson(path.join(dir, 'result.json'), result);
    await fsp.appendFile(path.join(sessionDir(root, name), 'turns.jsonl'), JSON.stringify({ turn: meta.turn, ...result }) + '\n');
  } catch (e) {
    await killTree();
    if ((await readJson(path.join(dir, 'result.json'), null))?.error === 'interrupted') return;
    const result = { provider: meta.provider, state: 'failed', error: e.message, startedAt: meta.startedAt, endedAt: new Date().toISOString(), tokens: { total: 0 } };
    await writeJson(path.join(dir, 'result.json'), result);
    await fsp.appendFile(path.join(sessionDir(root, name), 'turns.jsonl'), JSON.stringify({ turn: meta.turn, ...result }) + '\n');
  } finally { clearInterval(timer); }
}
await run();
