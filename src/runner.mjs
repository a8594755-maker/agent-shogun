import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { adapters } from './adapters/index.mjs';
import { limitedMessage } from './adapters/common.mjs';
import { childEnv, agySettings } from './guards.mjs';
import { readJson, writeJson, sleep, gitState, exec } from './io.mjs';
import { turnDir, sessionDir } from './sessions.mjs';
import { groupForModel } from './allowance.mjs';
import { ownChild, terminateOwned } from './process-owner.mjs';

async function run() {
  const [, , root, name, n] = process.argv;
  const dir = turnDir(root, name, Number(n));
  const { meta, config, binary, nonce } = await readJson(path.join(dir, 'request.json'));
  let child, stopped = false, interrupted = false, tickBusy = false, timer, stderrTail = '', stdoutTail = '', parsed = {}, failure, termination;
  const answerFile = path.join(dir, 'answer.txt'), events = path.join(dir, 'events.jsonl');
  const beat = () => writeJson(path.join(dir, 'heartbeat.json'), { nonce, at: new Date().toISOString() });
  const audit = event => fsp.appendFile(path.join(dir,'control.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n').catch(()=>{});
  const killTree = async () => { if (child) return terminateOwned(child); };
  const interrupt = async reason => { stopped = true; termination = reason; await audit(reason); await killTree(); };
  // A console interrupt from a provider/test terminal is not an authenticated roster stop.
  process.on('SIGINT', () => { void audit({event:'ignored_signal',signal:'SIGINT'}); });
  process.on('SIGTERM', () => { void interrupt({event:'signal',signal:'SIGTERM'}); });
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
    const invocation = adapters[meta.provider].build({ ...meta, providerConfig: config.providers[meta.provider], answer: answerFile, prompt, promptFile: path.join(dir, 'prompt.txt'), settings });
    const outFd = fs.openSync(events, 'a'), errFd = fs.openSync(path.join(dir, 'stderr.txt'), 'a');
    let exitCode;
    try {
      child = spawn(binary.file, [...binary.args, ...invocation.args], { cwd: meta.directory, env: {...childEnv(config),ROSTER_CHILD_TOKEN:nonce}, shell: false, detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? `signal:${signal}`)); });
      finished.catch(()=>{});
      child.stdout.on('data', data => { fs.writeSync(outFd, data); stdoutTail = (stdoutTail + data.toString()).slice(-16384); });
      child.stderr.on('data', data => { fs.writeSync(errFd, data); stderrTail = (stderrTail + data.toString()).slice(-16384); });
      child.stdin.on('error', () => {});
      child.stdin.end(invocation.stdin ? prompt : undefined);
      const ownership = await ownChild(child,nonce);
      await writeJson(path.join(dir,'child.json'),ownership);
      await audit({event:'provider_started',pid:ownership.pid,startTime:ownership.startTime});
      timer = setInterval(async () => {
        if (tickBusy) return;
        tickBusy = true;
        try {
          const stop = await readJson(path.join(dir, 'stop.json'), null);
          const result = await readJson(path.join(dir, 'result.json'), null);
          const abort = process.env.ROSTER_TEST_MODE ? await readJson(path.join(dir,'test-abort.json'),null) : null;
          if (abort?.nonce === nonce) { await killTree(); process.exit(99); }
          if (result?.error === 'interrupted') { interrupted = true; await interrupt({event:'interrupted_record'}); }
          else if (stop?.nonce === nonce) await interrupt({event:'stop_request',requestedBy:stop.requestedBy,requestedAt:stop.requestedAt});
          else await beat();
        } catch (e) { await audit({event:'control_io_error',code:e.code||e.name}); }
        finally { tickBusy = false; }
      }, 200);
      exitCode = await finished;
    } finally { clearInterval(timer); fs.closeSync(outFd); fs.closeSync(errFd); }
    try { parsed = await adapters[meta.provider].parse(events); }
    catch (e) { failure = `Invalid provider output: ${e.message}`; }
    if (parsed.answer) await fsp.writeFile(answerFile, parsed.answer);
    if (!fs.existsSync(answerFile)) await fsp.writeFile(answerFile, '');
    if (interrupted) failure = 'interrupted';
    else if (stopped) failure = termination?.event === 'stop_request' ? 'stopped' : `interrupted: ${termination?.signal || termination?.event}`;
    else if (meta.provider === 'grok' && parsed.details?.stopReason === 'cancelled') failure = 'cancelled (permission?)';
    else if (exitCode !== 0) failure ||= `Provider exited ${exitCode}`;
    else if (!parsed.ok) failure ||= parsed.error || 'Provider did not report a successful completed turn.';
    const limitText = [parsed.error, parsed.ok ? '' : parsed.answer, stderrTail, stdoutTail].filter(Boolean).join('\n');
    const parsedFailure = adapters[meta.provider].parseFailure?.(stderrTail);
    const limited = !!failure && (!!parsedFailure?.limited || limitedMessage(limitText));
    const messageLine = limitText.split(/\r?\n/).find(limitedMessage) || '';
    if (termination) parsed.details = {...parsed.details,termination};
    const result = { provider: meta.provider, model: meta.model, group: groupForModel(meta.provider, meta.model), state: failure ? 'failed' : 'done', error: failure, exitCode, startedAt: meta.startedAt, endedAt: new Date().toISOString(), sessionId: parsed.sessionId || meta.sessionId || meta.providerSessionId, tokens: parsed.usage || { total: 0 }, costUsd: parsed.costUsd ?? null, details: parsed.details, limited, ...(limited ? { limitMessage: (parsedFailure?.message || messageLine).slice(0, 500), limitResetsAt: parsedFailure?.resetsAt || null } : {}), ...await gitState(meta.directory) };
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
