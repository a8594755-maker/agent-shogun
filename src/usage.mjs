import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { providerNames, checkProvider } from './config.mjs';
import { adapters } from './adapters/index.mjs';
import { findBinary } from './binaries.mjs';
import { groupsOf, groupForModel } from './allowance.mjs';
import { readExternalUsage } from './external-usage.mjs';
import { stateDirectory } from './state.mjs';

export async function setUsage(root, provider, windows, plan, groupId = provider === 'agy' ? 'gemini' : 'default') {
  checkProvider(provider);
  if (!['default', 'gemini', 'third-party'].includes(groupId) || provider === 'agy' && groupId === 'default' || provider !== 'agy' && groupId !== 'default') throw new Error('Invalid allowance group for provider.');
  const readAt = new Date().toISOString();
  for (const w of windows) if (!w.label || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 || !Number.isFinite(Date.parse(w.resetsAt))) throw new Error('Each window needs a label, used 0–100, and an ISO reset time.');
  if (!windows.length || new Set(windows.map(w => w.label)).size !== windows.length) throw new Error('Supply unique --window readings.');
  const file = path.join(stateDirectory(root), 'usage', `${provider}.supplied.json`);
  const previous = await readJson(file, {}), groups = groupsOf(previous, provider);
  const old = groups.find(g => g.id === groupId);
  const name = groupId === 'gemini' ? 'Gemini Models' : groupId === 'third-party' ? 'Claude and GPT models' : 'All models';
  const supplied = { groups: [...groups.filter(g => g.id !== groupId), { id: groupId, name, windows: [...(old?.windows || []).filter(w => !windows.some(n => n.label === w.label)), ...windows.map(w => ({ ...w, readAt, source: 'supplied' }))] }], plan: plan || previous.plan || null, source: 'supplied', readAt };
  await writeJson(file, supplied);
  return { provider, ...supplied };
}
export async function turnReceipts(root) {
  const sessions = path.join(stateDirectory(root), 'sessions'), receipts = [];
  for (const name of await fs.readdir(sessions).catch(() => [])) {
    const session = path.join(sessions, name);
    for (const turn of await fs.readdir(session).catch(() => [])) if (/^turn-\d+$/.test(turn)) {
      const result = await readJson(path.join(session, turn, 'result.json'), null);
      if (result) receipts.push(result);
    }
  }
  return receipts;
}
function decorateWindow(window, reading, config, now) {
  const source = window.source || reading.source, observedAt = window.readAt || reading.observedAt || reading.readAt;
  const ageSeconds = Math.max(0, (now - Date.parse(observedAt)) / 1000);
  const maxAge = (source === 'supplied' ? config.usage.suppliedMaxAgeMinutes : config.usage.sourceMaxAgeMinutes) * 60;
  return { ...window, source, readAt: observedAt, ageSeconds, stale: !Number.isFinite(ageSeconds) || ageSeconds > maxAge, expired: Number.isFinite(Date.parse(window.resetsAt)) && now >= Date.parse(window.resetsAt) };
}
function costGauge(rows, now) {
  const sum = ms => {
    const recent = rows.filter(r => now - Date.parse(r.endedAt) <= ms && now >= Date.parse(r.endedAt));
    const reported = recent.filter(r => Number.isFinite(r.costUsd));
    return { totalUsd: reported.length ? Number(reported.reduce((n, r) => n + r.costUsd, 0).toFixed(10)) : null, reportedTurns: reported.length, unreportedTurns: recent.length - reported.length };
  };
  return { last5Hours: sum(5 * 3600000), last7Days: sum(7 * 86400000), source: 'reported roster turn cost only; missing/partial costs are unknown' };
}
export async function usage(root, config, { refresh = false, now = Date.now(), sourceOptions = {} } = {}) {
  const receipts = await turnReceipts(root), base = path.join(stateDirectory(root), 'usage');
  let external = [];
  if (config.usage.externalCommand) {
    const file = path.join(base, 'external.cache.json');
    let cached = await readJson(file, null);
    if (refresh || !cached || now - Date.parse(cached.readAt) > config.usage.cacheSeconds * 1000 || JSON.stringify(cached.command) !== JSON.stringify(config.usage.externalCommand)) {
      try { cached = { command: config.usage.externalCommand, readAt: new Date(now).toISOString(), readings: await readExternalUsage(config.usage.externalCommand, { now, timeoutMs: config.usage.externalTimeoutMs }) }; }
      catch { cached = { command: config.usage.externalCommand, readAt: new Date(now).toISOString(), readings: [], error: 'External usage command unavailable; using built-in sources.' }; }
      await writeJson(file, cached);
    }
    external = cached.readings;
  }
  return Promise.all(providerNames.map(async provider => {
    const manual = await readJson(path.join(base, `${provider}.supplied.json`), null), cacheFile = path.join(base, `${provider}.cache.json`);
    let automatic = external.find(r => r.provider === provider && !r.unknown) || await readJson(cacheFile, null);
    if (refresh || !automatic?.groups || automatic.source === 'external command' && !external.some(r => r.provider === provider && !r.unknown) || now - Date.parse(automatic.readAt) > config.usage.cacheSeconds * 1000) {
      const fromExternal = external.find(r => r.provider === provider && !r.unknown);
      if (fromExternal) automatic = fromExternal;
      else {
        try {
          const binary = await findBinary(provider, config.providers[provider].binary);
          automatic = { ...await adapters[provider].readUsage({ binary, now, maxAgeMinutes: config.usage.sourceMaxAgeMinutes, ...sourceOptions[provider] }), readAt: new Date(now).toISOString() };
        } catch { automatic = { unknown: true, reason: 'Allowance source unavailable.', readAt: new Date(now).toISOString() }; }
      }
      automatic.groups = groupsOf(automatic, provider); delete automatic.windows;
      await writeJson(cacheFile, automatic);
    }
    const autoGroups = groupsOf(automatic, provider), manualGroups = manual ? groupsOf(manual, provider) : [];
    const ids = new Set([...autoGroups, ...manualGroups].map(g => g.id));
    if (provider === 'agy') { ids.add('gemini'); ids.add('third-party'); }
    const runs = receipts.filter(r => r.provider === provider).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
    const sum = (rows, ms) => rows.filter(r => now - Date.parse(r.endedAt) <= ms && now >= Date.parse(r.endedAt)).reduce((n, r) => n + (r.tokens?.total || 0), 0);
    const groups = [...ids].map(id => {
      const auto = autoGroups.find(g => g.id === id), supplied = manualGroups.find(g => g.id === id);
      const byLabel = new Map((auto?.windows || []).map(w => [w.label, decorateWindow(w, automatic, config, now)]));
      for (const w of supplied?.windows || []) {
        const replacement = decorateWindow({ ...w, source: 'supplied' }, manual, config, now), old = byLabel.get(w.label);
        if (!old || Date.parse(replacement.readAt) >= Date.parse(old.readAt)) byLabel.set(w.label, replacement);
      }
      const windows = [...byLabel.values()];
      const groupRuns = runs.filter(r => !r.group && !r.model || (r.group || groupForModel(provider, r.model)) === id);
      const lastLimit = groupRuns.find(r => r.limited);
      const recovered = lastLimit && (Date.parse(lastLimit.limitResetsAt) <= now || groupRuns.some(r => r.state === 'done' && Date.parse(r.endedAt) > Date.parse(lastLimit.endedAt)) || (supplied?.windows || []).some(w => Date.parse(w.readAt || manual.readAt) > Date.parse(lastLimit.endedAt) && w.usedPercent < config.usage.ceiling && Date.parse(w.resetsAt) > now));
      const learnedLimited = !!lastLimit && !recovered;
      const limited = learnedLimited || !!auto?.limited || !!automatic.limited;
      const groupCost = provider === 'grok' ? { costGauge: costGauge(groupRuns, now) } : {};
      return { ...groupCost, id, name: auto?.name || supplied?.name || (id === 'third-party' ? 'Claude and GPT models' : 'All models'), windows, unknown: !windows.length, ...(!windows.length ? { reason: auto?.reason || automatic.reason || 'No reading for this model group.' } : {}), stale: windows.some(w => w.stale || w.expired), limited, ...(learnedLimited ? { limitedSince: lastLimit.endedAt, lastMessage: lastLimit.limitMessage, limitResetsAt: lastLimit.limitResetsAt || null } : limited ? { limitedSince: automatic.limitedSince, lastMessage: automatic.lastMessage, limitResetsAt: automatic.limitResetsAt } : {}), tokenGauge: { last5Hours: sum(groupRuns, 5 * 3600000), last7Days: sum(groupRuns, 7 * 86400000) } };
    });
    const windows = groups.flatMap(g => g.windows);
    return { ...(provider === 'grok' ? { costGauge: costGauge(runs, now) } : {}), provider, groups, unknown: groups.every(g => g.unknown), plan: manual?.plan || automatic.plan || null, credits: automatic.credits, source: [...new Set(windows.map(w => w.source))].join(' + ') || automatic.source || 'unknown', readAt: automatic.readAt, ageSeconds: windows.length ? Math.max(...windows.map(w => w.ageSeconds)) : Math.max(0, (now - Date.parse(automatic.readAt)) / 1000), stale: groups.some(g => g.stale), limited: groups.every(g => g.limited), fallbackReason: automatic.fallbackReason, tokenGauge: { last5Hours: sum(runs, 5 * 3600000), last7Days: sum(runs, 7 * 86400000), source: 'local roster turns only; tokens are not subscription percentages' } };
  }));
}
