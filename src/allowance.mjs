const earliest = Date.parse('2000-01-01T00:00:00Z'), latest = Date.parse('2100-01-01T00:00:00Z');
export const isoSeconds = value => Number.isSafeInteger(value) && value * 1000 >= earliest && value * 1000 < latest ? new Date(value * 1000).toISOString() : null;
export function resetInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value), date = Date.parse(value.slice(0,10));
  if (!Number.isFinite(time) || time < earliest || time >= latest || !Number.isFinite(date) || new Date(date).toISOString().slice(0,10) !== value.slice(0,10)) return null;
  return new Date(time).toISOString();
}
export class AllowanceError extends Error {}
export function invalidAllowance(reason, reading = {}) {
  return {source:reading.source,readAt:reading.readAt,observedAt:reading.observedAt,limited:reading.limited,unknown:true,invalid:true,reason:`Invalid allowance reading: ${reason}`,groups:[]};
}
export const minutesLabel = minutes => minutes === 300 ? '5-hour' : minutes === 10080 ? 'weekly' : `${minutes}-minute`;
export function windowReading(label, minutes, usedPercent, resetsAt, extra = {}) {
  const reset=resetInstant(resetsAt);
  if (typeof label !== 'string' || !label.trim() || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 || !reset || minutes != null && (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 525600)) return null;
  return { ...extra, label:label.trim(), minutes, usedPercent: Math.round(usedPercent * 10000) / 10000, resetsAt: reset };
}
export function validateAllowance(reading, provider) {
  try {
    if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new AllowanceError('expected a provider object');
    if (reading.invalid) return invalidAllowance(reading.reason || 'invalid source', reading);
    for(const key of ['readAt','observedAt'])if(reading[key]!==undefined&&!resetInstant(reading[key]))throw new AllowanceError(`invalid ${key} instant`);
    if (Object.hasOwn(reading,'groups') && !Array.isArray(reading.groups) || Object.hasOwn(reading,'windows') && !Array.isArray(reading.windows)) throw new AllowanceError('groups/windows must be arrays');
    const groups=groupsOf(reading,provider), ids=new Set();
    for (const group of groups) {
      if (!group || typeof group.id !== 'string' || !group.id.trim() || ids.has(group.id) || !Array.isArray(group.windows)) throw new AllowanceError('invalid or duplicate model group');
      ids.add(group.id); const labels=new Set();
      for(const w of group.windows){
        const valid=w&&windowReading(w.label,w.minutes,w.usedPercent,w.resetsAt);
        if(!valid)throw new AllowanceError('window needs a nonempty string label, percent 0–100, and plausible ISO reset instant');
        if(w.readAt!==undefined&&!resetInstant(w.readAt))throw new AllowanceError('invalid window observation time');
        if(labels.has(valid.label))throw new AllowanceError(`duplicate window label ${valid.label}`);labels.add(valid.label);
      }
    }
    if(reading.unknown)return {...reading,groups:groups.map(g=>({...g,windows:[],unknown:true,reason:reading.reason||g.reason}))};
    if(!groups.length || !groups.some(g=>g.windows.length)) throw new AllowanceError('no allowance windows');
    return {...reading,groups:groups.map(g=>({...g,windows:g.windows.map(w=>({...w,...windowReading(w.label,w.minutes,w.usedPercent,w.resetsAt)}))}))};
  } catch(e){return invalidAllowance(e.message,reading||{});}
}
// Legacy v0.1 cache files are accepted, but all new output uses groups -> windows.
export function groupsOf(reading = {}, provider) {
  if (!reading || typeof reading !== 'object') return [];
  if (Array.isArray(reading.groups)) return reading.groups;
  return [{ id: provider === 'agy' ? 'gemini' : 'default', name: provider === 'agy' ? 'Gemini Models' : 'All models', windows: reading.windows || [], ...(reading.unknown ? { unknown: true, reason: reading.reason } : {}) }];
}
export function groupForModel(provider, model = '') {
  if (provider !== 'agy') return 'default';
  return /^gemini-/i.test(model) ? 'gemini' : /^(claude-|gpt-)/i.test(model) ? 'third-party' : null;
}
export function familyForModel(provider, model = '') {
  return provider === 'agy' ? /^claude-/i.test(model) ? 'claude' : /^gpt-/i.test(model) ? 'codex' : 'agy' : provider;
}
