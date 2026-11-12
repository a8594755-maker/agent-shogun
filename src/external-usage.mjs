import { findBinary } from './binaries.mjs';
import { exec } from './io.mjs';
import { providerNames } from './config.mjs';
import { windowReading, minutesLabel, isoSeconds, validateAllowance, invalidAllowance, AllowanceError } from './allowance.mjs';

export function mapExternalUsage(payload, now = Date.now()) {
  if(!payload||typeof payload!=='object')return providerNames.map(provider=>({provider,...invalidAllowance('external source must return provider rows',{source:'external command',readAt:new Date(now).toISOString()})}));
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload.providers) ? payload.providers : [payload];
  const readings = [];
  for (const row of rows) {
    const provider = row?.provider === 'antigravity' ? 'agy' : row?.provider;
    if (!providerNames.includes(provider)) continue;
    try{
    // Copy only allowance fields, excluding opaque account and identity data.
    const data = row.usage || row;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new AllowanceError('invalid external provider data');
    const normalize = (w, label, defaultMinutes) => {
      if (!w || w.is_informational === true || w.isInformational === true) return null;
      const minutes = w.minutes ?? w.windowMinutes ?? w.window_minutes ?? defaultMinutes;
      const rawReset = w.resetsAt ?? w.resets_at;
      const resets = typeof rawReset === 'number' ? isoSeconds(rawReset) : rawReset;
      const value=windowReading(Object.hasOwn(w,'label')?w.label:(minutes ? minutesLabel(minutes) : label), minutes, w.usedPercent ?? w.used_percent, resets);
      if(!value)throw new AllowanceError('invalid external allowance window');return value;
    };
    const rawGroups = row.groups || data.groups;
    if(rawGroups!==undefined&&!Array.isArray(rawGroups)||data.windows!==undefined&&!Array.isArray(data.windows))throw new AllowanceError('external groups/windows must be arrays');
    if(Array.isArray(data.windows)&&data.windows.some(w=>!w))throw new AllowanceError('invalid external window');
    const groups = Array.isArray(rawGroups) ? rawGroups.map(group => ({ id: group.id, name: group.name || group.id, windows: group.windows.map(w => normalize(w, w?.label, w?.minutes)).filter(Boolean) })) : [{ id: provider === 'agy' ? 'gemini' : 'default', name: provider === 'agy' ? 'Gemini Models' : 'All models', windows: Array.isArray(data.windows) ? data.windows.map(w => normalize(w, w?.label, w?.minutes)).filter(Boolean) : [normalize(data.primary, 'primary', null), normalize(data.secondary, 'weekly', 10080), normalize(data.tertiary, 'tertiary', null)].filter(Boolean) }];
    const valid = groups.filter(g => typeof g.id === 'string' && g.windows.length);
    const observed = data.updatedAt || data.updated_at || row.observedAt || row.readAt;
    readings.push(validateAllowance({ provider, groups, plan: data.plan || data.login_method || data.identity?.plan || row.plan || null, source: 'external command', readAt: new Date(now).toISOString(), observedAt: Number.isFinite(Date.parse(observed)) ? new Date(observed).toISOString() : new Date(now).toISOString(), ...(!valid.length || row.error ? { unknown: true, reason: 'External source has no usable allowance windows.' } : {}) },provider));
    }catch(e){readings.push({provider,...invalidAllowance(e.message,{source:'external command',readAt:new Date(now).toISOString()})});}
  }
  for (const provider of providerNames) if (readings.filter(r => r.provider === provider).length > 1) {
    for (let i = readings.length - 1; i >= 0; i--) if (readings[i].provider === provider) readings.splice(i, 1);
    readings.push({ provider, ...invalidAllowance('External source returned multiple accounts; select one in the external command.',{source:'external command',readAt:new Date(now).toISOString()}) });
  }
  return readings;
}
export async function readExternalUsage(command, { now = Date.now(), timeoutMs = 15000 } = {}) {
  const [name, ...args] = command;
  const binary = await findBinary(name, /[\\/]/.test(name) ? name : undefined);
  if (!binary) throw new Error('External usage executable is not installed.');
  const { stdout } = await exec(binary.file, [...binary.args, ...args], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  try{return mapExternalUsage(JSON.parse(stdout), now);}catch{return mapExternalUsage(null,now);}
}
