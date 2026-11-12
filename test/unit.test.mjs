import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, loadConfig } from '../src/config.mjs';
import { pick } from '../src/pick.mjs';
import { parseArgs, duration } from '../src/cli.mjs';
import { childEnv, agySettings } from '../src/guards.mjs';
import { readCodexUsage, reverseLines } from '../src/codex-usage.mjs';
import { tokens } from '../src/adapters/common.mjs';
import { adapters } from '../src/adapters/index.mjs';
import { findBinary } from '../src/binaries.mjs';
import { safeName } from '../src/io.mjs';

const installed = ['codex', 'agy', 'claude'].map(provider => ({ provider, installed: true }));
const readings = (codex, agy, claude) => [codex, agy, claude].map((percent, i) => ({ provider: installed[i].provider, windows: percent === null ? [] : [{ usedPercent: percent, label: 'weekly' }] }));
test('pick follows kind order and reports numbers', () => {
  const p = pick(defaults, 'ui', installed, readings(20, 30, 40));
  assert.equal(p.selected.provider, 'claude'); assert.match(p.reason, /claude\/sonnet\[default\]=40%/);
});
test('pick rebalances a gap greater than 25 points', () => assert.equal(pick(defaults, 'server', installed, readings(60, 20, 30)).selected.provider, 'agy'));
test('pick retains preference for exactly 25 points', () => assert.equal(pick(defaults, 'server', installed, readings(45, 20, 30)).selected.provider, 'codex'));
test('pick excludes other-family author', () => assert.equal(pick(defaults, 'review', installed, readings(10, 0, 20), 'agy').selected.provider, 'codex'));
test('pick excludes missing, limited and ceiling providers', () => {
  const r = readings(90, 1, 5); r[1].limited = true;
  const p = pick(defaults, 'review', installed.map(x => ({ ...x, installed: x.provider !== 'claude' })), r);
  assert.equal(p.selected, null); assert.equal(p.rejected.length, 4);
});
test('pick evaluates tightest window', () => {
  const r = readings(2, 20, 10); r[0].windows.push({ usedPercent: 95 });
  assert.equal(pick(defaults, 'server', installed, r).selected.provider, 'claude');
});
test('unknown usage remains explicit without inventing a percent', () => {
  const p = pick(defaults, 'review', installed, readings(0, null, 0));
  assert.equal(p.selected.provider, 'agy'); assert.equal(p.selected.tightest, null); assert.match(p.reason, /unknown/);
});
test('expired windows do not permanently exclude provider', () => {
  const r = readings(99, 10, 10); r[0].windows[0].expired = true;
  assert.equal(pick(defaults, 'server', installed, r).selected.provider, 'codex');
});
test('research choice includes web request', () => assert.equal(pick(defaults, 'research', installed, readings(0, 0, 0)).selected.web, true));
test('argument arrays preserve spaces, Unicode and shell metacharacters', () => {
  const p = parseArgs(['send', 'one', '--message', 'a Ω & $(not-a-command)', '--json']);
  assert.equal(p.options.message, 'a Ω & $(not-a-command)'); assert.equal(p.json, true);
});
test('leading JSON flag and option-like literal values are supported', () => {
  const p = parseArgs(['--json', 'send', 'worker', '--message=--literal']);
  assert.equal(p.json, true); assert.equal(p.options.message, '--literal');
});
test('parser rejects unknown options, missing values and duplicates', () => {
  for (const argv of [['start', 'a', '--wat'], ['send', 'a', '--message'], ['start', 'a', '--model', 'a', '--model', 'b']]) assert.throws(() => parseArgs(argv));
});
test('duration accepts common units and rejects invalid values', () => {
  assert.equal(duration('30m'), 1800000); assert.equal(duration('0.1s'), 100); assert.equal(duration('2h'), 7200000);
  assert.throws(() => duration('-1s')); assert.throws(() => duration('tomorrow'));
});
test('names cannot escape session directory', () => {
  for (const n of ['../x', 'x/y', 'x\\y', '.', '', 'a'.repeat(81)]) assert.throws(() => safeName(n));
});
test('guards append inherited git configuration and override deploy env', () => {
  const source = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'color.ui', GIT_CONFIG_VALUE_0: 'false', CLOUDFLARE_API_TOKEN: 'test-dummy' };
  const env = childEnv(defaults, source);
  assert.equal(env.GIT_CONFIG_COUNT, '2'); assert.equal(env.GIT_CONFIG_KEY_1, 'remote.origin.pushurl'); assert.equal(env.GIT_CONFIG_KEY_0, 'color.ui');
  assert.equal(env.CLOUDFLARE_API_TOKEN, 'roster-deploy-disabled'); assert.equal(source.GIT_CONFIG_COUNT, '1');
});
test('guards can be disabled independently', () => {
  const c = structuredClone(defaults); c.guards = { blockPush: false, env: {}, antigravityDeny: false };
  assert.deepEqual(childEnv(c, {}), {}); assert.deepEqual(agySettings(c, false, 'full').permissions.deny, []);
});
test('environment overrides can be disabled or remove one variable', () => {
  const c = structuredClone(defaults); c.guards.blockPush = false; c.guards.env = false;
  assert.deepEqual(childEnv(c, { EXAMPLE: 'preserved' }), { EXAMPLE: 'preserved' });
  c.guards.env = { EXAMPLE: null }; assert.deepEqual(childEnv(c, { EXAMPLE: 'removed' }), {});
});
test('Antigravity guards persist in full mode and web opt-in removes only web denies', () => {
  const safe = agySettings(defaults, false, 'safe'), full = agySettings(defaults, true, 'full');
  assert.equal(safe.enableTerminalSandbox, true); assert.equal(full.enableTerminalSandbox, false);
  assert(safe.permissions.deny.includes('mcp(*)')); assert(!full.permissions.deny.includes('mcp(*)'));
  assert(full.permissions.deny.some(s => s.includes('push')));
});
test('Codex safe flags never mix approve-for-me and sandbox flags', () => {
  for (const sessionId of [undefined, 'fake-id']) {
    const args = adapters.codex.build({ model: 'fake', effort: 'low', access: 'safe', answer: 'a b.txt', sessionId }).args;
    assert(args.includes('--approve-for-me')); assert(!args.includes('-s')); assert(args.includes('-'));
  }
});
test('Codex full resume uses config because resume has no -s option', () => {
  const args = adapters.codex.build({ model: 'fake', effort: 'low', access: 'full', sessionId: 'fake-id', answer: 'a' }).args;
  assert(args.includes('sandbox_mode="danger-full-access"')); assert(!args.includes('-s')); assert(args.includes('approval_policy="never"'));
});
test('Claude safe and full map to the documented permission flags', () => {
  assert(adapters.claude.build({ access: 'safe' }).args.includes('acceptEdits'));
  assert(adapters.claude.build({ access: 'full' }).args.includes('bypassPermissions'));
});
test('token counts avoid double-counting Codex cache and include Claude cache', () => {
  assert.equal(tokens({ input_tokens: 10, cached_input_tokens: 3, output_tokens: 5 }).total, 15);
  assert.equal(tokens({ input_tokens: 10, cache_read_input_tokens: 3, output_tokens: 5 }).total, 18);
});
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roster-fixture-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
const limit = used => ({ timestamp: '2026-11-12T12:00:00Z', payload: { rate_limits: { limit_id: 'codex', primary: { used_percent: used, window_minutes: 300, resets_at: 1795026619 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1795026619 }, plan_type: 'fixture' } } });
test('Codex reader uses last matching event in newest rollout file', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'rollout-old.jsonl'), JSON.stringify(limit(99)));
  await fs.utimes(path.join(dir, 'rollout-old.jsonl'), 1, 1);
  await fs.writeFile(path.join(dir, 'rollout-new.jsonl'), [limit(1), limit(16), { type: 'turn.completed' }].map(JSON.stringify).join('\n') + '\ntruncated-json');
  const r = await readCodexUsage({ sessionsDir: dir });
  assert.equal(r.windows[0].usedPercent, 16); assert.equal(r.windows[1].label, 'weekly'); assert.equal(r.plan, 'fixture'); assert.equal(r.observedAt, '2026-11-12T12:00:00.000Z');
});
test('Codex reader falls back from newer files with no reading', async t => {
  const dir = await temp(t); await fs.writeFile(path.join(dir, 'rollout-one.jsonl'), JSON.stringify(limit(0)));
  await fs.utimes(path.join(dir, 'rollout-one.jsonl'), 1, 1); await fs.writeFile(path.join(dir, 'rollout-two.jsonl'), '{}');
  assert.equal((await readCodexUsage({ sessionsDir: dir })).windows[0].usedPercent, 0);
});
test('Codex reader handles missing source and nullable windows', async t => {
  const dir = await temp(t); assert.equal((await readCodexUsage({ sessionsDir: dir })).unknown, true);
  const event = limit(2); event.payload.rate_limits.secondary = null; event.payload.rate_limits.primary.window_minutes = 10080;
  await fs.writeFile(path.join(dir, 'rollout-one.jsonl'), JSON.stringify(event));
  const r = await readCodexUsage({ sessionsDir: dir }); assert.equal(r.windows.length, 1); assert.equal(r.windows[0].label, 'weekly');
});
test('reverse reader handles chunk boundaries, UTF-8 and oversized lines', async t => {
  const dir = await temp(t), file = path.join(dir, 'rollout-large.jsonl');
  await fs.writeFile(file, 'first Ω\n' + 'x'.repeat(5000) + '\nlast é\n');
  const lines = []; for await (const line of reverseLines(file, 7, 100)) if (line) lines.push(line);
  assert.deepEqual(lines, ['last é', 'first Ω']);
});
test('binary discovery reports missing configured executable', async () => assert.equal(await findBinary('codex', path.join(os.tmpdir(), 'roster-not-installed.exe')), null));
test('configuration merges nested defaults and rejects invalid usage', async t => {
  const dir = await temp(t); await fs.writeFile(path.join(dir, 'roster.config.json'), JSON.stringify({ usage: { ceiling: 80 } }));
  const c = await loadConfig(dir); assert.equal(c.usage.ceiling, 80); assert.equal(c.usage.suppliedMaxAgeMinutes, 30);
  await fs.writeFile(path.join(dir, 'roster.config.json'), JSON.stringify({ usage: { ceiling: 101 } })); await assert.rejects(loadConfig(dir));
});
test('Antigravity accepts real uppercase SUCCESS envelope and exposes usage', async t => {
  const dir = await temp(t), file = path.join(dir, 'rollout-agy.jsonl');
  await fs.writeFile(file, JSON.stringify({ conversation_id: 'fixture', status: 'SUCCESS', response: 'DONE\n', num_turns: 1, usage: { input_tokens: 105245, output_tokens: 610, cache_read_tokens: 8088, total_tokens: 105855 } }));
  const parsed = await adapters.agy.parse(file);
  assert.equal(parsed.ok, true); assert.equal(parsed.usage.total, 105855); assert.equal(parsed.usage.cacheRead, 8088);
});
test('Codex transient error is superseded by a successful completed turn', async t => {
  const dir = await temp(t), file = path.join(dir, 'rollout-retry.jsonl');
  await fs.writeFile(file, [{ type: 'thread.started', thread_id: 'fixture' }, { type: 'error', message: 'Reconnecting' }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(JSON.stringify).join('\n'));
  assert.equal((await adapters.codex.parse(file)).ok, true);
});
