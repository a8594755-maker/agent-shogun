import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, git, gitState, repoRoot, safeName, sleep } from './io.mjs';
import { checkProvider } from './config.mjs';
import { findBinary, binaryMissing, probe } from './binaries.mjs';
import { adapters } from './adapters/index.mjs';
import { familyForModel } from './allowance.mjs';
import { stateDirectory } from './state.mjs';
import { processIdentity, sameProcess } from './process-owner.mjs';
import { sessionSelection, resolveModelEffort } from './model-selection.mjs';
import { withFileLock } from './file-lock.mjs';
import { loadCatalog } from './catalog.mjs';
import { within } from './state.mjs';

const runnerFile = fileURLToPath(new URL('./runner.mjs', import.meta.url));
export const sessionDir = (root, name) => path.join(stateDirectory(root), 'sessions', safeName(name));
export const turnDir = (root, name, turn) => path.join(sessionDir(root, name), `turn-${String(turn).padStart(4, '0')}`);
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
async function lock(root, name, fn) {
  return withFileLock(path.join(stateDirectory(root),'locks',`${safeName(name)}.lock`),fn);
}
async function loadMeta(root, name) {
  const meta = await readJson(path.join(sessionDir(root, name), 'meta.json'), null);
  if (!meta) throw new Error(`Unknown session: ${name}`);
  if(meta.name!==name||!Number.isSafeInteger(meta.turn)||meta.turn<1||meta.turn>100000||typeof meta.directory!=='string'||!path.isAbsolute(meta.directory))throw Object.assign(new Error('Invalid session metadata'),{code:'ROSTER_CORRUPT_STATE'});
  return meta;
}
export async function status(root, name) {
  if (!name) {
    const names = await fs.readdir(path.join(stateDirectory(root), 'sessions')).catch(() => []);
    return Promise.all(names.filter(n => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(n)).map(async n => {try{return await status(root,n);}catch{return {name:n,state:'failed',error:'corrupt or unreadable session state'};}}));
  }
  return statusOne(root,name).catch(e=>{if(e instanceof SyntaxError||['ROSTER_CORRUPT_STATE','EISDIR','EINVAL'].includes(e.code))return {name,state:'failed',error:'corrupt or unreadable session state'};throw e;});
}
async function statusOne(root,name){
  const meta = await loadMeta(root, name), dir = turnDir(root, name, meta.turn);
  let result = await readJson(path.join(dir, 'result.json'), null);
  if(result&&(!['done','failed'].includes(result.state)||!Number.isFinite(Date.parse(result.endedAt))))throw Object.assign(new Error('Invalid result record'),{code:'ROSTER_CORRUPT_STATE'});
  if (!result) {
    const running = await readJson(path.join(dir, 'running.json'), null);
    const heartbeat = await readJson(path.join(dir, 'heartbeat.json'), null);
    const since = Date.parse(heartbeat?.at || running?.launchedAt || meta.startedAt);
    const rebooted = Date.now() - os.uptime() * 1000 > Date.parse(meta.startedAt) + 3000;
    const missing = running && !alive(running.pid);
    const identityLost = running?.startTime && (rebooted || Date.now()-since>15000) && !await sameProcess(running);
    if (missing || identityLost || rebooted && !running?.startTime || !running && Date.now()-since>15000) {
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
    const identity = await processIdentity(worker.pid);
    if (!identity) throw new Error('Cannot verify supervisor process identity.');
    await writeJson(path.join(dir, 'running.json'), { ...identity, nonce, launchedAt: meta.startedAt });
  } catch (e) {
    await writeJson(path.join(dir, 'result.json'), { provider: meta.provider, state: 'failed', error: `Supervisor failed: ${e.message}`, endedAt: new Date().toISOString() });
    throw e;
  } finally { worker.unref(); }
  return { name: meta.name, state: 'running', provider: meta.provider, model: meta.model, turn: meta.turn, directory: meta.directory };
}
function wrappedPrompt(meta, text, config) {
  return `${config.briefHeader}\nAssigned directory: ${meta.directory}\nAssigned branch: ${meta.branch || '(detached; do not commit)'}\nAccess: ${meta.access}. Web requested: ${meta.web ? 'yes' : 'no'}.\n\n${text}\n`;
}
function gitInput(value,label){if(typeof value!=='string'||!value.trim()||value.startsWith('-')||value.includes('\0'))throw new Error(`Invalid ${label}: leading options and empty values are not allowed.`);return value;}
async function commitRef(root,ref){
  gitInput(ref,'base ref');
  const sha=await git(root,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]);
  if(!/^[a-f0-9]{40,64}$/i.test(sha))throw new Error('Base did not resolve to a commit.');return sha;
}
async function ensureWorktree(root, opts) {
  if (!opts.worktree) {
    if (opts.branch || opts.base) throw new Error('--branch and --base require --worktree.');
    if(opts.dir)gitInput(opts.dir,'directory path');
    return {directory:path.resolve(opts.dir || root),base:null,baseCommit:null};
  }
  if (opts.dir) throw new Error('Use --dir or --worktree, not both.');
  if (!opts.branch) throw new Error('--worktree requires --branch.');
  gitInput(opts.branch,'branch');gitInput(opts.worktree,'worktree path');
  await git(root, ['check-ref-format', `refs/heads/${opts.branch}`]);
  const baseCommit=opts.base?await commitRef(root,opts.base):null;
  const branchCommit=await git(root,['rev-parse','--verify','--quiet','--end-of-options',`refs/heads/${opts.branch}^{commit}`]).catch(()=>null);
  if(branchCommit&&baseCommit&&branchCommit!==baseCommit)throw new Error('Existing branch does not match the requested base commit. Omit --base to attach intentionally.');
  const target = path.resolve(opts.worktree);
  const worktrees = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).split('\0').filter(s => s.startsWith('worktree ')).map(s => path.resolve(s.slice(9)));
  if (worktrees.some(w => (process.platform === 'win32' ? w.toLowerCase() === target.toLowerCase() : w === target))) {
    if ((await gitState(target)).branch !== opts.branch) throw new Error('Existing worktree is on a different branch.');
    return {directory:target,base:opts.base||null,baseCommit};
  }
  const resolved=branchCommit||baseCommit||await commitRef(root,'HEAD');
  await git(root, ['worktree', 'add', ...(branchCommit ? [] : ['-b', opts.branch]), '--',target, ...(branchCommit ? [opts.branch] : [resolved])]);
  return {directory:target,base:opts.base||(!branchCommit?'HEAD':null),baseCommit:baseCommit||(!branchCommit?resolved:null)};
}
export async function start(root, config, name, opts, brief) {
  safeName(name); checkProvider(opts.provider);
  if (!['safe', 'full'].includes(opts.access || config.access)) throw new Error('access must be safe or full.');
  const binary = await findBinary(opts.provider, config.providers[opts.provider].binary);
  if (!binary) throw new Error(binaryMissing(opts.provider,config.providers[opts.provider].binary));
  const selected = await sessionSelection(root,config,opts.provider,opts.model || config.providers[opts.provider].model,opts.effort);
  return lock(root, name, async () => {
    if (await readJson(path.join(sessionDir(root, name), 'meta.json'), null)) throw new Error(`Session ${name} already exists.`);
    const prepared = await ensureWorktree(root, opts), {directory}=prepared;
    await repoRoot(directory);
    const state = await gitState(directory);
    const meta = { name, provider: opts.provider, ...(opts.provider === 'grok' ? { providerSessionId: randomUUID() } : {}), ...selected, access: opts.access || config.access, web: !!opts.web, ...prepared, branch: state.branch, turn: 1, startedAt: new Date().toISOString() };
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
    if (!binary) throw new Error(binaryMissing(previous.provider,config.providers[previous.provider].binary));
    await sessionSelection(root,config,previous.provider,previous.model,previous.effort);
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
    const running = await readJson(path.join(dir, 'running.json'), null);
    if (running?.nonce !== request.nonce || !await sameProcess(running)) throw new Error('Supervisor ownership cannot be verified; refusing stop.');
    await writeJson(path.join(dir, 'stop.json'), { nonce: request.nonce,requestedBy:process.pid,requestedAt:new Date().toISOString() });
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
export async function review(root, config, name, by, extra = '', options = {}) {
  checkProvider(by);
  const author = await loadMeta(root, name);
  if (author.provider === by) throw new Error('Review must use a different provider family.');
  const binary=await findBinary(by,config.providers[by].binary);
  if(!binary)throw new Error(binaryMissing(by,config.providers[by].binary));
  const {catalog}=await loadCatalog(root,config), rules=config.userKinds??config.kinds??{};
  const ordered=Object.hasOwn(rules,'review')?rules.review:catalog?.allocation&&Object.hasOwn(catalog.allocation,'review')?catalog.allocation.review:[];
  const inventory=await probe(by,config,adapters[by]);
  if(inventory.authState!=='signed in')throw new Error('Reviewer must be signed in before creating its worktree.');
  const choices=options.model?[{model:options.model,effort:options.effort}]:ordered.filter(c=>c.provider===by);
  if(!choices.length)choices.push({model:config.providers[by].model,effort:config.providers[by].effort});
  let choice;
  for(const c of choices){const normalized=await sessionSelection(root,config,by,c.model,options.effort??c.effort);if(!inventory.modelsListed||inventory.models.includes(normalized.model)){choice={...c,...normalized};break;}}
  if(!choice)throw new Error('No requested review model is offered by the installed CLI.');
  if(Object.hasOwn(rules,'review')&&!ordered.some(c=>c.provider===by&&resolveModelEffort(by,c.model,c.effort,{catalog}).model===choice.model))throw new Error('No requested reviewer permitted by project review rule.');
  const selected=await sessionSelection(root,config,by,choice.model,options.effort??choice.effort);
  if(familyForModel(author.provider,author.model)===familyForModel(by,selected.model))throw new Error('Review must use a different provider family and underlying model family.');
  if ((await status(root, name)).state === 'running') throw new Error('Wait for the author turn before reviewing.');
  const authorState = await gitState(author.directory);
  if (!authorState.head || !authorState.branch || authorState.branch !== author.branch || authorState.uncommitted) throw new Error('Review requires the author branch to be unchanged and clean, with a commit.');
  const reviewName = `${name.slice(0, 40)}-review-${by}-${randomUUID().slice(0, 8)}`;
  const worktree = path.join(stateDirectory(root), 'reviews', reviewName);
  const access=options.access||config.access;
  if(!['safe','full'].includes(access))throw new Error('access must be safe or full.');
  await git(root, ['worktree', 'add', '--detach', '--',worktree, authorState.head]);
  const prompt = `Review branch ${author.branch} at commit ${authorState.head}. Compare against ${author.baseCommit || author.base || 'the parent commit (or the empty tree for a root commit)'}.\nReport findings with file:line, severity, and concrete impact. Prove each finding with a test you write and run. Do not edit the author's files. Do not commit. Write temporary reproductions only in your separate review worktree; never change the implementation.\n${extra}`;
  try{return await start(root, config, reviewName, { provider: by, ...selected,dir: worktree, access }, prompt);}
  catch(e){if(within(path.join(stateDirectory(root),'reviews'),worktree))await git(root,['worktree','remove','--force','--',worktree]).catch(()=>{});throw e;}
}
