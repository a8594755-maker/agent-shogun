import { groupForModel, familyForModel, groupsOf, validateAllowance } from './allowance.mjs';
import { resolveModelEffort } from './model-selection.mjs';

function appliesToModel(window, model) {
  if (typeof window.label!=='string'||!window.label.startsWith('weekly:')) return true;
  const wanted = window.label.slice(7).toLowerCase().replace(/^claude-/, ''), actual = model.toLowerCase().replace(/^claude-/, '');
  return actual === wanted || actual.startsWith(wanted + '-') || wanted.startsWith(actual + '-');
}

export function pick(config, kind, installed, readings, notFamily, catalogInfo) {
  const canonical = kind === 'mechanical' ? 'tests' : kind;
  const user = config.userKinds ?? config.kinds ?? {};
  const ruleKey = Object.hasOwn(user, canonical) ? canonical : Object.hasOwn(user, kind) ? kind : canonical === 'tests' && Object.hasOwn(user, 'mechanical') ? 'mechanical' : null;
  const override = ruleKey === null ? undefined : user[ruleKey];
  const allocation=catalogInfo?.catalog?.allocation;
  const fromCatalog = allocation&&Object.hasOwn(allocation,canonical)?allocation[canonical]:undefined;
  const fallback = installed.filter(p => p.installed && p.authState === 'signed in').flatMap(p => {
    const preset = { provider: p.provider, model: config.providers[p.provider].model, effort: config.providers[p.provider].effort };
    const choices = !p.modelsListed||p.models.includes(preset.model)?[preset]:[];
    const seen = new Set(choices.map(c=>groupForModel(c.provider,c.model)));
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
  for (const configured of ordered) {
    let choice;
    try { choice={...configured,...resolveModelEffort(configured.provider,configured.model,configured.effort,{catalog:catalogInfo?.catalog,defaultEffort:config.providers[configured.provider].effort})}; }
    catch(e){ rejected.push({...configured,reason:e.message}); continue; }
    const r = validateAllowance(readings.find(x => x.provider === choice.provider) || { unknown: true, windows: [] },choice.provider);
    const groupId = groupForModel(choice.provider, choice.model), family = familyForModel(choice.provider, choice.model);
    const group = groupsOf(r, choice.provider).find(g => g.id === groupId);
    const windows = (group?.windows || []).filter(w => Date.parse(w.resetsAt)>Date.now() && appliesToModel(w, choice.model));
    const tightest = windows.length ? Math.max(...windows.map(w => w.usedPercent)) : null;
    let reason;
    if (choice.provider === notFamily || family === notFamily) reason = 'excluded family';
    else if (!installed.find(p => p.provider === choice.provider)?.installed) reason = 'not installed';
    else if (installed.find(p => p.provider === choice.provider)?.authState !== 'signed in') reason = installed.find(p => p.provider === choice.provider)?.authState === 'not signed in' ? 'not signed in' : 'sign-in state unknown';
    else if (installed.find(p=>p.provider===choice.provider)?.modelsListed && !installed.find(p=>p.provider===choice.provider).models.includes(choice.model)) reason='model not offered by installed CLI';
    else if (group?.limited || r.limited) reason = 'limited';
    else if (tightest !== null && tightest >= config.usage.ceiling) reason = `at or above ${config.usage.ceiling}% ceiling`;
    if (reason) rejected.push({ provider: choice.provider, model: choice.model, group: groupId, family, reason, tightest });
    else candidates.push({ ...choice, group: groupId, family, tightest, unknown: tightest === null, ...(tightest===null?{unknownReason:r.reason||group?.reason||'no current reading'}:{}), stale: !!(group?.stale ?? r.stale), windows });
  }
  if (!candidates.length) return { selected: null, reason: `No eligible provider${override ? ` under project rule for ${kind}` : ` for ${kind}`}. ${rejected.map(r => `${r.provider}/${r.model}: ${r.reason}`).join('; ')}`, candidates, rejected, warnings, allocationSource };
  let selected = candidates[0];
  const known = candidates.filter(c => c.tightest !== null);
  const least = known.reduce((best, c) => !best || c.tightest < best.tightest ? c : best, null);
  const leaderUnknown=selected.tightest===null;
  if (allocationSource === 'most allowance left' && least || !override&&leaderUnknown&&least || selected.tightest !== null && least && selected.tightest - least.tightest > config.usage.balancePoints) selected = least;
  const explanation=leaderUnknown?selected===candidates[0]?'first choice allowance unknown; '+(override?'project rule retained':'no known candidate with room'):'first choice allowance unknown; prefer known allowance':selected===candidates[0]?'first eligible choice':allocationSource==='most allowance left'?'least-used known allowance':`usage gap exceeds ${config.usage.balancePoints} points`;
  return { selected, reason: `${selected.provider}/${selected.model} effort=${selected.effort}: ${allocationSource}; ${explanation}; ${candidates.map(c => `${c.provider}/${c.model}[${c.group || 'unmapped'}]=${c.tightest === null ? 'unknown' : `${c.tightest}%`}${c.stale ? ' (stale)' : ''}`).join(', ')}.`, candidates, rejected, warnings, allocationSource };
}
