import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { providerNames, checkProvider } from './config.mjs';
import { adapters } from './adapters/index.mjs';

export async function setUsage(root, provider, windows, plan) {
  checkProvider(provider);
  const readAt = new Date().toISOString();
  for (const w of windows) {
    if (!w.label || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 || !Number.isFinite(Date.parse(w.resetsAt))) throw new Error('Each window needs a label, used 0–100, and an ISO reset time.');
  }
  if (!windows.length || new Set(windows.map(w => w.label)).size !== windows.length) throw new Error('Supply unique --window readings.');
  const file = path.join(root, '.roster', 'usage', `${provider}.supplied.json`);
  const previous = await readJson(file, {});
  const supplied = { windows: [...(previous.windows || []).filter(old => !windows.some(w => old.label === w.label)), ...windows.map(w => ({ ...w, readAt }))], plan: plan || previous.plan || null, source: 'supplied', readAt };
  await writeJson(file, supplied);
  return { provider, ...supplied };
}
export async function turnReceipts(root) {
  const sessions = path.join(root, '.roster', 'sessions'), receipts = [];
  for (const name of await fs.readdir(sessions).catch(() => [])) {
    const session = path.join(sessions, name);
    for (const turn of await fs.readdir(session).catch(() => [])) if (/^turn-\d+$/.test(turn)) {
      const result = await readJson(path.join(session, turn, 'result.json'), null);
      if (result) receipts.push(result);
    }
  }
  return receipts;
}
export async function usage(root, config, { refresh = false, now = Date.now(), sourceOptions = {} } = {}) {
  const receipts = await turnReceipts(root);
  return Promise.all(providerNames.map(async provider => {
    const base = path.join(root, '.roster', 'usage');
    const manual = await readJson(path.join(base, `${provider}.supplied.json`), null);
    const cacheFile = path.join(base, `${provider}.cache.json`);
    let automatic = await readJson(cacheFile, null);
    if (refresh || !automatic || now - Date.parse(automatic.readAt) > config.usage.cacheSeconds * 1000) {
      try { automatic = { ...await adapters[provider].readUsage(sourceOptions[provider]), readAt: new Date(now).toISOString() }; }
      catch { automatic = { unknown: true, reason: 'Local quota source unavailable.', readAt: new Date(now).toISOString() }; }
      await writeJson(cacheFile, automatic);
    }
    const autoTime = Date.parse(automatic.observedAt || automatic.readAt);
    let reading = manual && (automatic.unknown || Date.parse(manual.readAt) >= autoTime) ? structuredClone(manual) : structuredClone(automatic);
    const maxAge = (reading.source === 'supplied' ? config.usage.suppliedMaxAgeMinutes : config.usage.sourceMaxAgeMinutes) * 60000;
    reading.ageSeconds = Math.max(0, (now - Date.parse(reading.observedAt || reading.readAt)) / 1000);
    reading.stale = reading.ageSeconds * 1000 > maxAge;
    reading.windows = (reading.windows || []).map(w => ({ ...w, stale: reading.stale || now - Date.parse(w.readAt || reading.observedAt || reading.readAt) > maxAge, expired: Number.isFinite(Date.parse(w.resetsAt)) && now >= Date.parse(w.resetsAt) }));
    reading.stale ||= reading.windows.some(w => w.stale || w.expired);
    const runs = receipts.filter(r => r.provider === provider).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
    const lastLimit = runs.find(r => r.limited);
    const recovered = lastLimit && (runs.some(r => r.state === 'done' && Date.parse(r.endedAt) > Date.parse(lastLimit.endedAt)) || manual && Date.parse(manual.readAt) > Date.parse(lastLimit.endedAt) && manual.windows.every(w => w.usedPercent < config.usage.ceiling && Date.parse(w.resetsAt) > now));
    const sum = ms => runs.filter(r => now - Date.parse(r.endedAt) <= ms && now >= Date.parse(r.endedAt)).reduce((n, r) => n + (r.tokens?.total || 0), 0);
    return { provider, ...reading, limited: Boolean(lastLimit && !recovered), ...(lastLimit && !recovered ? { limitedSince: lastLimit.endedAt, lastMessage: lastLimit.limitMessage } : {}), tokenGauge: { last5Hours: sum(5 * 3600000), last7Days: sum(7 * 86400000), source: 'local roster turns only; tokens are not subscription percentages' } };
  }));
}
