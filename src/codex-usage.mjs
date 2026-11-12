import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
