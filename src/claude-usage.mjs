import os from 'node:os';
import path from 'node:path';
import { readJson } from './io.mjs';
import { windowReading, isoSeconds, validateAllowance, invalidAllowance, AllowanceError } from './allowance.mjs';
import { rosterHome } from './state.mjs';

export async function readClaudeUsage({ cacheFile = path.join(rosterHome(), 'claude-usage.json') } = {}) {
  try {
    const cache = await readJson(cacheFile, null);
    if(cache?.invalid)throw new AllowanceError('status-line hook rejected an invalid allowance payload');
    if (!cache || !Number.isFinite(Date.parse(cache.readAt))) return { unknown: true, reason: 'No Claude status-line cache; install the optional hook or use usage set.', source: 'Claude status-line cache' };
    const windows = [['five_hour', '5-hour', 300], ['seven_day', 'weekly', 10080]].flatMap(([key, label, minutes]) => {
      const value = cache.rate_limits?.[key];
      const w = value && windowReading(label, minutes, value.used_percentage, isoSeconds(value.resets_at));
      if(value && !w)throw new AllowanceError('invalid Claude status-line window');
      return w ? [w] : [];
    });
    if (!windows.length) throw new Error('No valid windows');
    return validateAllowance({ groups: [{ id: 'default', name: 'All models', windows }], plan: null, source: 'Claude status-line cache', readAt: new Date().toISOString(), observedAt: cache.readAt },'claude');
  } catch(e) { return invalidAllowance(e instanceof AllowanceError?e.message:'Claude status-line cache is corrupt or invalid',{source:'Claude status-line cache'}); }
}
