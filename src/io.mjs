import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

export const exec = promisify(execFile);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && arguments.length > 1) return fallback; throw e; }
}
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
    // Windows can briefly deny replacement while another writer closes its handle.
    for(let attempt=0;;attempt++){
      try{await fs.rename(temp,file);break;}
      catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=20)throw e;await sleep(5*(attempt+1));}
    }
  }
  finally { await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
}
export async function git(dir, args) {
  return (await exec('git', ['-C', dir, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}
export async function repoRoot(dir = process.cwd()) { return git(dir, ['rev-parse', '--show-toplevel']); }
export async function gitState(dir) {
  try {
    const [head, branch, raw] = await Promise.all([
      git(dir, ['rev-parse', '--verify', 'HEAD']).catch(() => null),
      git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null),
      exec('git', ['-C', dir, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { windowsHide: true })
    ]);
    const entries = raw.stdout.split('\0').filter(Boolean);
    let uncommitted = 0;
    for (let i = 0; i < entries.length; i++) { uncommitted++; if (/[RC]/.test(entries[i].slice(0, 2))) i++; }
    return { head, branch, uncommitted };
  } catch { return { head: null, branch: null, uncommitted: null }; }
}
export function safeName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name || '')) throw new Error('Session names must be 1–80 ASCII letters, digits, underscores or hyphens.');
  return name;
}
