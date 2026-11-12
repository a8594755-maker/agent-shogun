import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './io.mjs';
import { rosterHome } from './state.mjs';

export const providerNames = ['codex', 'agy', 'claude', 'grok'];
export const defaults = {
  providers: {
    codex: { model: 'gpt-6.1-sol', effort: 'low' },
    agy: { model: 'gemini-3.8-flash-low', effort: 'low' },
    claude: { model: 'claude-sonnet-5-5', effort: 'medium' },
    grok: { model: 'grok-4.7-build-fast', effort: 'low' }
  },
  access: 'safe',
  catalog: { path: null, maxAgeDays: 15 },
  guards: { blockPush: true, env: { CLOUDFLARE_API_TOKEN: 'roster-deploy-disabled' }, antigravityDeny: true },
  briefHeader: 'Work only in your assigned directory. Commit only on your assigned branch. Never push, deploy, or publish. Run the type check and tests yourself and loop until green. Never weaken an existing test.',
  usage: { ceiling: 90, balancePoints: 25, suppliedMaxAgeMinutes: 30, cacheSeconds: 30, sourceMaxAgeMinutes: 30, externalCommand: null, externalTimeoutMs: 15000 }
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
export async function loadConfig(root, { cwd = root, configPath } = {}) {
  let file = configPath ? path.resolve(cwd, configPath) : null;
  if (!file) {
    let dir = path.resolve(cwd); const boundary = path.resolve(root), relative = path.relative(boundary, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) dir = boundary;
    for (;;) {
      const candidate = path.join(dir, 'roster.config.json');
      if (await fs.access(candidate).then(() => true, () => false)) { file = candidate; break; }
      if (!path.relative(boundary, dir) || path.dirname(dir) === dir) break;
      dir = path.dirname(dir);
    }
  }
  const userFile=path.join(rosterHome(),'config.json'), personal=await readJson(userFile,{});
  const project = file ? await readJson(file) : {};
  const user=merge(personal,project), c = merge(defaults, user);
  for(const p of providerNames){
    const layer=project.providers?.[p]?.path!==undefined||project.providers?.[p]?.binary!==undefined?project.providers[p]:personal.providers?.[p];
    const value=layer?.path??layer?.binary;
    if(value!==undefined){ if(typeof value!=='string'||!value)throw new Error(`Invalid provider path for ${p}.`); c.providers[p].binary=value.startsWith('~')?value:path.resolve(layer===project.providers?.[p]?path.dirname(file):path.dirname(userFile),value); }
  }
  Object.defineProperty(c, 'userKinds', { value: user.kinds || {}, enumerable: false });
  Object.defineProperty(c, 'configFile', { value: file, enumerable: false });
  if (!Number.isFinite(c.catalog.maxAgeDays) || c.catalog.maxAgeDays < 0 || c.catalog.path !== null && typeof c.catalog.path !== 'string') throw new Error('Invalid catalog path or maxAgeDays.');
  if (!['safe', 'full'].includes(c.access)) throw new Error('access must be safe or full.');
  for (const [key, value] of Object.entries(c.usage)) {
    if (key === 'externalCommand') {
      if (value !== null && (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v))) throw new Error('usage.externalCommand must be null or an executable/argument array.');
      continue;
    }
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid usage.${key}`);
  }
  if (c.usage.ceiling > 100) throw new Error('usage.ceiling cannot exceed 100.');
  if (typeof c.briefHeader !== 'string') throw new Error('briefHeader must be text.');
  for (const p of providerNames) {
    const provider = c.providers[p];
    if (!provider || typeof provider.model !== 'string' || !provider.model || typeof provider.effort !== 'string' || !provider.effort) throw new Error(`Invalid model/effort for ${p}.`);
    if (provider.binary !== undefined && typeof provider.binary !== 'string') throw new Error(`Invalid binary path for ${p}.`);
  }
  if (c.guards.env !== false && (!c.guards.env || typeof c.guards.env !== 'object' || Array.isArray(c.guards.env))) throw new Error('guards.env must be an object or false.');
  for (const value of Object.values(c.guards.env || {})) if (value !== null && typeof value !== 'string') throw new Error('Environment replacements must be strings or null.');
  for (const choices of Object.values(c.userKinds)) {
    if (!Array.isArray(choices)) throw new Error('Each kind must be an ordered array.');
    for (const entry of choices) {
      checkProvider(entry.provider);
      if (typeof entry.model !== 'string' || !entry.model || typeof entry.effort !== 'string' || !entry.effort) throw new Error('Project kind entries need model and effort.');
    }
  }
  const commands = c.providers.grok.testCommands;
  if (commands !== undefined && (!Array.isArray(commands) || commands.some(s => typeof s !== 'string' || !s.trim() || /[\r\n()]/.test(s)))) throw new Error('Grok testCommands must be an array of command patterns without newlines or parentheses.');
  return c;
}
export async function init(root) {
  const initial = { ...defaults }; delete initial.kinds;
  await fs.writeFile(path.join(root, 'roster.config.json'), JSON.stringify(initial, null, 2) + '\n', { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const file = path.join(root, '.gitignore');
  const text = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  if (!text.split(/\r?\n/).some(line => ['.roster/', '/.roster/'].includes(line.trim()))) await fs.appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}.roster/\n`);
  return { config: 'roster.config.json', ignored: '.roster/' };
}
