export function pick(config, kind, installed, readings, notFamily) {
  const ordered = config.kinds[kind];
  if (!ordered) throw new Error(`Unknown work kind: ${kind}`);
  const rejected = [], candidates = [];
  for (const choice of ordered) {
    const r = readings.find(x => x.provider === choice.provider) || { unknown: true, windows: [] };
    const windows = (r.windows || []).filter(w => !w.expired);
    const tightest = windows.length ? Math.max(...windows.map(w => w.usedPercent)) : null;
    let reason;
    if (choice.provider === notFamily) reason = 'excluded family';
    else if (!installed.find(p => p.provider === choice.provider)?.installed) reason = 'not installed';
    else if (r.limited) reason = 'limited';
    else if (tightest !== null && tightest >= config.usage.ceiling) reason = `at or above ${config.usage.ceiling}% ceiling`;
    if (reason) rejected.push({ provider: choice.provider, reason, tightest });
    else candidates.push({ ...choice, tightest, unknown: tightest === null, stale: !!r.stale, windows });
  }
  if (!candidates.length) return { selected: null, reason: 'No eligible provider.', candidates, rejected };
  let selected = candidates[0];
  const known = candidates.filter(c => c.tightest !== null);
  const least = known.reduce((best, c) => !best || c.tightest < best.tightest ? c : best, null);
  if (selected.tightest !== null && least && selected.tightest - least.tightest > config.usage.balancePoints) selected = least;
  return { selected, reason: `${selected.provider}/${selected.model} effort=${selected.effort}: ${selected === candidates[0] ? 'configured first eligible choice' : `usage gap exceeds ${config.usage.balancePoints} points`}; ${candidates.map(c => `${c.provider}=${c.tightest === null ? 'unknown' : `${c.tightest}%`}${c.stale ? ' (stale)' : ''}`).join(', ')}.`, candidates, rejected };
}
