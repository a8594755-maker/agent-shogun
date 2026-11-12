import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from './io.mjs';
import { within } from './state.mjs';
import { fileURLToPath } from 'node:url';

async function executable(file) {
  try { await fs.access(file, process.platform === 'win32' ? 0 : 1); return (await fs.stat(file)).isFile(); } catch { return false; }
}
// Do not feed .cmd/.ps1 wrappers (or user arguments) to a shell. Resolve common npm shims.
async function commandFor(file) {
  if (/\.[cm]?js$/i.test(file)) return { file: process.execPath, args: [file] };
  if (/\.(cmd|bat|ps1)$/i.test(file)) {
    const wrapper = await fs.readFile(file, 'utf8');
    const matches = [...wrapper.matchAll(/(?:%dp0%|\$basedir)[\\/]([^"\r\n]+?\.(?:exe|[cm]?js))/g)];
    // npm shims can mention node.exe before the actual JavaScript entry point.
    matches.sort((a, b) => Number(/\.exe$/i.test(a[1])) - Number(/\.exe$/i.test(b[1])));
    for (const m of matches) {
      if (/^node\.exe$/i.test(m[1])) continue;
      const target = path.resolve(path.dirname(file), m[1].replace(/[\\/]/g, path.sep));
      if (await executable(target)) return commandFor(target);
    }
    throw new Error('Unsupported shell wrapper; configure a native executable or JavaScript entry point.');
  }
  return { file, args: [] };
}
export function binaryCandidates(name, configured, env=process.env, platform=process.platform) {
  const p=platform==='win32'?path.win32:path.posix;
  const home=(platform==='win32'?env.USERPROFILE:env.HOME)||os.homedir();
  const candidates = [];
  if (configured) candidates.push(p.resolve(configured.replace(/^~(?=[\\/]|$)/,home)));
  else {
    for (const dir of (env.PATH || env.Path || '').split(platform==='win32'?';':':').filter(Boolean)) {
      for (const ext of platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) candidates.push(p.join(dir.replace(/^"|"$/g, ''), name + ext));
    }
    if(name==='agy')candidates.push(platform==='win32'?p.join(env.LOCALAPPDATA||p.join(home,'AppData','Local'),'agy','bin','agy.exe'):p.join(env.XDG_BIN_HOME||p.join(home,'.local','bin'),'agy'));
    if(name==='grok')candidates.push(p.join(home,'.grok','bin',platform==='win32'?'grok.exe':'grok'));
  }
  return [...new Set(candidates)];
}
export const binaryMissing = (name,configured) => `${name}: not installed; looked in ${binaryCandidates(name,configured).join(', ')}`;
export async function findBinary(name, configured, env = process.env) {
  const candidates=binaryCandidates(name,configured,env);
  for (const candidate of candidates) if (await executable(candidate)) {
    if(process.env.ROSTER_TEST_MODE && candidate!==process.execPath && !within(process.env.ROSTER_TEST_ROOT,candidate) && !within(fileURLToPath(new URL('../test/fakes/',import.meta.url)),candidate)) throw new Error('TEST PROVIDER GUARD: refusing real provider executable');
    return { ...(await commandFor(candidate)), path: candidate };
  }
  return null;
}
export async function probe(name, config, adapter) {
  let binary;
  try { binary = await findBinary(name, config.providers[name].binary); }
  catch (e) { return { provider: name, installed: false, authState: 'unknown', signIn: adapter.signIn, reason: e.message, models: [] }; }
  if (!binary) return { provider: name, installed: false, authState: 'unknown', signIn: adapter.signIn, reason: binaryMissing(name,config.providers[name].binary), searched:binaryCandidates(name,config.providers[name].binary), models: [] };
  const run = args => exec(binary.file, [...binary.args, ...args], { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
  let version = 'unknown', models = [], modelsOutput, modelsListed = false, modelsSource = 'CLI has no model-list command';
  try { version = (await run(['--version'])).stdout.trim(); } catch { /* installation can still launch */ }
  if (adapter.modelsArgs) {
    try { modelsOutput = (await run(adapter.modelsArgs)).stdout; models = adapter.parseModels(modelsOutput); modelsListed = true; modelsSource = 'CLI models'; }
    catch { modelsSource = 'model listing unavailable'; }
  }
  const authState = await adapter.authState({ binary, modelsOutput }).catch(() => 'unknown');
  return { provider: name, installed: true, version, models, modelsListed, modelsSource, configuredModel: config.providers[name].model, authState, signIn: adapter.signIn };
}
