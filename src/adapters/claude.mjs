import { envelope, tokens } from './common.mjs';
import { readClaudeUsage } from '../claude-usage.mjs';
import { claudeAuth } from '../provider-auth.mjs';
import { resolveModelEffort } from '../model-selection.mjs';
export default {
  name: 'claude', signIn: 'claude auth login', authState: claudeAuth,
  build({ model, effort, access, sessionId, catalog }) {
    ({model,effort}=resolveModelEffort('claude',model,effort,{catalog}));
    return { args: ['-p', '--output-format', 'json', '--model', model, '--effort', effort, '--permission-mode', access === 'full' ? 'bypassPermissions' : 'acceptEdits', ...(sessionId ? ['--resume', sessionId] : [])], stdin: true };
  },
  async parse(file) {
    const e = await envelope(file);
    return { sessionId: e.session_id, answer: e.result || '', usage: tokens(e.usage), ok: e.type === 'result' && e.subtype === 'success' && !e.is_error, error: e.is_error ? e.result : undefined, details: { numTurns: e.num_turns, deniedActions: e.permission_denials || [] } };
  },
  readUsage: readClaudeUsage
};
