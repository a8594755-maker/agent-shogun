import { groupForModel, familyForModel, groupsOf } from './allowance.mjs';

function appliesToModel(window, model) {
  if (!window.label?.startsWith('weekly:')) return true;
  const wanted = window.label.slice(7).toLowerCase().replace(/^claude-/, ''), actual = model.toLowerCase().replace(/^claude-/, '');
  return actual === wanted || actual.startsWith(wanted + '-') || wanted.startsWith(actual + '-');
}

export function pick(config, kind, installed, readings, notFamily, catalogInfo) {
  const canonical = kind === 'mechanical' ? 'tests' : kind;
  const user = config.userKinds ?? config.kinds ?? {};
  const ruleKey = Object.hasOwn(user, canonical) ? canonical : Object.hasOwn(user, kind) ? kind : canonical === 'tests' && Object.hasOwn(user, 'mechanical') ? 'mechanical' : null;
  const override = ruleKey === null ? undefined : user[ruleKey];
  const fromCatalog = catalogInfo?.catalog?.allocation[canonical];
  const fallback = installed.filter(p => p.installed && p.authState === 'signed in').flatMap(p => {
    const preset = { provider: p.provider, model: config.providers[p.provider].model, effort: config.providers[p.provider].effort }, choices = [preset];
    const seen = new Set([groupForModel(p.provider, preset.model)]);
    const models = [...(catalogInfo?.catalog?.providers?.[p.provider]?.models || [])].sort((a,b)=>a.relativeAllowanceCost-b.relativeAllowanceCost);
    for (const model of models) {
      const group = groupForModel(p.provider, model.id);
      if (!group || seen.has(group) || p.modelsListed && !p.models.includes(model.id)) continue;
      seen.add(group); choices.push({provider:p.provider, model:model.id, effort:model.efforts.includes(preset.effort)?preset.effort:model.efforts[0]||preset.effort});
    }
    return choices;
  });
  const ordered = override || fromCatalog || fallback;
  const allocationSource = override ? 'project rule' : fromCatalog ? 'skill catalog' : 'most allowance left';
  const warnings = [...new Set([...(catalogInfo?.status.stale ? [catalogInfo.status.line] : []), ...installed.flatMap(p => p.catalogWarnings || [])])];
  const rejected = [], candidates = [];
  for (const choice of ordered) {
    const r = readings.find(x => x.provider === choice.provider) || { unknown: true, windows: [] };
    const groupId = groupForModel(choice.provider, choice.model), family = familyForModel(choice.provider, choice.model);
    const group = groupsOf(r, choice.provider).find(g => g.id === groupId);
    const windows = (group?.windows || []).filter(w => !w.expired && appliesToModel(w, choice.model));
    const tightest = windows.length ? Math.max(...windows.map(w => w.usedPercent)) : null;
    let reason;
    if (choice.provider === notFamily || family === notFamily) reason = 'excluded family';
    else if (!installed.find(p => p.provider === choice.provider)?.installed) reason = 'not installed';
    else if (installed.find(p => p.provider === choice.provider)?.authState !== 'signed in') reason = installed.find(p => p.provider === choice.provider)?.authState === 'not signed in' ? 'not signed in' : 'sign-in state unknown';
    else if (group?.limited || r.limited) reason = 'limited';
    else if (tightest !== null && tightest >= config.usage.ceiling) reason = `at or above ${config.usage.ceiling}% ceiling`;
    if (reason) rejected.push({ provider: choice.provider, model: choice.model, group: groupId, family, reason, tightest });
    else candidates.push({ ...choice, group: groupId, family, tightest, unknown: tightest === null, stale: !!(group?.stale ?? r.stale), windows });
  }
  if (!candidates.length) return { selected: null, reason: `No eligible provider${override ? ` under project rule for ${kind}` : ` for ${kind}`}. ${rejected.map(r => `${r.provider}/${r.model}: ${r.reason}`).join('; ')}`, candidates, rejected, warnings, allocationSource };
  let selected = candidates[0];
  const known = candidates.filter(c => c.tightest !== null);
  const least = known.reduce((best, c) => !best || c.tightest < best.tightest ? c : best, null);
  if (allocationSource === 'most allowance left' && least || selected.tightest !== null && least && selected.tightest - least.tightest > config.usage.balancePoints) selected = least;
  return { selected, reason: `${selected.provider}/${selected.model} effort=${selected.effort}: ${allocationSource}; ${selected === candidates[0] ? 'first eligible choice' : allocationSource === 'most allowance left' ? 'least-used known allowance' : `usage gap exceeds ${config.usage.balancePoints} points`}; ${candidates.map(c => `${c.provider}/${c.model}[${c.group || 'unmapped'}]=${c.tightest === null ? 'unknown' : `${c.tightest}%`}${c.stale ? ' (stale)' : ''}`).join(', ')}.`, candidates, rejected, warnings, allocationSource };
}
