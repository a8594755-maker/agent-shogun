import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from './io.mjs';

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
export async function findBinary(name, configured, env = process.env) {
  const candidates = [];
  if (configured) candidates.push(path.resolve(configured));
  else for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) candidates.push(path.join(dir.replace(/^"|"$/g, ''), name + ext));
  }
  for (const candidate of candidates) if (await executable(candidate)) return { ...(await commandFor(candidate)), path: candidate };
  return null;
}
export async function probe(name, config, adapter) {
  let binary;
  try { binary = await findBinary(name, config.providers[name].binary); }
  catch (e) { return { provider: name, installed: false, reason: e.message, models: [] }; }
  if (!binary) return { provider: name, installed: false, reason: 'not installed', models: [] };
  const run = args => exec(binary.file, [...binary.args, ...args], { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
  let version = 'unknown', models = [], modelsSource = 'CLI has no model-list command';
  try { version = (await run(['--version'])).stdout.trim(); } catch { /* installation can still launch */ }
  if (adapter.modelsArgs) {
    try { models = adapter.parseModels((await run(adapter.modelsArgs)).stdout); modelsSource = 'CLI models'; }
    catch { modelsSource = 'model listing unavailable'; }
  }
  return { provider: name, installed: true, version, models, modelsSource, configuredModel: config.providers[name].model };
}
