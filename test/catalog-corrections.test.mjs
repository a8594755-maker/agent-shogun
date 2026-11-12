import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {validateCatalog,catalogBlock,modelDrift} from '../src/catalog.mjs';
import {defaultSkillRoot} from '../src/skill-sync.mjs';
import path from 'node:path';
const current=()=>readJson(path.join(defaultSkillRoot,'references','model-catalog.json'));
test('unknown model tier is valid and rendered honestly',async()=>{
  const c=await current(); c.providers.grok.models[0].tier=null;
  assert.equal(validateCatalog(c),c); assert(catalogBlock(c).includes('| unknown |'));
});
test('known excluded inventory does not generate false new-model warnings',async()=>{
  const c=await current(); c.providers.grok.excludedModels=[{id:'fixture-retiring-model',reason:'Known but not recommended'}];
  const p={provider:'grok',installed:true,authState:'signed in',modelsListed:true,models:c.providers.grok.models.map(m=>m.id).concat('fixture-retiring-model')};
  assert.deepEqual(modelDrift(c,[p]).get('grok'),[]);
});
test('an excluded-model record still requires an id and reason',async()=>{
  const c=await current(); c.providers.grok.excludedModels=[{id:'fixture'}]; assert.throws(()=>validateCatalog(c),/excluded-model/);
});
