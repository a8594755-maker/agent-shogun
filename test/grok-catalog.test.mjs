import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, readJson, writeJson } from '../src/io.mjs';
import { defaults, loadConfig, providerNames } from '../src/config.mjs';
import { adapters } from '../src/adapters/index.mjs';
import { findBinary, probe } from '../src/binaries.mjs';
import { usage } from '../src/usage.mjs';
import { pick } from '../src/pick.mjs';
import { validateCatalog, renderCatalogSkill, catalogBlock, catalogStatus, loadCatalog, setCatalog, modelDrift } from '../src/catalog.mjs';
import { defaultSkillRoot, defaultSkillCopy, skillFiles, syncSkill } from '../src/skill-sync.mjs';
import { scratch, project, cli } from './helpers.mjs';

const seed = () => readJson(path.join(defaultSkillRoot, 'references', 'model-catalog.json'));
const installed = providerNames.map(provider => ({ provider, installed: true, authState: 'signed in' }));
async function isolatedCatalog(s) {
  const root = path.join(s.parent, 'portable', 'skills', 'multi-agent-dispatch');
  await fs.cp(defaultSkillRoot, root, { recursive: true });
  s.config.catalog.path = root;
  await fs.writeFile(path.join(s.root, 'roster.config.json'), JSON.stringify(s.config));
  return root;
}
test('Grok safe/full flags, chosen UUID, prompt paths and web policy are explicit', () => {
  const input = { model: 'grok-4.7-build-fast', effort: 'low', providerSessionId: 'chosen-uuid', directory: 'space Ω', promptFile: 'prompt Ω.txt' };
  const safe = adapters.grok.build({ ...input, access: 'safe' }).args;
  assert(safe.includes('default')); assert(safe.includes('workspace')); assert(safe.includes('--deny')); assert(safe.includes('--disable-web-search')); assert(safe.includes('chosen-uuid')); assert(safe.includes('prompt Ω.txt')); assert(!safe.includes('bypassPermissions'));
  const full = adapters.grok.build({ ...input, access: 'full', web: true, sessionId: 'resume-uuid' }).args;
  assert(full.includes('bypassPermissions')); assert(full.includes('off')); assert(full.includes('-r')); assert(!full.includes('-s')); assert(!full.includes('--disable-web-search'));
});
test('Grok detached start exposes its UUID before completion and resumes that same ID', async t => {
  const s = await scratch(t);
  await s.run('start', 'grok-worker', '--provider', 'grok', '--brief', await s.brief('SLOW CAPTURE'));
  const initial = await s.run('status', 'grok-worker'); assert.match(initial.sessionId, /^[0-9a-f-]{36}$/); assert.equal(initial.state, 'running');
  await s.run('wait', 'grok-worker', '--timeout', '8s');
  const capture = JSON.parse((await s.run('answer', 'grok-worker')).answer);
  assert.equal(capture.push, 'disabled://roster-do-not-push'); assert.equal(capture.deploy, 'roster-deploy-disabled');
  await s.run('send', 'grok-worker', '--message', 'What file did you create? One word.'); await s.run('wait', 'grok-worker', '--timeout', '8s');
  assert.equal((await s.run('answer', 'grok-worker')).answer, 'hello.txt'); assert.equal((await s.run('status', 'grok-worker')).sessionId, initial.sessionId);
  const r = (await s.run('usage')).find(r => r.provider === 'grok'); assert.equal(r.unknown, true); assert.equal(r.tokenGauge.last5Hours, 30); assert.equal(r.costGauge.last5Hours.totalUsd, 0.0334); assert.equal(r.costGauge.last7Days.reportedTurns, 2);
});
test('Grok max-turn termination is failed, preserves spend and is not a quota limit', async t => {
  const s = await scratch(t);
  await s.run('start', 'limited-turns', '--provider', 'grok', '--brief', await s.brief('MAX_TURNS'));
  const result = await s.fail('wait', 'limited-turns', '--timeout', '8s'); assert.equal(result.sessions[0].state, 'failed');
  const receipt = await readJson(path.join(s.root, '.roster', 'sessions', 'limited-turns', 'turn-0001', 'result.json'));
  assert.equal(receipt.costUsd, 0.0167); assert.equal(receipt.limited, false);
});
test('Grok quota failures are learned; absent cost is unknown rather than free', async t => {
  const s = await scratch(t);
  await s.run('start', 'quota', '--provider', 'grok', '--brief', await s.brief('LIMIT NO_COST'));
  await s.fail('wait', 'quota', '--timeout', '8s');
  const r = (await s.run('usage')).find(r => r.provider === 'grok'); assert.equal(r.groups[0].limited, true); assert.equal(r.costGauge.last5Hours.totalUsd, null); assert.equal(r.costGauge.last5Hours.unreportedTurns, 1);
});
test('Grok cost and token gauges honor 5-hour and 7-day boundaries', async t => {
  const s = await scratch(t), now = Date.now();
  for (const [i, hours, cost, total] of [[1, 1, 0.1, 10], [2, 6, 0.2, 20], [3, 169, 9, 900]]) await writeJson(path.join(s.root, '.roster', 'sessions', `sample${i}`, 'turn-0001', 'result.json'), { provider: 'grok', group: 'default', state: 'done', endedAt: new Date(now - hours * 3600000).toISOString(), costUsd: cost, tokens: { total } });
  const r = (await usage(s.root, s.config, { now })).find(r => r.provider === 'grok');
  assert.equal(r.costGauge.last5Hours.totalUsd, 0.1); assert.equal(r.costGauge.last7Days.totalUsd, 0.3); assert.equal(r.tokenGauge.last7Days, 30);
});
for (const provider of providerNames) test(`${provider} auth probe detects signed in, signed out, and unknown without inference`, async t => {
  const s = await scratch(t);
  assert.equal((await probe(provider, s.config, adapters[provider])).authState, 'signed in');
  process.env.ROSTER_FAKE_SIGNED_OUT = provider;
  try { assert.equal((await probe(provider, s.config, adapters[provider])).authState, 'not signed in'); }
  finally { delete process.env.ROSTER_FAKE_SIGNED_OUT; }
  process.env.ROSTER_FAKE_AUTH_UNKNOWN = provider;
  try { assert.equal((await probe(provider, s.config, adapters[provider])).authState, 'unknown'); }
  finally { delete process.env.ROSTER_FAKE_AUTH_UNKNOWN; }
});
test('pick never chooses signed-out or unknown-auth providers', () => {
  const c = structuredClone(defaults); c.kinds = {}; c.kinds.custom = [{ provider: 'grok', model: 'grok-4.7', effort: 'none' }];
  for (const authState of ['not signed in', 'unknown', undefined]) assert.equal(pick(c, 'custom', [{ provider: 'grok', installed: true, authState }], []).selected, null);
  assert.equal(pick(c, 'custom', installed, []).selected.provider, 'grok');
});
test('Grok allowance reader never invokes a fake /usage inference call', async () => {
  const r = await adapters.grok.readUsage({ binary: await findBinary('grok', path.join(project, 'test', 'fakes', 'grok.mjs')) }); assert.equal(r.unknown, true); assert.match(r.reason, /No headless/);
});
test('catalog generated tables, date line and next check exactly match JSON', async () => {
  const c = validateCatalog(await seed()), text = await fs.readFile(path.join(defaultSkillRoot, 'SKILL.md'), 'utf8');
  const next = new Date(Date.parse(c.verifiedAt) + 15 * 86400000).toISOString().slice(0, 10);
  assert.equal(text, renderCatalogSkill(text, c)); assert(text.includes(catalogBlock(c))); assert(text.includes(`Next check: ${next}`)); assert(text.includes(c.verifiedBy)); assert(text.trimEnd().split('\n').length <= 160);
});
test('full skill copies include byte-identical references as well as SKILL.md', async () => {
  const a = await skillFiles(defaultSkillRoot), b = await skillFiles(defaultSkillCopy);
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort()); for (const [name, data] of a) assert.deepEqual(b.get(name), data, name);
});
test('catalog age becomes stale only after maxAgeDays and missing catalog is stale', async () => {
  const c = await seed(); c.verifiedAt = '2026-11-12'; assert.equal(catalogStatus(c, 15, Date.parse('2026-11-27')).stale, false); assert.equal(catalogStatus(c, 15, Date.parse('2026-11-28')).stale, true); assert.equal(catalogStatus(null).stale, true);
});
test('catalog status exits 3 with one clear line for stale and missing files', async t => {
  const s = await scratch(t), folder = await isolatedCatalog(s), file = path.join(folder, 'references', 'model-catalog.json'), c = await seed();
  c.verifiedAt = '2000-01-01'; await writeJson(file, c);
  await assert.rejects(exec(process.execPath, [cli, 'catalog', 'status'], { cwd: s.root, env: s.env }), e => e.code === 3 && /Catalog STALE/.test(e.stdout) && e.stdout.trim().split('\n').length === 1);
  await fs.unlink(file); const missing = await s.fail('catalog', 'status'); assert.equal(missing.code, 3); assert.equal(missing.stale, true);
});
test('catalog set rejects malformed JSON/schema without touching either skill tree', async t => {
  const s = await scratch(t), folder = await isolatedCatalog(s), before = await skillFiles(folder), bad = path.join(s.parent, 'bad-catalog.json');
  const unchanged = async () => assert.deepEqual([...await skillFiles(folder)], [...before]);
  await fs.writeFile(bad, '{broken'); await assert.rejects(setCatalog(s.root, s.config, bad)); await unchanged();
  const c = await seed(); c.allocation.server[0].model = 'invented'; await writeJson(bad, c); await assert.rejects(setCatalog(s.root, s.config, bad), /Invalid catalog/); await unchanged();
  assert.equal((await fs.readdir(path.dirname(folder))).some(n => n.endsWith('.lock')), false);
});
test('catalog set archives both revisions, regenerates dates and syncs complete skill', async t => {
  const s = await scratch(t), folder = await isolatedCatalog(s), c = await seed(), input = path.join(s.parent, 'new-catalog.json');
  const oldDate = c.verifiedAt, historyDir = path.join(folder, 'references', 'catalog-history'), oldHistory = await fs.readdir(historyDir).catch(() => []);
  c.verifiedAt = new Date(Date.parse(oldDate) + 86400000).toISOString().slice(0, 10); c.verifiedBy = 'fixture researcher'; c.changesSinceLastCheck = ['Fixture update']; await writeJson(input, c);
  const result = await s.run('catalog', 'set', input); assert.equal(result.verifiedAt, c.verifiedAt);
  const next = new Date(Date.parse(c.verifiedAt) + 15 * 86400000).toISOString().slice(0, 10);
  const text = await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8'); assert(text.includes(`Next check: ${next}`)); assert.equal(text, renderCatalogSkill(text, c));
  const history = await fs.readdir(historyDir); assert.equal(history.length, oldHistory.length + 2); assert(history.some(n => n.startsWith(oldDate))); assert(history.some(n => n.startsWith(c.verifiedAt)));
  const copy = path.join(s.parent, 'portable', '.agents', 'skills', 'multi-agent-dispatch'); assert.deepEqual([...await skillFiles(copy)], [...await skillFiles(folder)]);
});
test('catalog show/status work from outside a Git repository', async t => {
  const s = await scratch(t);
  const r = await exec(process.execPath, [cli, 'catalog', 'show', '--json'], { cwd: s.parent, env: s.env }); assert.equal(JSON.parse(r.stdout).verifiedAt, (await seed()).verifiedAt);
});
test('allocation precedence is explicit user kinds, then catalog, then built-ins; kinds are open', async t => {
  const s = await scratch(t), c = await seed();
  await fs.writeFile(path.join(s.root, 'roster.config.json'), JSON.stringify({ providers: s.config.providers, kinds: { custom: [{ provider: 'grok', model: 'grok-4.7', effort: 'none' }] } }));
  const config = await loadConfig(s.root), info = { catalog: c, status: catalogStatus(c, 15, Date.parse('2026-11-12')) };
  assert.equal(pick(config, 'server', installed, [], undefined, info).allocationSource, 'skill catalog'); assert.equal(pick(config, 'custom', installed, [], undefined, info).allocationSource, 'project rule');
  assert.equal(pick(config, 'server', installed, [], undefined, { ...info, catalog: null }).allocationSource, 'most allowance left');
  assert.deepEqual(pick(config, 'mechanical', installed, [], undefined, info).selected, pick(config, 'tests', installed, [], undefined, info).selected);
});
test('pick warns for stale catalogs and model drift identifies additions and retirements', async () => {
  const c = await seed(), p = { provider: 'grok', installed: true, authState: 'signed in', modelsListed: true, models: ['grok-new'] }, warnings = modelDrift(c, [p]).get('grok');
  assert(warnings.some(w => w.includes('uncatalogued models: grok-new'))); assert(warnings.some(w => w.includes('no longer lists: grok-4.7')));
  const config = structuredClone(defaults), result = pick(config, 'server', installed, [], undefined, { catalog: c, status: catalogStatus(c, 15, Date.parse('2099-01-01')) }); assert(result.warnings.some(w => w.includes('STALE')));
});
test('invalid model details are rejected without pretending unknown metadata is confirmed', async () => {
  const c = await seed(); c.providers.grok.models[0].contextWindow = 0; c.providers.grok.models[0].released = null; assert.equal(validateCatalog(c), c); c.providers.grok.models[0].tier = 'made-up'; assert.throws(() => validateCatalog(c));
});
