import fs from 'node:fs';
import readline from 'node:readline';
import { tokens } from './common.mjs';
import { readCodexAllowance } from '../codex-usage.mjs';
import { codexAuth } from '../provider-auth.mjs';

export default {
  name: 'codex', signIn: 'codex login', authState: codexAuth,
  build({ model, effort, access, web, sessionId, answer }) {
    const args = [...(sessionId && access === 'safe' ? ['--approve-for-me'] : []), 'exec', ...(sessionId ? ['resume', sessionId] : []), '-m', model, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`];
    if (access === 'full') args.push(...(sessionId ? ['-c', 'sandbox_mode="danger-full-access"'] : ['-s', 'danger-full-access']), '-c', 'approval_policy="never"');
    else if (!sessionId) args.push('--approve-for-me');
    if (web) args.push('-c', 'web_search="live"');
    args.push('--json', '-o', answer, '-');
    return { args, stdin: true };
  },
  async parse(file) {
    let sessionId, usage, answer = '', completed = false, error;
    for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'thread.started') sessionId = event.thread_id;
      if (event.type === 'turn.completed') { usage = event.usage; completed = true; error = undefined; }
      if (event.type === 'turn.failed' || event.type === 'error') { error = event.error?.message || event.message || 'Provider error'; completed = false; }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') answer = event.item.text || '';
    }
    return { sessionId, usage: tokens(usage), answer, ok: completed && !error, error };
  },
  readUsage: readCodexAllowance
};
