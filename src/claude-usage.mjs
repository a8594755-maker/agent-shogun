import os from 'node:os';
import path from 'node:path';
import { readJson } from './io.mjs';
import { windowReading, isoSeconds } from './allowance.mjs';
import { rosterHome } from './state.mjs';

export async function readClaudeUsage({ cacheFile = path.join(rosterHome(), 'claude-usage.json') } = {}) {
  try {
    const cache = await readJson(cacheFile, null);
    if (!cache || !Number.isFinite(Date.parse(cache.readAt))) return { unknown: true, reason: 'No Claude status-line cache; install the optional hook or use usage set.', source: 'Claude status-line cache' };
    const windows = [['five_hour', '5-hour', 300], ['seven_day', 'weekly', 10080]].flatMap(([key, label, minutes]) => {
      const value = cache.rate_limits?.[key];
      const w = value && windowReading(label, minutes, value.used_percentage, isoSeconds(value.resets_at));
      return w ? [w] : [];
    });
    if (!windows.length) throw new Error('No valid windows');
    return { groups: [{ id: 'default', name: 'All models', windows }], plan: null, source: 'Claude status-line cache', readAt: new Date().toISOString(), observedAt: cache.readAt };
  } catch { return { unknown: true, reason: 'Claude status-line cache is unavailable or invalid.', source: 'Claude status-line cache' }; }
}
