import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from '../src/io.mjs';
import { defaults } from '../src/config.mjs';

export const project = fileURLToPath(new URL('..', import.meta.url));
export const cli = path.join(project, 'bin', 'roster.mjs');
export async function scratch(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'roster-test-'));
  const root = path.join(parent, 'space Ω');
  await fs.mkdir(root);
  t.after(() => fs.rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await exec('git', ['init', '-b', 'main', root]);
  await exec('git', ['-C', root, 'config', 'user.name', 'Test Contributor']);
  await exec('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await fs.writeFile(path.join(root, '.gitignore'), '.roster/\n');
  await fs.writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', ['-C', root, 'commit', '-m', 'Seed']);
  const config = structuredClone(defaults);
  for (const name of ['codex', 'agy', 'claude']) config.providers[name].binary = path.join(project, 'test', 'fakes', `${name}.mjs`);
  await fs.writeFile(path.join(root, 'roster.config.json'), JSON.stringify(config));
  const env = { ...process.env, HOME: parent, USERPROFILE: parent, CODEX_HOME: path.join(parent, '.codex') };
  async function run(...args) {
    try { const result = await exec(process.execPath, [cli, ...args, '--json'], { cwd: root, env, windowsHide: true, timeout: 15000 }); return JSON.parse(result.stdout); }
    catch (e) { throw new Error(e.stderr || e.stdout || e.message, { cause: e }); }
  }
  async function fail(...args) {
    try { await exec(process.execPath, [cli, ...args, '--json'], { cwd: root, env, windowsHide: true, timeout: 15000 }); throw new Error('Expected failure'); }
    catch (e) { if (!e.code) throw e; return { code: e.code, ...JSON.parse(e.stderr || e.stdout) }; }
  }
  async function brief(text) { const file = path.join(root, 'brief with spaces Ω.txt'); await fs.writeFile(file, text); return file; }
  return { root, parent, env, config, run, fail, brief };
}
