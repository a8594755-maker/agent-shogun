import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './io.mjs';

export const providerNames = ['codex', 'agy', 'claude'];
const choice = (provider, model, effort = 'medium', web = false) => ({ provider, model, effort, ...(web ? { web } : {}) });
export const defaults = {
  providers: {
    codex: { model: 'gpt-6-astra', effort: 'low' },
    agy: { model: 'gemini-3.8-flash-low', effort: 'low' },
    claude: { model: 'sonnet', effort: 'medium' }
  },
  access: 'safe',
  guards: { blockPush: true, env: { CLOUDFLARE_API_TOKEN: 'roster-deploy-disabled' }, antigravityDeny: true },
  briefHeader: 'Work only in your assigned directory. Commit only on your assigned branch. Never push, deploy, or publish. Run the type check and tests yourself and loop until green. Never weaken an existing test.',
  kinds: {
    ui: [choice('claude', 'sonnet'), choice('agy', 'gemini-3.8-flash-low'), choice('codex', 'gpt-6-astra', 'low')],
    server: [choice('codex', 'gpt-6-astra', 'low'), choice('claude', 'sonnet'), choice('agy', 'gemini-3.8-flash-low')],
    mechanical: [choice('codex', 'gpt-6-astra', 'low'), choice('agy', 'gemini-3.8-flash-low'), choice('claude', 'sonnet')],
    review: [choice('agy', 'gemini-3.8-flash-low'), choice('codex', 'gpt-6-astra', 'low'), choice('claude', 'sonnet')],
    research: [choice('agy', 'gemini-3.8-flash-low', 'low', true), choice('claude', 'sonnet', 'medium', true), choice('codex', 'gpt-6-astra', 'low', true)]
  },
  usage: { ceiling: 90, balancePoints: 25, suppliedMaxAgeMinutes: 30, cacheSeconds: 30, sourceMaxAgeMinutes: 30 }
};
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Unsafe configuration property.');
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k] || {}, v) : v;
  }
  return out;
}
export function checkProvider(name) {
  if (!providerNames.includes(name)) throw new Error(`Unknown provider: ${name}`);
  return name;
}
export async function loadConfig(root) {
  const c = merge(defaults, await readJson(path.join(root, 'roster.config.json'), {}));
  if (!['safe', 'full'].includes(c.access)) throw new Error('access must be safe or full.');
  for (const [key, value] of Object.entries(c.usage)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid usage.${key}`);
  }
  if (c.usage.ceiling > 100) throw new Error('usage.ceiling cannot exceed 100.');
  if (typeof c.briefHeader !== 'string') throw new Error('briefHeader must be text.');
  for (const choices of Object.values(c.kinds)) {
    if (!Array.isArray(choices)) throw new Error('Each kind must be an ordered array.');
    for (const entry of choices) checkProvider(entry.provider);
  }
  return c;
}
export async function init(root) {
  await fs.writeFile(path.join(root, 'roster.config.json'), JSON.stringify(defaults, null, 2) + '\n', { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const file = path.join(root, '.gitignore');
  const text = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  if (!text.split(/\r?\n/).some(line => ['.roster/', '/.roster/'].includes(line.trim()))) await fs.appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}.roster/\n`);
  return { config: 'roster.config.json', ignored: '.roster/' };
}
