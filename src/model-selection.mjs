import { loadCatalog } from './catalog.mjs';
const levels = /^(.*)-(none|minimal|low|medium|high|xhigh|max)$/;
export function resolveModelEffort(provider, model, effort, {defaultEffort, catalog, explicitEffort = effort !== undefined} = {}) {
  if (provider === 'agy') {
    const embedded = levels.exec(model);
    if (embedded) {
      if (explicitEffort && effort !== embedded[2]) throw new Error(`Model ${model} carries effort ${embedded[2]}; conflicting effort ${effort}.`);
      effort = embedded[2];
    } else {
      effort ||= defaultEffort;
      const variant = `${model}-${effort}`;
      if (catalog?.providers?.agy?.models.some(m=>m.id===variant)) model=variant;
    }
  }
  effort ||= defaultEffort;
  const models=catalog?.providers?.[provider]?.models || [];
  const known = models.find(m=>m.id===model) || (provider==='claude'&&['fable','opus','sonnet','haiku'].includes(model)?models.find(m=>m.id.startsWith(`claude-${model}-`)):undefined);
  if (known?.efforts.length && !explicitEffort && !known.efforts.includes(effort)) effort=known.efforts[0];
  if (known?.efforts.length && !known.efforts.includes(effort)) throw new Error(`${provider}/${model} does not support effort ${effort}; catalog: ${known.efforts.join(', ')}.`);
  return {model, effort};
}
export async function sessionSelection(root, config, provider, model, effort) {
  const {catalog}=await loadCatalog(root,config);
  return resolveModelEffort(provider,model,effort,{catalog,defaultEffort:config.providers[provider].effort,explicitEffort:effort!==undefined});
}
