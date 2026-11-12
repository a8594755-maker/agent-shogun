import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { providerNames } from './config.mjs';
import { defaultSkillRoot, defaultSkillCopy, atomicText, syncSkill } from './skill-sync.mjs';

const day = 86400000;
const dateValid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const string = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(string);
export function validateCatalog(c) {
  const fail = message => { throw new Error(`Invalid catalog: ${message}`); };
  if (!c || !dateValid(c.verifiedAt) || !string(c.verifiedBy)) fail('verifiedAt must be YYYY-MM-DD and verifiedBy must be nonempty.');
  if (!c.providers || typeof c.providers !== 'object' || Array.isArray(c.providers)) fail('providers must be an object.');
  for (const name of providerNames) {
    const p = c.providers[name];
    if (!p || !string(p.cli) || !string(p.signIn) || p.usageCommand !== null && !string(p.usageCommand)) fail(`missing CLI/sign-in/usage metadata for ${name}.`);
    if (!Array.isArray(p.plans) || !p.plans.every(plan => string(plan.name) && strings(plan.windows) && typeof plan.notes === 'string')) fail(`invalid plans for ${name}.`);
    if (!Array.isArray(p.models) || !p.models.length) fail(`no models for ${name}.`);
    const ids = new Set();
    for (const m of p.models) {
      if (!string(m.id) || ids.has(m.id)) fail(`duplicate/empty model id for ${name}.`); ids.add(m.id);
      if (m.group !== null && !string(m.group) || m.released !== null && !dateValid(m.released)) fail(`invalid group/release for ${m.id}.`);
      if (m.tier !== null && !['frontier', 'strong', 'fast'].includes(m.tier) || !Number.isSafeInteger(m.contextWindow) || m.contextWindow < 0 || !strings(m.efforts) || !Number.isFinite(m.relativeAllowanceCost) || m.relativeAllowanceCost <= 0 || !strings(m.bestFor) || !strings(m.weakAt) || !Array.isArray(m.evidence) || !m.evidence.every(e => string(e) || e && typeof e === 'object' && !Array.isArray(e))) fail(`invalid model details for ${m.id}.`);
    }
  }
  if (Object.keys(c.providers).some(p => !providerNames.includes(p))) fail('unsupported provider.');
  if (!c.allocation || typeof c.allocation !== 'object' || Array.isArray(c.allocation)) fail('allocation must be an object.');
  for (const [kind, choices] of Object.entries(c.allocation)) {
    if (!kind.trim() || ['__proto__', 'constructor', 'prototype'].includes(kind) || !Array.isArray(choices) || !choices.length) fail(`invalid allocation kind ${kind}.`);
    for (const choice of choices) {
      const model = c.providers[choice.provider]?.models.find(m => m.id === choice.model);
      if (!model || !string(choice.effort) || !string(choice.why) || model.efforts.length && !model.efforts.includes(choice.effort)) fail(`unknown model or effort in allocation ${kind}.`);
    }
  }
  if (!strings(c.changesSinceLastCheck) || !strings(c.notConfirmed)) fail('changesSinceLastCheck and notConfirmed must be string arrays.');
  return c;
}
export function catalogPaths(root, config) {
  const configured = config.catalog?.path;
  const file = configured ? /\.json$/i.test(configured) ? path.resolve(root, configured) : path.resolve(root, configured, 'references', 'model-catalog.json') : path.join(defaultSkillRoot, 'references', 'model-catalog.json');
  const skillRoot = path.dirname(path.dirname(file));
  if (path.basename(path.dirname(file)) !== 'references' || path.basename(file) !== 'model-catalog.json') throw new Error('catalog.path must be a skill folder or its references/model-catalog.json file.');
  const copyRoot = !configured ? defaultSkillCopy : path.basename(path.dirname(skillRoot)) === 'skills' ? path.resolve(skillRoot, '..', '..', '.agents', 'skills', path.basename(skillRoot)) : path.join(path.dirname(skillRoot), '.agents', 'skills', path.basename(skillRoot));
  return { file, skillRoot, skillFile: path.join(skillRoot, 'SKILL.md'), copyRoot, history: path.join(skillRoot, 'references', 'catalog-history') };
}
export function catalogStatus(catalog, maxAgeDays = 15, now = Date.now(), reason) {
  const today = new Date(now).toISOString().slice(0, 10);
  const ageDays = catalog ? Math.max(0, Math.round((Date.parse(today) - Date.parse(catalog.verifiedAt)) / day)) : null;
  const stale = !catalog || ageDays > maxAgeDays;
  return { verifiedAt: catalog?.verifiedAt || null, verifiedBy: catalog?.verifiedBy || null, ageDays, maxAgeDays, nextCheck: catalog ? new Date(Date.parse(catalog.verifiedAt) + maxAgeDays * day).toISOString().slice(0, 10) : null, stale, ...(reason ? { reason } : {}), line: !catalog ? `Catalog missing or invalid: ${reason || 'no catalog'}; refresh before dispatch when possible.` : `Catalog ${stale ? 'STALE' : 'current'}: age ${ageDays} days (verified ${catalog.verifiedAt}; maximum ${maxAgeDays}); next check ${new Date(Date.parse(catalog.verifiedAt) + maxAgeDays * day).toISOString().slice(0, 10)}.` };
}
export async function loadCatalog(root, config, now = Date.now()) {
  const paths = catalogPaths(root, config);
  try {
    const catalog = validateCatalog(JSON.parse(await fs.readFile(paths.file, 'utf8')));
    return { catalog, status: catalogStatus(catalog, config.catalog?.maxAgeDays ?? 15, now), paths };
  } catch (e) { return { catalog: null, status: catalogStatus(null, config.catalog?.maxAgeDays ?? 15, now, e.code === 'ENOENT' ? 'model-catalog.json not found' : 'catalog could not be validated'), paths }; }
}
const cell = s => String(s).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
export function catalogBlock(c) {
  const provisional = c.verifiedBy.startsWith('initial,');
  const lines = ['<!-- catalog:start -->', '| Provider | Model / callable ID pattern | Efforts | Tier | Best for | Allowance group |', '| --- | --- | --- | --- | --- | --- |'];
  for (const [provider, data] of Object.entries(c.providers)) {
    const families = new Map();
    for (const model of data.models) {
      const variant = /^(.*)-(none|minimal|low|medium|high|xhigh|max)$/.exec(model.id);
      const base = variant ? variant[1] : model.id, key = `${base}\0${model.group || ''}`;
      if (!families.has(key)) families.set(key, { base, variants: !!variant, group: model.group, efforts: new Set(), tiers: new Set(), best: new Set() });
      const row = families.get(key);
      for (const effort of variant ? [variant[2]] : model.efforts) row.efforts.add(effort);
      row.tiers.add(model.tier === null ? 'unknown' : model.tier + (provisional ? '?' : ''));
      for (const best of model.bestFor) row.best.add(best);
    }
    const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const row of families.values()) lines.push(`| ${provider} | \`${cell(row.base)}${row.variants ? '-<effort>' : ''}\` | ${cell([...row.efforts].sort((a,b) => order.indexOf(a)-order.indexOf(b)).join(' / ') || 'unknown')} | ${cell([...row.tiers].join(' / '))} | ${cell([...row.best].slice(0, 2).join('; ') || 'Not confirmed')} | ${cell(row.group || 'provider pool')} |`);
  }
  lines.push('', '**How to read what is left**', '| Provider | Command or source | Windows |', '| --- | --- | --- |');
  for (const [provider, data] of Object.entries(c.providers)) lines.push(`| ${provider} | ${cell(data.usageCommand || 'Unknown; local token/cost gauge')} | ${cell([...new Set(data.plans.flatMap(p => p.windows))].join(' / ') || 'unknown')} |`);
  lines.push('', '| Work | First choice | Second choice |', '| --- | --- | --- |');
  const show = choice => choice ? `\`${choice.provider}/${choice.model}\` (${choice.effort})` : 'None configured';
  for (const [kind, choices] of Object.entries(c.allocation)) lines.push(`| ${cell(kind)} | ${show(choices[0])} | ${show(choices[1])} |`);
  lines.push('<!-- catalog:end -->');
  return lines.join('\n');
}
export function renderCatalogSkill(template, catalog) {
  validateCatalog(catalog);
  if ((template.match(/<!-- catalog:start -->/g) || []).length !== 1 || (template.match(/<!-- catalog:end -->/g) || []).length !== 1) throw new Error('SKILL.md needs exactly one catalog marker pair.');
  if (!/^\*\*Catalog: last verified .+\*\*$/m.test(template) || !/^Next check: .+$/m.test(template)) throw new Error('SKILL.md needs catalog verification and next-check lines.');
  const dateLine = `**Catalog: last verified ${catalog.verifiedAt} by ${catalog.verifiedBy}**`;
  const next = new Date(Date.parse(catalog.verifiedAt) + 15 * day).toISOString().slice(0, 10);
  const text = template.replace(/^\*\*Catalog: last verified .+\*\*$/m, () => dateLine).replace(/^Next check: .+$/m, () => `Next check: ${next} (verified + 15 days).`).replace(/<!-- catalog:start -->[\s\S]*?<!-- catalog:end -->/, () => catalogBlock(catalog));
  if (text.trimEnd().split('\n').length > 160) throw new Error('Generated SKILL.md exceeds 160 lines; shorten the working method or catalog presentation.');
  return text;
}
export function modelDrift(catalog, providers) {
  if (!catalog) return new Map();
  return new Map(providers.map(p => {
    const expected = new Set(catalog.providers[p.provider]?.models.map(m => m.id) || []);
    if (!p.installed || p.authState !== 'signed in' || !p.modelsListed || !p.models.length) return [p.provider, []];
    const actual = new Set(p.models), added = p.models.filter(m => !expected.has(m)), missing = [...expected].filter(m => !actual.has(m));
    return [p.provider, [...(added.length ? [`Catalog stale: ${p.provider} CLI lists uncatalogued models: ${added.join(', ')}.`] : []), ...(missing.length ? [`Catalog stale: ${p.provider} CLI no longer lists: ${missing.join(', ')}.`] : [])]];
  }));
}
export async function setCatalog(root, config, sourceFile) {
  // Validate every input and render before any mutation, including lock/history creation.
  const incoming = validateCatalog(JSON.parse(await fs.readFile(sourceFile, 'utf8')));
  const paths = catalogPaths(root, config), before = await fs.readFile(paths.skillFile, 'utf8');
  const rendered = renderCatalogSkill(before, incoming);
  const previous = await fs.readFile(paths.file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  const lockFile = path.join(path.dirname(paths.skillRoot), `.${path.basename(paths.skillRoot)}.catalog-update.lock`);
  const lock = await fs.open(lockFile, 'wx').catch(e => { if (e.code === 'EEXIST') throw new Error('Another catalog update is in progress.'); throw e; });
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    if (previous) {
      let date = 'unverified';
      try { const value = JSON.parse(previous).verifiedAt; if (dateValid(value)) date = value; } catch { /* preserve malformed previous data without trusting a filename */ }
      await atomicText(path.join(paths.history, `${date}-${stamp}-previous.json`), previous);
    }
    const json = JSON.stringify(incoming, null, 2) + '\n';
    await atomicText(path.join(paths.history, `${incoming.verifiedAt}-${stamp}-installed.json`), json);
    await atomicText(paths.file, json); await atomicText(paths.skillFile, rendered);
    const synced = await syncSkill(paths.skillRoot, paths.copyRoot);
    return { verifiedAt: incoming.verifiedAt, catalog: paths.file, history: paths.history, copiedFiles: synced.files };
  } finally { await lock.close(); await fs.unlink(lockFile); }
}
