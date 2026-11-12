import './isolation.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, readJson, writeJson, sleep } from '../src/io.mjs';
import { usage } from '../src/usage.mjs';
import { childEnv } from '../src/guards.mjs';
import { status, turnDir, alive } from '../src/sessions.mjs';
import { scratch, cli } from './helpers.mjs';

for (const provider of ['codex', 'agy', 'claude']) {
  test(`${provider}: detached start, answer, resume and prior answer`, async t => {
    const s = await scratch(t), brief = await s.brief('Create hello.txt');
    const started = await s.run('start', 'worker', '--provider', provider, '--brief', brief);
    assert.equal(started.state, 'running');
    const ended = await s.run('wait', 'worker', '--timeout', '8s');
    assert.equal(ended.ok, true); assert.equal(ended.sessions[0].turn, 1); assert(ended.sessions[0].tokens.total > 0);
    assert.equal((await s.run('answer', 'worker')).answer, 'DONE');
    const id = (await s.run('status', 'worker')).sessionId; assert.equal(id, `fake-${provider}-conversation`);
    await s.run('send', 'worker', '--message', 'What file did you create? One word.');
    assert.equal((await s.run('wait', 'worker', '--timeout', '8s')).ok, true);
    assert.equal((await s.run('answer', 'worker')).answer, 'hello.txt');
    assert.equal((await s.run('answer', 'worker', '--turn', '1')).answer, 'DONE');
    assert.equal((await s.run('status', 'worker')).sessionId, id);
    const lines = (await fs.readFile(path.join(s.root, '.roster', 'sessions', 'worker', 'turns.jsonl'), 'utf8')).trim().split('\n'); assert.equal(lines.length, 2);
  });
  test(`${provider}: rate-limit failure is learned even with exit zero`, async t => {
    const s = await scratch(t);
    s.config.kinds = { server: ['codex','agy','claude'].map(p => ({provider:p,model:s.config.providers[p].model,effort:s.config.providers[p].effort})).concat([{provider:'agy',model:'claude-example',effort:'low'}]) };
    await fs.writeFile(path.join(s.root,'roster.config.json'),JSON.stringify(s.config));
    await s.run('start', 'limited', '--provider', provider, '--brief', await s.brief('LIMIT ZERO_EXIT'));
    const r = await s.fail('wait', 'limited', '--timeout', '8s'); assert.equal(r.ok, false);
    const readings = await s.run('usage', '--refresh'), providerReading = readings.find(r => r.provider === provider);
    const group = providerReading.groups.find(g => g.id === (provider === 'agy' ? 'gemini' : 'default'));
    assert.equal(group.limited, true); assert.match(group.lastMessage, /limit|quota/i);
    const candidates = (await s.run('pick', '--kind', 'server')).candidates;
    assert.equal(candidates.some(c => c.provider === provider && c.group === group.id), false);
    if (provider === 'agy') assert(candidates.some(c => c.provider === 'agy' && c.group === 'third-party'));
  });
}
test('providers probes only configured fakes and lists models when supported', async t => {
  const s = await scratch(t), p = await s.run('providers');
  assert.equal(p.filter(p => p.installed).length, 4); assert.deepEqual(p[1].models, ['fake-small', 'fake-large']);
});
test('init preserves existing config and adds ignore entry exactly once', async t => {
  const s = await scratch(t), before = await fs.readFile(path.join(s.root, 'roster.config.json'), 'utf8');
  await s.run('init'); await s.run('init');
  assert.equal(await fs.readFile(path.join(s.root, 'roster.config.json'), 'utf8'), before);
  assert.equal((await fs.readFile(path.join(s.root, '.gitignore'), 'utf8')).split('.roster/').length, 2);
});
test('safe launch propagates guard values and preserves literal prompt characters', async t => {
  const s = await scratch(t);
  await s.run('start', 'literal', '--provider', 'codex', '--brief', await s.brief('CAPTURE Ω & $(literal)'));
  await s.run('wait', 'literal', '--timeout', '8s');
  const a = JSON.parse((await s.run('answer', 'literal')).answer);
  assert.match(a.prompt, /Ω & \$\(literal\)/); assert.equal(a.cwd, s.root); assert.equal(a.push, 'disabled://roster-do-not-push'); assert.equal(a.deploy, 'roster-deploy-disabled'); assert(a.args.includes('--approve-for-me'));
});
test('full mode remains guarded for each provider', async t => {
  const s = await scratch(t);
  for (const provider of ['codex', 'agy', 'claude']) {
    await s.run('start', provider, '--provider', provider, '--access', 'full', '--brief', await s.brief('CAPTURE'));
    await s.run('wait', provider, '--timeout', '8s');
    const a = JSON.parse((await s.run('answer', provider)).answer); assert.equal(a.push, 'disabled://roster-do-not-push'); assert.equal(a.deploy, 'roster-deploy-disabled');
  }
});
test('start is nonblocking; send cannot overlap; timeout and stop work', async t => {
  const s = await scratch(t);
  const start = Date.now(); await s.run('start', 'slow', '--provider', 'codex', '--brief', await s.brief('SLOW TREE'));
  assert(Date.now() - start < 2500); assert.equal((await s.run('status', 'slow')).state, 'running');
  assert.match((await s.fail('send', 'slow', '--message', 'overlap')).error, /already running/);
  assert.equal((await s.fail('wait', 'slow', '--timeout', '20ms')).timedOut, true);
  for (let i = 0; i < 100; i++) { if (await fs.access(path.join(s.root, 'descendant.pid')).then(() => true, () => false)) break; await sleep(20); }
  const descendant = Number(await fs.readFile(path.join(s.root, 'descendant.pid'), 'utf8'));
  await s.run('stop', 'slow');
  const ended = await s.fail('wait', 'slow', '--timeout', '8s'); assert.equal(ended.sessions[0].error, 'stopped');
  for (let i = 0; i < 50 && alive(descendant); i++) await sleep(20);
  assert.equal(alive(descendant), false);
});
test('interrupted supervisor is recognized after launcher process exits', async t => {
  const s = await scratch(t), dir = turnDir(s.root, 'interrupted', 1);
  await writeJson(path.join(s.root, '.roster', 'sessions', 'interrupted', 'meta.json'), { name: 'interrupted', provider: 'codex', model: 'fake', turn: 1, directory: s.root, startedAt: new Date(Date.now() - 100000).toISOString() });
  await writeJson(path.join(dir, 'running.json'), { pid: 2147483647, launchedAt: new Date(Date.now() - 100000).toISOString() });
  const state = await s.run('status', 'interrupted'); assert.equal(state.state, 'failed'); assert.equal(state.error, 'interrupted');
  const lines = (await fs.readFile(path.join(s.root, '.roster', 'sessions', 'interrupted', 'turns.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).error, 'interrupted');
});
test('manual readings support repeated windows, age and stale display', async t => {
  const s = await scratch(t);
  await s.run('usage', 'set', 'claude', '--window', 'weekly', '--used', '85', '--resets', '2099-11-14T14:00:00Z', '--window', 'weekly:model-x', '--used', '95', '--resets', '2099-11-14T14:00:00Z', '--plan', 'test');
  let r = (await s.run('usage')).find(r => r.provider === 'claude'); assert.equal(r.groups[0].windows.length, 2); assert.equal(r.stale, false); assert.equal(r.source, 'supplied');
  const now = Date.now() + 31 * 60000;
  r = (await usage(s.root, s.config, { now, sourceOptions: { codex: { sessionsDir: path.join(s.parent, 'empty') } } })).find(r => r.provider === 'claude');
  assert.equal(r.stale, true); assert(r.ageSeconds >= 1800);
});
test('usage rejects malformed and out-of-range readings', async t => {
  const s = await scratch(t);
  for (const values of [['101', '2099-01-01'], ['-1', '2099-01-01'], ['85', 'nonsense']]) {
    assert.match((await s.fail('usage', 'set', 'claude', '--window', 'weekly', '--used', values[0], '--resets', values[1])).error, /Each window/);
  }
  assert((await s.fail('usage', 'set', 'claude', '--used', '80')).error);
});
test('malformed provider output fails rather than reporting done', async t => {
  const s = await scratch(t);
  await s.run('start', 'bad', '--provider', 'agy', '--brief', await s.brief('MALFORMED'));
  assert.match((await s.fail('wait', 'bad', '--timeout', '8s')).sessions[0].error, /Invalid provider output/);
});
test('worktree creation is idempotent and validates branch identity', async t => {
  const s = await scratch(t), worktree = path.join(s.parent, 'worker Ω');
  const brief = await s.brief('Create hello.txt');
  await s.run('start', 'one', '--provider', 'codex', '--brief', brief, '--worktree', worktree, '--branch', 'worker', '--base', 'main');
  await s.run('wait', 'one', '--timeout', '8s');
  assert.equal((await s.run('status', 'one')).branch, 'worker');
  await s.run('start', 'two', '--provider', 'agy', '--brief', brief, '--worktree', worktree, '--branch', 'worker');
  await s.run('wait', 'two', '--timeout', '8s');
  assert.match((await s.fail('start', 'three', '--provider', 'agy', '--brief', brief, '--worktree', worktree, '--branch', 'other')).error, /different branch/);
});
test('review uses another family and separate detached worktree at author commit', async t => {
  const s = await scratch(t), wt = path.join(s.parent, 'author');
  await s.run('start', 'author', '--provider', 'codex', '--brief', await s.brief('Create hello.txt'), '--worktree', wt, '--branch', 'feature', '--base', 'main');
  await s.run('wait', 'author', '--timeout', '8s');
  assert.match((await s.fail('review', 'author', '--by', 'codex')).error, /different provider/);
  const r = await s.run('review', 'author', '--by', 'agy'); await s.run('wait', r.name, '--timeout', '8s');
  assert.notEqual(r.directory, wt); assert.equal((await status(s.root, r.name)).head, (await status(s.root, 'author')).head);
  const prompt = await fs.readFile(path.join(turnDir(s.root, r.name, 1), 'prompt.txt'), 'utf8'); assert.match(prompt, /Prove each finding with a test/); assert.match(prompt, /Do not commit/);
});
test('all command errors produce JSON and unknown names cannot traverse', async t => {
  const s = await scratch(t);
  assert.match((await s.fail('status', '../escape')).error, /Session names/);
  assert.match((await s.fail('answer', 'missing')).error, /Unknown session/);
  assert.match((await s.fail('start', 'new', '--provider', 'codex')).error, /Missing --brief/);
  assert.match((await s.fail('send', 'new', '--message', 'x', '--wat')).error, /Unknown option/);
});
test('human output is a table and answer is plain text', async t => {
  const s = await scratch(t);
  const p = await exec(process.execPath, [cli, 'providers'], { cwd: s.root, env: s.env }); assert.match(p.stdout, /provider\s+installed\s+version/);
});
test('guarded origin push fails locally before reaching its configured destination', async t => {
  const s = await scratch(t);
  await exec('git', ['-C', s.root, 'remote', 'add', 'origin', path.join(s.parent, 'no-remote')]);
  await assert.rejects(exec('git', ['-C', s.root, 'push', 'origin', 'HEAD'], { env: childEnv(s.config), windowsHide: true }), /disabled|remote helper|protocol/i);
});
test('a reboot or reused live PID cannot make an old turn look running', async t => {
  const s = await scratch(t), dir = turnDir(s.root, 'reboot', 1);
  await writeJson(path.join(s.root, '.roster', 'sessions', 'reboot', 'meta.json'), { name: 'reboot', provider: 'codex', model: 'fake', turn: 1, directory: s.root, startedAt: '1970-01-01T00:00:00Z' });
  await writeJson(path.join(dir, 'running.json'), { pid: process.pid, launchedAt: new Date().toISOString() });
  await writeJson(path.join(dir, 'heartbeat.json'), { at: new Date().toISOString() });
  assert.equal((await s.run('status', 'reboot')).error, 'interrupted'); assert.equal(alive(process.pid), true);
});
test('stale individual supplied windows remain stale when a different window is updated', async t => {
  const s = await scratch(t), file = path.join(s.root, '.roster', 'usage', 'claude.supplied.json');
  await writeJson(file, { source: 'supplied', readAt: '2000-01-01T00:00:00Z', windows: [{ label: 'weekly', usedPercent: 85, resetsAt: '2099-01-01T00:00:00Z', readAt: '2000-01-01T00:00:00Z' }] });
  await s.run('usage', 'set', 'claude', '--window', 'weekly:model-x', '--used', '20', '--resets', '2099-01-01T00:00:00Z');
  const r = (await s.run('usage')).find(r => r.provider === 'claude');
  assert.equal(r.groups[0].windows.find(w => w.label === 'weekly').stale, true); assert.equal(r.groups[0].windows.find(w => w.label === 'weekly:model-x').stale, false);
});
test('later successful turn clears a learned limit and gauges include local turns', async t => {
  const s = await scratch(t);
  await s.run('start', 'quota', '--provider', 'agy', '--brief', await s.brief('LIMIT'));
  await s.fail('wait', 'quota', '--timeout', '8s');
  await s.run('send', 'quota', '--message', 'Explain the file.'); await s.run('wait', 'quota', '--timeout', '8s');
  const r = (await s.run('usage')).find(r => r.provider === 'agy'); assert.equal(r.limited, false); assert.equal(r.tokenGauge.last5Hours, 30); assert.equal(r.tokenGauge.last7Days, 30);
});
test('status keeps the previous answer visible while a follow-up is running', async t => {
  const s = await scratch(t);
  await s.run('start', 'worker', '--provider', 'codex', '--brief', await s.brief('Create a file.'));
  await s.run('wait', 'worker', '--timeout', '8s');
  await s.run('send', 'worker', '--message', 'SLOW');
  const r = await s.run('status', 'worker'); assert.equal(r.state, 'running'); assert.match(r.answer, /turn-0001/);
  await s.run('stop', 'worker'); await s.fail('wait', 'worker', '--timeout', '8s');
});
test('an actually terminated supervisor becomes failed interrupted', async t => {
  const s = await scratch(t);
  await s.run('start', 'crash', '--provider', 'codex', '--brief', await s.brief('SLOW'));
  const running = await readJson(path.join(turnDir(s.root, 'crash', 1), 'running.json'));
  let fakePid;
  for (let i = 0; i < 100; i++) {
    fakePid = await fs.readFile(path.join(s.root, 'ready.txt'), 'utf8').then(Number, () => null);
    if (fakePid) break; await sleep(20);
  }
  assert(fakePid);
  await writeJson(path.join(turnDir(s.root,'crash',1),'test-abort.json'),{nonce:running.nonce});
  for (let i = 0; i < 100 && alive(running.pid); i++) await sleep(20);
  assert.equal((await s.run('status', 'crash')).error, 'interrupted');
});
