import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, git, gitState, repoRoot, safeName, sleep } from './io.mjs';
import { checkProvider } from './config.mjs';
import { findBinary } from './binaries.mjs';
import { familyForModel } from './allowance.mjs';

const runnerFile = fileURLToPath(new URL('./runner.mjs', import.meta.url));
export const sessionDir = (root, name) => path.join(root, '.roster', 'sessions', safeName(name));
export const turnDir = (root, name, turn) => path.join(sessionDir(root, name), `turn-${String(turn).padStart(4, '0')}`);
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
async function lock(root, name, fn) {
  const dir = path.join(root, '.roster', 'locks', safeName(name));
  await fs.mkdir(path.dirname(dir), { recursive: true });
  try { await fs.mkdir(dir); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = await readJson(path.join(dir, 'owner.json'), null);
    const age = Date.now() - (await fs.stat(dir)).mtimeMs;
    if ((owner && !alive(owner.pid)) || (!owner && age > 30000)) {
      await fs.unlink(path.join(dir, 'owner.json')).catch(() => {});
      await fs.rmdir(dir);
      return lock(root, name, fn);
    }
    throw new Error(`Session ${name} is being changed by another roster command.`);
  }
  await writeJson(path.join(dir, 'owner.json'), { pid: process.pid });
  try { return await fn(); }
  finally { await fs.unlink(path.join(dir, 'owner.json')); await fs.rmdir(dir); }
}
async function loadMeta(root, name) {
  const meta = await readJson(path.join(sessionDir(root, name), 'meta.json'), null);
  if (!meta) throw new Error(`Unknown session: ${name}`);
  return meta;
}
export async function status(root, name) {
  if (!name) {
    const names = await fs.readdir(path.join(root, '.roster', 'sessions')).catch(() => []);
    return Promise.all(names.filter(n => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(n)).map(n => status(root, n)));
  }
  const meta = await loadMeta(root, name), dir = turnDir(root, name, meta.turn);
  let result = await readJson(path.join(dir, 'result.json'), null);
  if (!result) {
    const running = await readJson(path.join(dir, 'running.json'), null);
    const heartbeat = await readJson(path.join(dir, 'heartbeat.json'), null);
    const since = Date.parse(heartbeat?.at || running?.launchedAt || meta.startedAt);
    const rebooted = Date.now() - os.uptime() * 1000 > Date.parse(meta.startedAt) + 3000;
    if (rebooted || running && !alive(running.pid) || Date.now() - since > 15000) {
      // An interrupted result is durable; never signal a PID read from disk.
      result = { provider: meta.provider, state: 'failed', error: 'interrupted', startedAt: meta.startedAt, endedAt: new Date().toISOString(), tokens: { total: 0 } };
      await writeJson(path.join(dir, 'result.json'), result);
      await fs.appendFile(path.join(sessionDir(root, name), 'turns.jsonl'), JSON.stringify({ turn: meta.turn, ...result }) + '\n');
    }
  }
  let lastAnswer = null;
  for (let turn = meta.turn; turn >= 1; turn--) {
    const file = path.join(turnDir(root, name, turn), 'answer.txt');
    if (await fs.access(file).then(() => true, () => false)) { lastAnswer = file; break; }
  }
  return { name, state: result?.state || 'running', error: result?.error, provider: meta.provider, model: meta.model, effort: meta.effort, access: meta.access, turn: meta.turn, seconds: Math.max(0, (Date.parse(result?.endedAt || new Date().toISOString()) - Date.parse(meta.startedAt)) / 1000), tokens: result?.tokens || null, costUsd: result?.costUsd ?? null, sessionId: result?.sessionId || meta.sessionId || meta.providerSessionId || null, directory: meta.directory, ...await gitState(meta.directory), answer: lastAnswer, ...(result?.details ? { details: result.details } : {}) };
}
async function launch(root, meta, prompt, config, binary) {
  const dir = turnDir(root, meta.name, meta.turn);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.txt'), prompt);
  const nonce = randomUUID();
  await writeJson(path.join(dir, 'request.json'), { meta, config, binary, nonce });
  await writeJson(path.join(sessionDir(root, meta.name), 'meta.json'), meta);
  const worker = spawn(process.execPath, [runnerFile, root, meta.name, String(meta.turn)], { detached: true, stdio: 'ignore', windowsHide: true });
  try {
    await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
    await writeJson(path.join(dir, 'running.json'), { pid: worker.pid, nonce, launchedAt: meta.startedAt });
  } catch (e) {
    await writeJson(path.join(dir, 'result.json'), { provider: meta.provider, state: 'failed', error: `Supervisor failed: ${e.message}`, endedAt: new Date().toISOString() });
    throw e;
  } finally { worker.unref(); }
  return { name: meta.name, state: 'running', provider: meta.provider, model: meta.model, turn: meta.turn, directory: meta.directory };
}
function wrappedPrompt(meta, text, config) {
  return `${config.briefHeader}\nAssigned directory: ${meta.directory}\nAssigned branch: ${meta.branch || '(detached; do not commit)'}\nAccess: ${meta.access}. Web requested: ${meta.web ? 'yes' : 'no'}.\n\n${text}\n`;
}
async function ensureWorktree(root, opts) {
  if (!opts.worktree) {
    if (opts.branch || opts.base) throw new Error('--branch and --base require --worktree.');
    return path.resolve(opts.dir || root);
  }
  if (opts.dir) throw new Error('Use --dir or --worktree, not both.');
  if (!opts.branch) throw new Error('--worktree requires --branch.');
  await git(root, ['check-ref-format', '--branch', opts.branch]);
  const target = path.resolve(opts.worktree);
  const worktrees = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).split('\0').filter(s => s.startsWith('worktree ')).map(s => path.resolve(s.slice(9)));
  if (worktrees.some(w => (process.platform === 'win32' ? w.toLowerCase() === target.toLowerCase() : w === target))) {
    if ((await gitState(target)).branch !== opts.branch) throw new Error('Existing worktree is on a different branch.');
    return target;
  }
  const exists = await git(root, ['show-ref', '--verify', `refs/heads/${opts.branch}`]).then(() => true, () => false);
  await git(root, ['worktree', 'add', ...(exists ? [] : ['-b', opts.branch]), target, ...(exists ? [opts.branch] : [opts.base || 'HEAD'])]);
  return target;
}
export async function start(root, config, name, opts, brief) {
  safeName(name); checkProvider(opts.provider);
  if (!['safe', 'full'].includes(opts.access || config.access)) throw new Error('access must be safe or full.');
  const binary = await findBinary(opts.provider, config.providers[opts.provider].binary);
  if (!binary) throw new Error(`${opts.provider}: not installed`);
  return lock(root, name, async () => {
    if (await readJson(path.join(sessionDir(root, name), 'meta.json'), null)) throw new Error(`Session ${name} already exists.`);
    const directory = await ensureWorktree(root, opts);
    await repoRoot(directory);
    const state = await gitState(directory);
    const meta = { name, provider: opts.provider, ...(opts.provider === 'grok' ? { providerSessionId: randomUUID() } : {}), model: opts.model || config.providers[opts.provider].model, effort: opts.effort || config.providers[opts.provider].effort, access: opts.access || config.access, web: !!opts.web, directory, branch: state.branch, base: opts.base || null, turn: 1, startedAt: new Date().toISOString() };
    return launch(root, meta, wrappedPrompt(meta, brief, config), config, binary);
  });
}
export async function send(root, config, name, message) {
  return lock(root, name, async () => {
    const current = await status(root, name);
    if (current.state === 'running') throw new Error(`${name} is already running.`);
    const previous = await loadMeta(root, name);
    const sessionId = current.sessionId;
    if (!sessionId) throw new Error('No provider conversation id; start a new session.');
    const state = await gitState(previous.directory);
    if (state.branch !== previous.branch) throw new Error('Session branch changed; refusing to resume in another branch.');
    const binary = await findBinary(previous.provider, config.providers[previous.provider].binary);
    if (!binary) throw new Error(`${previous.provider}: not installed`);
    const meta = { ...previous, turn: previous.turn + 1, sessionId, startedAt: new Date().toISOString() };
    return launch(root, meta, wrappedPrompt(meta, message, config), config, binary);
  });
}
export async function wait(root, names, timeout = 30 * 60000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const states = await Promise.all(names.map(name => status(root, name)));
    if (states.every(s => s.state !== 'running')) return { ok: states.every(s => s.state === 'done'), timedOut: false, sessions: states };
    if (Date.now() >= deadline) return { ok: false, timedOut: true, sessions: states };
    await sleep(Math.min(200, Math.max(1, deadline - Date.now())));
  }
}
export async function stop(root, name) {
  return lock(root, name, async () => {
    const s = await status(root, name);
    if (s.state !== 'running') return s;
    const dir = turnDir(root, name, s.turn);
    const request = await readJson(path.join(dir, 'request.json'));
    await writeJson(path.join(dir, 'stop.json'), { nonce: request.nonce });
    return { name, state: 'running', stopRequested: true, turn: s.turn };
  });
}
export async function answer(root, name, turn) {
  const meta = await loadMeta(root, name);
  const n = turn === undefined ? meta.turn : Number(turn);
  if (!Number.isInteger(n) || n < 1 || n > meta.turn) throw new Error('Invalid turn number.');
  try { return { name, turn: n, answer: await fs.readFile(path.join(turnDir(root, name, n), 'answer.txt'), 'utf8') }; }
  catch (e) { if (e.code === 'ENOENT') throw new Error('No answer yet.'); throw e; }
}
export async function review(root, config, name, by, extra = '') {
  const author = await loadMeta(root, name);
  if (author.provider === by || familyForModel(author.provider, author.model) === familyForModel(by, config.providers[by].model)) throw new Error('Review must use a different provider family and underlying model family.');
  if ((await status(root, name)).state === 'running') throw new Error('Wait for the author turn before reviewing.');
  const authorState = await gitState(author.directory);
  if (!authorState.head || !authorState.branch || authorState.branch !== author.branch || authorState.uncommitted) throw new Error('Review requires the author branch to be unchanged and clean, with a commit.');
  const reviewName = `${name.slice(0, 40)}-review-${by}-${randomUUID().slice(0, 8)}`;
  const worktree = path.join(root, '.roster', 'reviews', reviewName);
  await git(root, ['worktree', 'add', '--detach', worktree, authorState.head]);
  const prompt = `Review branch ${author.branch} at commit ${authorState.head}. Compare against ${author.base || 'the parent commit (or the empty tree for a root commit)'}.\nReport findings with file:line, severity, and concrete impact. Prove each finding with a test you write and run. Do not edit the author's files. Do not commit. Write temporary reproductions only in your separate review worktree; never change the implementation.\n${extra}`;
  return start(root, config, reviewName, { provider: by, dir: worktree, access: author.access }, prompt);
}
