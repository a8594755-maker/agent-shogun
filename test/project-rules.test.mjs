import './isolation.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults, loadConfig } from '../src/config.mjs';
import { pick } from '../src/pick.mjs';
import { catalogBlock, loadCatalog } from '../src/catalog.mjs';
import { adapters } from '../src/adapters/index.mjs';
import { grokSafeAllows } from '../src/adapters/grok.mjs';
import { exec, readJson } from '../src/io.mjs';
import { scratch, project, cli } from './helpers.mjs';

const choice = provider => ({ provider, model: defaults.providers[provider].model, effort: defaults.providers[provider].effort });
const installed = ['codex','agy','claude','grok'].map(provider=>({provider,installed:true,authState:'signed in'}));
const reading = (provider, used) => ({provider,groups:[{id:provider==='agy'?'gemini':'default',windows:[{label:'weekly',usedPercent:used}]}]});
test('generic defaults and shipped example contain no per-kind project policy', async()=>{
  assert.equal(Object.hasOwn(defaults,'kinds'),false);
  assert.equal(Object.hasOwn(await readJson(path.join(project,'roster.config.json')),'kinds'),false);
});
test('no project rule follows catalog allocation; no catalog entry uses most known allowance',()=>{
  const info={catalog:{allocation:{ui:[choice('claude'),choice('codex')]}},status:{stale:false}};
  assert.equal(pick(defaults,'ui',installed,[reading('claude',20),reading('codex',15)],undefined,info).selected.provider,'claude');
  const p=pick(defaults,'custom-kind',installed,[reading('codex',70),reading('agy',10),reading('claude',30)],undefined,info);
  assert.equal(p.selected.provider,'agy'); assert.equal(p.allocationSource,'most allowance left');
});
test('project list replaces the catalog and a full/signed-out rule never escapes to another provider',()=>{
  const config={...defaults,kinds:{ui:[choice('claude')]}}, info={catalog:{allocation:{ui:[choice('codex')]}},status:{stale:false}};
  const p=pick(config,'ui',installed,[reading('claude',20),reading('codex',0)],undefined,info);
  assert.equal(p.candidates.length,1); assert.equal(p.selected.provider,'claude'); assert.match(p.reason,/project rule/);
  const blocked=pick(config,'ui',installed,[reading('claude',95),reading('codex',0)],undefined,info);
  assert.equal(blocked.selected,null); assert.match(blocked.reason,/No eligible provider under project rule/);
  const out=pick(config,'ui',installed.map(p=>({...p,authState:p.provider==='claude'?'not signed in':'signed in'})),[],undefined,info);
  assert.equal(out.selected,null);
  assert.equal(pick({...defaults,kinds:{ui:[]}},'ui',installed,[],undefined,info).selected,null);
});
test('allowance fallback can choose another model group through the same CLI',()=>{
  const info={catalog:{allocation:{},providers:{agy:{models:[{id:'claude-example',efforts:['low'],relativeAllowanceCost:1}]}}},status:{stale:false}};
  const readings=[reading('codex',20),{provider:'agy',groups:[{id:'gemini',windows:[{label:'weekly',usedPercent:95}]},{id:'third-party',windows:[{label:'weekly',usedPercent:0}]}]}];
  const result=pick(defaults,'new-kind',installed,readings,undefined,info); assert.equal(result.selected.provider,'agy'); assert.equal(result.selected.group,'third-party');
});
test('nearest config wins while walking from cwd to repo root and unknown keys are tolerated',async t=>{
  const s=await scratch(t), nested=path.join(s.root,'nested'), deep=path.join(nested,'deeper'); await fs.mkdir(deep,{recursive:true});
  s.config.kinds={ui:[choice('codex')]}; await fs.writeFile(path.join(s.root,'roster.config.json'),JSON.stringify(s.config));
  await fs.writeFile(path.join(nested,'roster.config.json'),JSON.stringify({_comment:'Project-only rule',kinds:{ui:[choice('claude')]}}));
  const config=await loadConfig(s.root,{cwd:deep}); assert.equal(config.userKinds.ui[0].provider,'claude'); assert.equal(config._comment,'Project-only rule');
  assert.equal((await loadConfig(s.root)).userKinds.ui[0].provider,'codex');
});
test('explicit config overrides discovery before or after command and blocked rules exit nonzero',async t=>{
  const s=await scratch(t), file=path.join(s.parent,'explicit config.json');
  await fs.writeFile(file,JSON.stringify({providers:s.config.providers,_comment:'Kept outside shared skill',kinds:{custom:[choice('claude')]}}));
  const a=await s.run('pick','--kind','custom','--config',file); assert.equal(a.selected.provider,'claude'); assert.match(a.reason,/project rule/);
  const b=await exec(process.execPath,[cli,'--config',file,'pick','--kind','custom','--json'],{cwd:s.root,env:s.env}); assert.equal(JSON.parse(b.stdout).selected.provider,'claude');
  await s.run('usage','set','claude','--window','weekly','--used','99','--resets','2099-01-01T00:00:00Z');
  const blocked=await s.fail('pick','--kind','custom','--config',file); assert.equal(blocked.selected,null); assert.match(blocked.reason,/project rule/);
});
test('generated catalog groups effort variants and stays near forty lines',async t=>{
  const s=await scratch(t), {catalog}=await loadCatalog(s.root,s.config), block=catalogBlock(catalog);
  assert(block.split('\n').length<=44); assert(block.includes('gemini-4-carbon-<effort>')); assert(block.includes('low / medium / high')); assert(block.includes('Allowance group')); assert(block.includes('How to read what is left'));
  assert.equal(block.split('\n').filter(line=>line.startsWith('| agy | `gemini-4-carbon')).length,1);
});
test('Grok guarded rules allow rooted edits/git/project checks without a catch-all Bash grant',async t=>{
  const s=await scratch(t); await fs.writeFile(path.join(s.root,'package.json'),JSON.stringify({scripts:{test:'node --test',typecheck:'tsc',deploy:'deploy'}}));
  const rules=grokSafeAllows(s.root); assert(rules.includes('Edit(./**)')); assert(rules.includes('Write(./**)')); assert(rules.includes('Bash(git add *)')); assert(rules.includes('Bash(git commit *)')); assert(rules.includes('Bash(npm run typecheck)')); assert(!rules.some(r=>r.includes('deploy'))); assert(!rules.includes('Bash'));
});
test('Grok cancelled envelope is failed with the explicit permission hint',async t=>{
  const s=await scratch(t), file=path.join(s.parent,'cancelled.json'); await fs.writeFile(file,JSON.stringify({text:'partial',stopReason:'cancelled',sessionId:'fixture'}));
  const result=await adapters.grok.parse(file); assert.equal(result.ok,false); assert.equal(result.error,'cancelled (permission?)');
});
