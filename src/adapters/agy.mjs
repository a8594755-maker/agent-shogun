import { tokens } from './common.mjs';
import fs from 'node:fs';
import readline from 'node:readline';
import { readAgyUsage, parseAgyFailure } from '../agy-usage.mjs';
import { agyAuth } from '../provider-auth.mjs';
import { resolveModelEffort } from '../model-selection.mjs';
export default {
  name: 'agy', modelsArgs: ['models'], signIn: 'agy', authState: agyAuth,
  parseModels(text) { return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^fetching\b/i.test(s)).map(s => s.split(/\s/)[0]); },
  build({ model, effort, sessionId, settings, prompt, catalog }) {
    ({model,effort}=resolveModelEffort('agy',model,effort,{catalog}));
    return { args: ['--model', model, '--effort', effort, '--input-format','stream-json','--output-format', 'stream-json', '--settings', settings, '--mode', 'accept-edits', '--disable-slash-commands', ...(sessionId ? ['--conversation', sessionId] : [])],stdin:true,input:JSON.stringify({event:'user',message:{content:prompt}})+'\n' };
  },
  async parse(file) {
    let e;
    for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
      let value;try{value=JSON.parse(line);}catch{continue;}
      if(value.event==='result')e=value.result;
      else if(value.conversation_id&&value.status)e=value; // pre-stream roster logs remain readable
    }
    if(!e)throw new Error('No Antigravity terminal result envelope');
    return { sessionId: e.conversation_id, answer: e.response || '', usage: tokens(e.usage), ok: ['success', 'completed', 'done', 'ok'].includes(String(e.status).toLowerCase()), error: e.error?.message || (typeof e.error === 'string' ? e.error : undefined), details: { status: e.status, numTurns: e.num_turns, deniedActions: e.denied_actions || [] } };
  },
  readUsage: readAgyUsage,
  parseFailure: parseAgyFailure
};
