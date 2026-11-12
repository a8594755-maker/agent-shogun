import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readRateLimits } from './codex-rpc.mjs';
import { groupsOf, windowReading, minutesLabel, isoSeconds } from './allowance.mjs';

// Reverse chunks keep memory bounded even for multi-gigabyte session logs.
export async function* reverseLines(file, chunkSize = 64 * 1024, maxLine = 4 * 1024 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    let pos = (await handle.stat()).size, carry = Buffer.alloc(0), skipping = false;
    while (pos > 0) {
      const size = Math.min(pos, chunkSize); pos -= size;
      const chunk = Buffer.alloc(size);
      const { bytesRead } = await handle.read(chunk, 0, size, pos);
      const data = Buffer.concat([chunk.subarray(0, bytesRead), carry]);
      let end = data.length;
      for (let i = data.length - 1; i >= 0; i--) if (data[i] === 10) {
        if (!skipping && end - i - 1 <= maxLine) yield data.subarray(i + 1, end).toString('utf8').trim();
        skipping = false; end = i;
      }
      carry = data.subarray(0, end);
      if (carry.length > maxLine || skipping) { carry = Buffer.alloc(0); skipping = true; }
    }
    if (!skipping && carry.length) yield carry.toString('utf8').trim();
  } finally { await handle.close(); }
}
async function rolloutFiles(dir, files = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(e => { if (['ENOENT', 'EACCES'].includes(e.code)) return []; throw e; })) {
    if (entry.isSymbolicLink() || /auth|token|credential|cookie|key/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await rolloutFiles(file, files);
    else if (/^rollout-.*\.jsonl$/.test(entry.name)) files.push({ file, mtime: (await fs.stat(file)).mtimeMs });
  }
  return files;
}
function rateLimits(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  if (value.rate_limits && typeof value.rate_limits === 'object') return value.rate_limits;
  for (const key of ['payload', 'info', 'data']) { const r = rateLimits(value[key], depth + 1); if (r) return r; }
  return null;
}
export async function readCodexUsage({ sessionsDir = path.join(os.homedir(), '.codex', 'sessions') } = {}) {
  const files = (await rolloutFiles(sessionsDir)).sort((a, b) => b.mtime - a.mtime);
  for (const { file, mtime } of files) {
    try {
      for await (const line of reverseLines(file)) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        const limits = rateLimits(e);
        if (!limits || (limits.limit_id && limits.limit_id !== 'codex')) continue;
        const windows = ['primary', 'secondary'].flatMap(label => {
          const w = limits[label];
          if (!w || !Number.isFinite(w.used_percent) || !Number.isFinite(w.window_minutes)) return [];
          return [{ label: w.window_minutes === 300 ? '5-hour' : w.window_minutes === 10080 ? 'weekly' : label, minutes: w.window_minutes, usedPercent: w.used_percent, resetsAt: Number.isFinite(w.resets_at) ? new Date(w.resets_at * 1000).toISOString() : null }];
        });
        if (!windows.length) continue;
        const timestamp = e.timestamp || e.payload?.timestamp;
        return { windows, plan: limits.plan_type || null, credits: limits.credits, source: 'Codex session log rate_limits', readAt: new Date().toISOString(), observedAt: Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date(mtime).toISOString() };
      }
    } catch (e) { if (!['ENOENT', 'EACCES'].includes(e.code)) throw e; }
  }
  return { unknown: true, reason: 'No rate_limits reading found in Codex session logs.', source: 'Codex session logs', readAt: new Date().toISOString() };
}
// The adapter has one reader; the local log remains the preferred source.
export async function readCodexAllowance({ binary, now = Date.now(), maxAgeMinutes = 30, timeoutMs, ...options } = {}) {
  const local = await readCodexUsage(options);
  const grouped = { ...local, groups: groupsOf(local, 'codex') }; delete grouped.windows;
  if (!local.unknown && now - Date.parse(local.observedAt || local.readAt) <= maxAgeMinutes * 60000) return grouped;
  if (!binary) return { ...grouped, fallbackReason: 'Codex app-server binary unavailable.' };
  try {
    const result = await readRateLimits(binary, { timeoutMs });
    const limits = result.rateLimitsByLimitId?.codex || result.rateLimits;
    if (!limits) throw new Error('Missing rate limits');
    const windows = [limits.primary, limits.secondary].flatMap(w => {
      if (!w || !Number.isFinite(w.windowDurationMins)) return [];
      const value = windowReading(minutesLabel(w.windowDurationMins), w.windowDurationMins, w.usedPercent, isoSeconds(w.resetsAt));
      return value ? [value] : [];
    });
    if (!windows.length) throw new Error('No valid windows');
    return { groups: [{ id: 'default', name: 'All models', windows }], plan: limits.planType || null, credits: limits.credits ? { balance: limits.credits.balance, hasCredits: limits.credits.hasCredits, unlimited: limits.credits.unlimited } : undefined, source: 'Codex app-server account/rateLimits/read', readAt: new Date(now).toISOString(), observedAt: new Date(now).toISOString() };
  } catch { return { ...grouped, fallbackReason: 'Codex app-server usage unavailable; retained the local reading.' }; }
}
