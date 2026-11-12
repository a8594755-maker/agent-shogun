import { envelope, tokens } from './common.mjs';
import { grokAuth } from '../provider-auth.mjs';
import fs from 'node:fs';
import path from 'node:path';

export function grokSafeAllows(directory, configured) {
  const commands = configured || ['node --test', 'npm test'];
  if (!configured) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.scripts || {})) if (/^(test(?::[\w-]+)?|check|typecheck|lint|build)$/.test(name)) commands.push(`npm run ${name}`);
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  return ['Edit(./**)', 'Write(./**)', 'Bash(git add *)', 'Bash(git commit *)', ...commands.map(c => `Bash(${c})`), ...commands.map(c => `Bash(${c} *)`)];
}

export default {
  name: 'grok', signIn: 'grok login', modelsArgs: ['models'], authState: grokAuth,
  parseModels(text) { return [...new Set([...text.matchAll(/^\s*[-*]\s+(grok-[\w.-]+)/gm)].map(m => m[1]))]; },
  build({ model, effort, access, web, sessionId, providerSessionId, directory, promptFile, providerConfig }) {
    const args = ['--prompt-file', promptFile, '-m', model, '--reasoning-effort', effort, '--output-format', 'json', '--cwd', directory, ...(sessionId ? ['-r', sessionId] : ['-s', providerSessionId])];
    if (access === 'full') args.push('--permission-mode', 'bypassPermissions', '--sandbox', 'off');
    else {
      args.push('--permission-mode', 'default', '--sandbox', 'workspace');
      for (const rule of grokSafeAllows(directory, providerConfig?.testCommands)) args.push('--allow', rule);
      for (const rule of ['Bash(git push*)', 'Bash(git * push*)', 'Bash(*wrangler*)', 'Bash(*vercel*)', 'Bash(*netlify*)', 'Bash(*firebase deploy*)', 'Bash(*npm publish*)', 'Bash(*npm run deploy*)', 'Bash(*pnpm publish*)', 'Bash(*yarn publish*)']) args.push('--deny', rule);
    }
    if (!web) args.push('--disable-web-search');
    return { args };
  },
  async parse(file) {
    const e = await envelope(file), complete = e.stopReason === 'end_turn';
    return { sessionId: e.sessionId, answer: e.text || '', usage: tokens(e.usage), ok: complete && e.type !== 'error', error: e.stopReason === 'cancelled' ? 'cancelled (permission?)' : e.message || (!complete ? `Grok stopped: ${e.stopReason || 'unknown'}` : undefined), costUsd: Number.isFinite(e.total_cost_usd) && e.total_cost_usd >= 0 ? e.total_cost_usd : null, details: { stopReason: e.stopReason, numTurns: e.num_turns, costIsPartial: !!e.cost_is_partial, usageIsIncomplete: !!e.usage_is_incomplete } };
  },
  async readUsage() { return { unknown: true, source: 'local roster Grok receipts', reason: 'No headless plan-allowance command; local token/cost gauge only.' }; }
};
