import { envelope, tokens } from './common.mjs';
export default {
  name: 'claude',
  build({ model, effort, access, sessionId }) {
    return { args: ['-p', '--output-format', 'json', '--model', model, '--effort', effort, '--permission-mode', access === 'full' ? 'bypassPermissions' : 'acceptEdits', ...(sessionId ? ['--resume', sessionId] : [])], stdin: true };
  },
  async parse(file) {
    const e = await envelope(file);
    return { sessionId: e.session_id, answer: e.result || '', usage: tokens(e.usage), ok: e.type === 'result' && e.subtype === 'success' && !e.is_error, error: e.is_error ? e.result : undefined, details: { numTurns: e.num_turns, deniedActions: e.permission_denials || [] } };
  },
  async readUsage() { return { unknown: true, reason: 'No stable local quota source is known; use usage set.' }; }
};
