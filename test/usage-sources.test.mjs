import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readAgyUsage, parseAgyFailure } from '../src/agy-usage.mjs';
import { readClaudeUsage } from '../src/claude-usage.mjs';
import { readCodexAllowance } from '../src/codex-usage.mjs';
import { readRateLimits } from '../src/codex-rpc.mjs';
import { mapExternalUsage, readExternalUsage } from '../src/external-usage.mjs';
import { findBinary } from '../src/binaries.mjs';
import { usage, setUsage } from '../src/usage.mjs';
import { groupForModel, familyForModel } from '../src/allowance.mjs';
import { defaults } from '../src/config.mjs';
import { pick } from '../src/pick.mjs';
import { readJson, writeJson } from '../src/io.mjs';
import { alive } from '../src/sessions.mjs';
import { scratch, project } from './helpers.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
const fake = async name => findBinary(name, path.join(project, 'test', 'fakes', `${name}.mjs`));
const fixedNow = Date.parse('2026-11-12T12:00:00Z');
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roster-source-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('Antigravity direct /usage preserves both independent model groups and converts remaining', async () => {
  const result = await readAgyUsage({ binary: await fake('agy'), now: fixedNow });
  assert.equal(result.source, 'agy /usage'); assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].windows[0].usedPercent, 54.12); assert.equal(result.groups[0].windows[1].usedPercent, 17.8);
  assert.equal(result.groups[1].windows[0].usedPercent, 0); assert.equal(result.groups[1].id, 'third-party');
});
test('Antigravity model prefixes map to groups and underlying families', () => {
  for (const model of ['gemini-a', 'gemini-b']) assert.equal(groupForModel('agy', model), 'gemini');
  for (const model of ['claude-opus-a', 'claude-sonnet-a', 'gpt-oss-a']) assert.equal(groupForModel('agy', model), 'third-party');
  assert.equal(groupForModel('agy', 'unrecognized'), null); assert.equal(familyForModel('agy', 'claude-sonnet-a'), 'claude'); assert.equal(familyForModel('agy', 'gpt-oss-a'), 'codex');
});
test('AGY_ERROR 429 reset text is parsed, while missing reset remains unknown', () => {
  const error = message => 'AGY_ERROR: ' + JSON.stringify({ short_error: message, status: 'RESOURCE_EXHAUSTED', error_code: 429 });
  const r = parseAgyFailure(error('RESOURCE_EXHAUSTED (code 429): Resets in 1h1m35s.'), fixedNow);
  assert.equal(r.resetsAt, new Date(fixedNow + 3695000).toISOString());
  assert.equal(parseAgyFailure(error('RESOURCE_EXHAUSTED'), fixedNow).resetsAt, null);
  assert.equal(parseAgyFailure('AGY_ERROR: broken json'), null);
  assert.equal(parseAgyFailure('AGY_ERROR: {"error_code":400,"status":"BAD_REQUEST"}'), null);
});
test('Codex app-server handshake, notifications, windows, credits and cleanup use fake only', async t => {
  const dir = await temporary(t), capture = path.join(dir, 'rpc.pid');
  const binary = await fake('codex');
  // Environment changes are scoped to this test file; its tests run sequentially.
  process.env.ROSTER_FAKE_RPC_CAPTURE = capture;
  try {
    const r = await readRateLimits(binary);
    assert.equal(r.rateLimits.primary.windowDurationMins, 300); assert.equal(r.rateLimits.credits.balance, '123.45');
    const pid = Number(await fs.readFile(capture, 'utf8')); assert.equal(alive(pid), false);
  } finally { delete process.env.ROSTER_FAKE_RPC_CAPTURE; }
});
for (const mode of ['early-exit', 'rpc-error', 'hang']) test(`Codex app-server cleans up ${mode}`, async t => {
  const dir = await temporary(t), capture = path.join(dir, 'rpc.pid');
  process.env.ROSTER_FAKE_RPC_MODE = mode; process.env.ROSTER_FAKE_RPC_CAPTURE = capture;
  try {
    await assert.rejects(readRateLimits(await fake('codex'), { timeoutMs: mode === 'hang' ? 300 : 3000 }));
    assert.equal(alive(Number(await fs.readFile(capture, 'utf8'))), false);
  } finally { delete process.env.ROSTER_FAKE_RPC_MODE; delete process.env.ROSTER_FAKE_RPC_CAPTURE; }
});
test('fresh Codex files are preferred; stale files fall back to app-server', async t => {
  const dir = await temporary(t), file = path.join(dir, 'rollout-fixture.jsonl');
  const event = { timestamp: new Date(fixedNow).toISOString(), payload: { rate_limits: { primary: { used_percent: 17, window_minutes: 10080, resets_at: 4098693600 }, secondary: null, plan_type: 'weekly-only' } } };
  await fs.writeFile(file, JSON.stringify(event));
  const binary = await fake('codex');
  let r = await readCodexAllowance({ binary, sessionsDir: dir, now: fixedNow });
  assert.equal(r.source, 'Codex session log rate_limits'); assert.equal(r.groups[0].windows.length, 1); assert.equal(r.plan, 'weekly-only');
  r = await readCodexAllowance({ binary, sessionsDir: dir, now: fixedNow + 31 * 60000 });
  assert.match(r.source, /app-server/); assert.equal(r.groups[0].windows.length, 2); assert.equal(r.credits.balance, '123.45');
});
test('failed Codex fallback retains stale file evidence', async t => {
  const dir = await temporary(t);
  await fs.writeFile(path.join(dir, 'rollout-fixture.jsonl'), JSON.stringify({ timestamp: '2000-01-01T00:00:00Z', payload: { rate_limits: { primary: { used_percent: 95, window_minutes: 10080, resets_at: 4098693600 } } } }));
  process.env.ROSTER_FAKE_RPC_MODE = 'rpc-error';
  try {
    const r = await readCodexAllowance({ binary: await fake('codex'), sessionsDir: dir, now: fixedNow });
    assert.equal(r.groups[0].windows[0].usedPercent, 95); assert.match(r.fallbackReason, /retained/);
  } finally { delete process.env.ROSTER_FAKE_RPC_MODE; }
});
async function runHook(input, dir, args = []) {
  const child = spawn(process.execPath, [path.join(project, 'scripts', 'claude-statusline-cache.mjs'), ...args], { env: { ...process.env, HOME: dir, USERPROFILE: dir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { code, stdout, stderr };
}
test('Claude hook caches only rate limits and timestamp, with atomic complete output', async t => {
  const dir = await temporary(t), input = await fs.readFile(fixture('claude-statusline'), 'utf8');
  const r = await runHook(input, dir); assert.equal(r.code, 0); assert.equal(r.stdout, 'Claude 5h 23.5% 7d 85%\n');
  const cacheFile = path.join(dir, '.roster', 'claude-usage.json'), stored = await readJson(cacheFile);
  assert.deepEqual(Object.keys(stored).sort(), ['rate_limits', 'readAt']); assert.equal(JSON.stringify(stored).includes('/private'), false);
  const reading = await readClaudeUsage({ cacheFile }); assert.equal(reading.groups[0].windows[1].usedPercent, 85); assert.equal(reading.groups[0].windows[0].minutes, 300);
  assert.deepEqual(await fs.readdir(path.dirname(cacheFile)), ['claude-usage.json']);
});
test('Claude hook passes identical stdin and argument boundaries to existing status command', async t => {
  const dir = await temporary(t), passthrough = path.join(dir, 'existing status Ω.mjs');
  await fs.writeFile(passthrough, "let input = ''; for await (const c of process.stdin) input += c; console.log(JSON.stringify({input,args:process.argv.slice(2)}));");
  const input = await fs.readFile(fixture('claude-statusline'), 'utf8');
  const result = await runHook(input, dir, [process.execPath, passthrough, 'literal & value']);
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { input, args: ['literal & value'] });
});
test('absent, malformed and independently absent Claude windows remain honest', async t => {
  const dir = await temporary(t), file = path.join(dir, 'cache.json');
  assert.equal((await readClaudeUsage({ cacheFile: file })).unknown, true);
  await fs.writeFile(file, '{broken'); assert.equal((await readClaudeUsage({ cacheFile: file })).unknown, true);
  await runHook('{}', dir); await assert.rejects(fs.access(path.join(dir, '.roster', 'claude-usage.json')));
  await writeJson(file, { rate_limits: { seven_day: { used_percentage: 0, resets_at: 4098693600 } }, readAt: '2000-01-01T00:00:00Z' });
  const r = await readClaudeUsage({ cacheFile: file }); assert.equal(r.groups[0].windows.length, 1); assert.equal(r.groups[0].windows[0].usedPercent, 0); assert.equal(r.observedAt, '2000-01-01T00:00:00Z');
});
test('manual per-model weekly limits survive newer status-line general readings', async t => {
  const s = await scratch(t), cacheFile = path.join(s.parent, 'status-cache.json');
  await setUsage(s.root, 'claude', [{ label: 'weekly:model-x', usedPercent: 95, resetsAt: '2099-11-18T00:00:00Z' }]);
  await writeJson(cacheFile, { readAt: new Date(Date.now() + 1000).toISOString(), rate_limits: { seven_day: { used_percentage: 10, resets_at: 4098693600 } } });
  const r = (await usage(s.root, s.config, { refresh: true, sourceOptions: { claude: { cacheFile }, codex: { sessionsDir: path.join(s.parent, 'empty') } } })).find(r => r.provider === 'claude');
  assert.equal(r.groups[0].windows.find(w => w.label === 'weekly:model-x').usedPercent, 95); assert.equal(r.groups[0].windows.find(w => w.label === 'weekly').usedPercent, 10);
});
test('group-aware pick can use Claude through Antigravity when Gemini is full', () => {
  const config = structuredClone(defaults); config.kinds.review = [{ provider: 'agy', model: 'gemini-example', effort: 'low' }, { provider: 'agy', model: 'claude-opus-example', effort: 'low' }];
  const reading = { provider: 'agy', groups: [{ id: 'gemini', windows: [{ usedPercent: 99 }] }, { id: 'third-party', windows: [{ usedPercent: 10 }] }] };
  const p = pick(config, 'review', [{ provider: 'agy', installed: true, authState: 'signed in' }], [reading]);
  assert.equal(p.selected.model, 'claude-opus-example'); assert.equal(p.selected.group, 'third-party');
  assert.equal(pick(config, 'review', [{ provider: 'agy', installed: true, authState: 'signed in' }], [reading], 'claude').selected, null);
});
test('model-family exclusion also excludes GPT models through Antigravity', () => {
  const config = structuredClone(defaults); config.kinds.review = [{ provider: 'agy', model: 'gpt-oss-example', effort: 'low' }];
  assert.equal(pick(config, 'review', [{ provider: 'agy', installed: true, authState: 'signed in' }], [], 'codex').selected, null);
});
test('per-model supplied weekly limits apply only to the matching Claude model', () => {
  const config = structuredClone(defaults); config.kinds.ui = [{ provider: 'claude', model: 'opus', effort: 'low' }, { provider: 'claude', model: 'sonnet', effort: 'low' }];
  const p = pick(config, 'ui', [{ provider: 'claude', installed: true, authState: 'signed in' }], [{ provider: 'claude', groups: [{ id: 'default', windows: [{ label: 'weekly', usedPercent: 20 }, { label: 'weekly:opus', usedPercent: 95 }] }] }]);
  assert.equal(p.selected.model, 'sonnet'); assert.equal(p.rejected[0].model, 'opus');
});
test('structured exit-three quota failure limits its group only and records reset', async t => {
  const s = await scratch(t);
  await s.run('start', 'limited', '--provider', 'agy', '--brief', await s.brief('STRUCTURED_LIMIT'));
  await s.fail('wait', 'limited', '--timeout', '8s');
  const result = await readJson(path.join(s.root, '.roster', 'sessions', 'limited', 'turn-0001', 'result.json'));
  assert.equal(result.exitCode, 3); assert.equal(result.group, 'gemini'); assert(Number.isFinite(Date.parse(result.limitResetsAt)));
  const r = (await s.run('usage')).find(r => r.provider === 'agy'); assert.equal(r.groups.find(g => g.id === 'gemini').limited, true); assert.equal(r.groups.find(g => g.id === 'third-party').limited, false);
});
test('cross-review refuses the same underlying Claude family through another CLI', async t => {
  const s = await scratch(t);
  await s.run('start', 'author', '--provider', 'agy', '--model', 'claude-sonnet-5-5-low', '--brief', await s.brief('Create a file.'));
  await s.run('wait', 'author', '--timeout', '8s');
  assert.match((await s.fail('review', 'author', '--by', 'claude')).error, /underlying model family/);
});
test('external JSON mapping drops identities, maps errors, and rejects account ambiguity', async () => {
  const data = await readJson(fixture('external-usage')), r = mapExternalUsage(data, fixedNow);
  assert.equal(r[0].groups[0].windows[1].usedPercent, 48); assert.equal(r[0].plan, 'fixture-plan'); assert.equal(JSON.stringify(r).includes('do-not-persist'), false); assert.equal(r[1].unknown, true);
  assert.equal(mapExternalUsage([data[0], data[0]], fixedNow)[0].unknown, true);
});
test('Win-CodexBar snake_case serialization maps without retaining its identity fields', async () => {
  const r = mapExternalUsage(await readJson(fixture('external-win-codexbar')), fixedNow)[0];
  assert.equal(r.groups[0].windows[0].usedPercent, 17); assert.equal(r.groups[0].windows[0].label, 'weekly'); assert.equal(r.plan, 'Example subscription');
  assert.equal(JSON.stringify(r).includes('discard@example.invalid'), false); assert.equal(r.observedAt, new Date(fixedNow).toISOString());
});
test('optional external executable gets literal arguments and supplies usage', async t => {
  const s = await scratch(t), script = path.join(s.parent, 'external reader Ω.mjs');
  await fs.writeFile(script, `import fs from 'node:fs'; if(process.argv[2] !== 'literal & text') process.exit(1); console.log(fs.readFileSync(process.argv[3], 'utf8'));`);
  const command = [process.execPath, script, 'literal & text', fixture('external-usage')];
  const r = await readExternalUsage(command, { now: fixedNow }); assert.equal(r[0].groups[0].windows[0].usedPercent, 21);
  s.config.usage.externalCommand = command;
  const reading = (await usage(s.root, s.config, { refresh: true })).find(r => r.provider === 'codex'); assert.equal(reading.source, 'external command');
});
test('canonical skill and Windows-safe copied skill are byte-identical', async () => {
  const canonical = await fs.readFile(path.join(project, 'skills', 'multi-agent-dispatch', 'SKILL.md'));
  const copied = await fs.readFile(path.join(project, '.agents', 'skills', 'multi-agent-dispatch', 'SKILL.md'));
  assert.deepEqual(copied, canonical);
});
