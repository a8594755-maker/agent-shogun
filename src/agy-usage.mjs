import { exec } from './io.mjs';
import { windowReading } from './allowance.mjs';

export function parseAgyFailure(stderr, now = Date.now()) {
  for (const line of stderr.split(/\r?\n/)) {
    const match = /AGY_ERROR:\s*(\{.*\})/.exec(line);
    if (!match) continue;
    let error; try { error = JSON.parse(match[1]); } catch { continue; }
    if (error.error_code !== 429 && error.status !== 'RESOURCE_EXHAUSTED') continue;
    const message = typeof error.short_error === 'string' ? error.short_error : 'RESOURCE_EXHAUSTED (429)';
    const duration = /resets in\s+((?:\d+\s*[dhms]\s*)+)/i.exec(message)?.[1];
    const parsedSeconds = duration ? [...duration.matchAll(/(\d+)\s*([dhms])/gi)].reduce((n, m) => n + Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2].toLowerCase()]), 0) : null;
    const seconds = Number.isFinite(parsedSeconds) && parsedSeconds >= 0 && parsedSeconds < 366 * 86400 ? parsedSeconds : null;
    return { limited: true, message, resetsAt: seconds !== null ? new Date(now + seconds * 1000).toISOString() : null };
  }
  return null;
}
export async function readAgyUsage({ binary, now = Date.now(), timeoutMs = 15000 } = {}) {
  if (!binary) return { unknown: true, reason: 'Antigravity is not installed.', source: 'agy /usage' };
  try {
    // Direct spawn/execFile avoids MSYS /usage path conversion. This is a command, not a turn.
    const { stdout } = await exec(binary.file, [...binary.args, '--print', '/usage', '--output-format', 'json'], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    const envelope = JSON.parse(stdout);
    if (envelope.status !== 'SUCCESS' || envelope.command?.name !== 'usage' || !Array.isArray(envelope.command.data?.groups)) throw new Error('Invalid usage envelope');
    const groups = envelope.command.data.groups.map(group => {
      const id = group.name === 'Gemini Models' ? 'gemini' : group.name === 'Claude and GPT models' ? 'third-party' : null;
      if (!id) return null;
      const windows = (group.buckets || []).flatMap(bucket => {
        if (!Number.isFinite(bucket.remaining_fraction) || bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1) return [];
        const minutes = bucket.window === 'weekly' ? 10080 : bucket.window === '5h' ? 300 : null;
        const w = windowReading(bucket.window === '5h' ? '5-hour' : bucket.window, minutes, (1 - bucket.remaining_fraction) * 100, bucket.reset_time, { id: bucket.id });
        return w ? [w] : [];
      });
      return { id, name: group.name, windows, ...(!windows.length ? { unknown: true, reason: 'No valid allowance windows.' } : {}) };
    }).filter(Boolean);
    if (!groups.length) throw new Error('No recognized allowance groups');
    return { groups, plan: null, source: 'agy /usage', readAt: new Date(now).toISOString(), observedAt: new Date(now).toISOString() };
  } catch (e) {
    const failure = parseAgyFailure(e.stderr || '', now);
    return { unknown: true, reason: failure?.message || 'Antigravity usage command unavailable or returned invalid data.', source: 'agy /usage', ...(failure ? { limited: true, limitedSince: new Date(now).toISOString(), lastMessage: failure.message, limitResetsAt: failure.resetsAt } : {}) };
  }
}
