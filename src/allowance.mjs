export const isoSeconds = value => Number.isFinite(value) && Math.abs(value) < 8.64e12 ? new Date(value * 1000).toISOString() : null;
export const minutesLabel = minutes => minutes === 300 ? '5-hour' : minutes === 10080 ? 'weekly' : `${minutes}-minute`;
export function windowReading(label, minutes, usedPercent, resetsAt, extra = {}) {
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  return { label, minutes, usedPercent: Math.round(usedPercent * 10000) / 10000, resetsAt: Number.isFinite(Date.parse(resetsAt)) ? new Date(resetsAt).toISOString() : null, ...extra };
}
// Legacy v0.1 cache files are accepted, but all new output uses groups -> windows.
export function groupsOf(reading = {}, provider) {
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
