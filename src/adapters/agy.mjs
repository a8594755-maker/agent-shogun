import { envelope, tokens } from './common.mjs';
import { readAgyUsage, parseAgyFailure } from '../agy-usage.mjs';
import { agyAuth } from '../provider-auth.mjs';
import { resolveModelEffort } from '../model-selection.mjs';
export default {
  name: 'agy', modelsArgs: ['models'], signIn: 'agy', authState: agyAuth,
  parseModels(text) { return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^fetching\b/i.test(s)).map(s => s.split(/\s/)[0]); },
  build({ model, effort, sessionId, settings, prompt, catalog }) {
    ({model,effort}=resolveModelEffort('agy',model,effort,{catalog}));
    return { args: ['-p', prompt, '--model', model, '--effort', effort, '--output-format', 'json', '--settings', settings, '--mode', 'accept-edits', '--disable-slash-commands', ...(sessionId ? ['--conversation', sessionId] : [])] };
  },
  async parse(file) {
    const e = await envelope(file);
    return { sessionId: e.conversation_id, answer: e.response || '', usage: tokens(e.usage), ok: ['success', 'completed', 'done', 'ok'].includes(String(e.status).toLowerCase()), error: e.error?.message || (typeof e.error === 'string' ? e.error : undefined), details: { status: e.status, numTurns: e.num_turns, deniedActions: e.denied_actions || [] } };
  },
  readUsage: readAgyUsage,
  parseFailure: parseAgyFailure
};
