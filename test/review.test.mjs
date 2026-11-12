import './isolation.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scratch,project} from './helpers.mjs';
import {readCodexUsage} from '../src/codex-usage.mjs';
import {readAgyUsage} from '../src/agy-usage.mjs';
import {isoSeconds} from '../src/allowance.mjs';
import {usage} from '../src/usage.mjs';
import {pick} from '../src/pick.mjs';
import {childEnv} from '../src/guards.mjs';
import {findBinary} from '../src/binaries.mjs';
import {setCatalog,catalogPaths} from '../src/catalog.mjs';
import {defaultSkillRoot,skillFiles} from '../src/skill-sync.mjs';
import {defaults,providerNames} from '../src/config.mjs';
import {exec,writeJson,readJson} from '../src/io.mjs';
const reset='2099-11-18T20:00:00Z';

// Independent review reproductions, inverted to require the corrected behavior.
test('review BLOCKER: invalid Codex percentages/reset epochs become unknown without stealing selection or crashing',async t=>{
  const s=await scratch(t),sessionsDir=path.join(s.parent,'codex-sessions');await fs.mkdir(sessionsDir);
  const file=path.join(sessionsDir,'rollout-bad.jsonl');
  for(const [percent,epoch]of [[-1,4098693600],[101,4098693600],[20,9e12],[20,1794500000000]]){
    await fs.writeFile(file,JSON.stringify({timestamp:'2026-11-12T12:00:00Z',payload:{rate_limits:{limit_id:'codex',primary:{used_percent:percent,window_minutes:300,resets_at:epoch}}}}));
    const reading=await readCodexUsage({sessionsDir});assert.equal(reading.unknown,true);assert.match(reading.reason,/Invalid allowance/);
    const cfg={...defaults,kinds:{server:[{provider:'agy',model:'gemini-3.8-flash-low',effort:'low'},{provider:'codex',model:'gpt-6.1-sol',effort:'low'}]}};
    const chosen=pick(cfg,'server',['agy','codex'].map(provider=>({provider,installed:true,authState:'signed in'})),[{provider:'agy',groups:[{id:'gemini',windows:[{label:'weekly',usedPercent:30,resetsAt:reset}]}]},{provider:'codex',...reading}]);
    assert.equal(chosen.selected.provider,'agy');assert.equal(chosen.candidates.find(c=>c.provider==='codex').tightest,null);
  }
  assert.equal(isoSeconds(1794500000000),null);assert.equal(isoSeconds(9e12),null);
});

test('review BLOCKER: renamed/object/duplicate Antigravity windows invalidate the entire provider reading',async t=>{
  const s=await scratch(t),fake=path.join(s.parent,'fake-agy-schema.mjs');
  for(const buckets of [
    [{period:'5h',remaining_fraction:0.02,reset_time:reset},{period:'weekly',remaining_fraction:0.8,reset_time:reset}],
    [{window:{unit:'h',count:5},remaining_fraction:0.5,reset_time:reset}],
    [{window:'5h',remaining_fraction:0.02,reset_time:reset},{window:'5h',remaining_fraction:0.8,reset_time:reset}]
  ]){
    const e={status:'SUCCESS',command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets}]}}};
    await fs.writeFile(fake,`console.log(${JSON.stringify(JSON.stringify(e))});`);
    const direct=await readAgyUsage({binary:{file:process.execPath,args:[fake]}});assert.equal(direct.unknown,true);
    s.config.providers.agy.binary=fake;
    const reading=(await usage(s.root,s.config,{refresh:true})).find(r=>r.provider==='agy');assert.equal(reading.unknown,true);assert(reading.groups.every(g=>g.unknown&&g.windows.length===0));
    const chosen=pick(defaults,'review',[{provider:'agy',installed:true,authState:'signed in'}],[reading]);assert.equal(chosen.selected.tightest,null);
  }
});

test('review BLOCKER: Git options/invalid commits are rejected and an existing branch must match explicit base',async t=>{
  const s=await scratch(t),wt=path.join(s.parent,'worktree'),brief=await s.brief('DONE');
  for(const base of ['--no-checkout','--force','HEAD:seed.txt'])await s.fail('start','invalid','--provider','codex','--brief',brief,'--worktree',wt,'--branch','injected',`--base=${base}`);
  await assert.rejects(fs.access(wt));
  await exec('git',['-C',s.root,'branch','existing','HEAD']);const old=(await exec('git',['-C',s.root,'rev-parse','HEAD'])).stdout.trim();
  await fs.writeFile(path.join(s.root,'second.txt'),'two\n');await exec('git',['-C',s.root,'add','second.txt']);await exec('git',['-C',s.root,'commit','-m','Second']);
  const mismatch=await s.fail('start','mismatch','--provider','codex','--brief',brief,'--worktree',wt,'--branch','existing','--base','main');assert.match(mismatch.error,/does not match/);await assert.rejects(fs.access(wt));
  await s.run('start','matches','--provider','codex','--brief',brief,'--worktree',wt,'--branch','existing','--base',old);await s.run('wait','matches','--timeout','20s');
  assert.equal((await readJson(path.join(s.root,'.roster','sessions','matches','meta.json'))).baseCommit,old);assert.equal((await exec('git',['-C',wt,'rev-parse','HEAD'])).stdout.trim(),old);
});

test('review: reviewer access/model are explicit and preflight failures leave no worktree',async t=>{
  const s=await scratch(t),wt=path.join(s.parent,'author');
  await s.run('start','author','--provider','codex','--access','full','--brief',await s.brief('DONE'),'--worktree',wt,'--branch','feature','--base','main');await s.run('wait','author','--timeout','20s');
  const rev=await s.run('review','author','--by','agy');await s.run('wait',rev.name,'--timeout','20s');const status=await s.run('status',rev.name);
  assert.equal(status.access,'safe');assert.equal(status.model,'gemini-4-carbon-high');assert.equal(status.effort,'high');
  const override=await s.run('review','author','--by','agy','--model','gemini-3.8-flash','--effort','low','--access','full');await s.run('wait',override.name,'--timeout','20s');assert.equal((await s.run('status',override.name)).access,'full');
  const before=(await exec('git',['-C',s.root,'worktree','list','--porcelain'])).stdout;
  s.config.providers.claude.binary=path.join(s.parent,'missing-claude.exe');await fs.writeFile(path.join(s.root,'roster.config.json'),JSON.stringify(s.config));await s.fail('review','author','--by','claude');
  await s.fail('review','author','--by','agy','--model','not-offered','--effort','low');
  assert.equal((await exec('git',['-C',s.root,'worktree','list','--porcelain'])).stdout,before);
});

test('review: Windows env keys/shims are handled safely and long AGY prompts travel over stdin',async t=>{
  const env=childEnv({guards:{blockPush:false,env:{SECRET_DEPLOY_TOKEN:null}}},{secret_deploy_token:'dummy'},'win32');assert.equal(Object.keys(env).length,0);
  const s=await scratch(t);
  if(process.platform==='win32'){
    const a=path.join(s.parent,'bin1'),b=path.join(s.parent,'bin2');await fs.mkdir(a);await fs.mkdir(b);
    await fs.writeFile(path.join(a,'agy.cmd'),'@"%~dp0\\missing.exe" %*\r\n');await fs.writeFile(path.join(b,'agy.exe'),'MZ');
    assert.equal((await findBinary('agy',undefined,{PATH:`${a};${b}`,USERPROFILE:s.parent,LOCALAPPDATA:s.parent})).file,path.join(b,'agy.exe'));
    const script=path.join(a,'shim.mjs');await fs.writeFile(script,'console.log("shim");');await fs.writeFile(path.join(a,'agy.cmd'),'@"%~DP0\\shim.mjs" %*\r\n');
    assert.deepEqual((await findBinary('agy',path.join(a,'agy.cmd'))).args,[script]);
  }
  await s.run('start','long','--provider','agy','--brief',await s.brief('x'.repeat(35000)));assert.equal((await s.run('wait','long','--timeout','20s')).ok,true);assert.equal((await s.run('answer','long')).answer,'DONE');
});

test('review: corrupt sessions are isolated, legacy temp files do not wedge locks, atomic writes do not collide, and directory messages are literal',async t=>{
  const s=await scratch(t);await s.run('start','good','--provider','codex','--brief',await s.brief('DONE'));await s.run('wait','good','--timeout','20s');
  await fs.mkdir(path.join(s.root,'notes'));await s.run('send','good','--message','notes');await s.run('wait','good','--timeout','20s');
  const old=path.join(s.root,'.roster','locks','good');await fs.mkdir(old,{recursive:true});await fs.writeFile(path.join(old,'owner.json.999999.tmp'),'{}');await fs.utimes(old,1,1);
  await s.run('send','good','--message','hi');await s.run('wait','good','--timeout','20s');
  const target=path.join(s.parent,'collide.json');const results=await Promise.allSettled(Array.from({length:8},(_,i)=>writeJson(target,{i})));assert(results.every(r=>r.status==='fulfilled'));assert(Number.isInteger((await readJson(target)).i));assert(!(await fs.readdir(s.parent)).some(n=>n.endsWith('.tmp')));
  assert(pick(defaults,'toString',providerNames.map(provider=>({provider,installed:true,authState:'signed in'})),[],undefined,{catalog:{allocation:{}},status:{stale:false}}).selected);
  const bad=path.join(s.root,'.roster','sessions','corrupt');await fs.mkdir(path.join(bad,'turn-0001'),{recursive:true});await fs.writeFile(path.join(bad,'meta.json'),'{half-written');await fs.writeFile(path.join(bad,'turn-0001','result.json'),'{half-written');
  const statuses=await s.run('status');assert.equal(statuses.find(r=>r.name==='good').state,'done');assert.match(statuses.find(r=>r.name==='corrupt').error,/corrupt/);assert.equal((await s.run('usage')).length,4);
});

test('review: catalog updates preflight both trees, reject multiline verification, use canonical counterpart, and roll back late failures',async t=>{
  const s=await scratch(t),folder=path.join(s.parent,'portable','skills','multi-agent-dispatch');await fs.cp(defaultSkillRoot,folder,{recursive:true});
  s.config.catalog.path=path.join(s.parent,'portable','.agents','skills','multi-agent-dispatch');assert.equal(catalogPaths(s.root,s.config).copyRoot,folder);
  s.config.catalog.path=folder;const paths=catalogPaths(s.root,s.config),before=await skillFiles(folder),incoming=await readJson(path.join(folder,'references','model-catalog.json')),file=path.join(s.parent,'incoming.json');
  incoming.verifiedBy='Line one\nLine two';await writeJson(file,incoming);await assert.rejects(setCatalog(s.root,s.config,file),/single line/);assert.deepEqual([...await skillFiles(folder)],[...before]);
  incoming.verifiedBy='Single line';await writeJson(file,incoming);await fs.mkdir(path.dirname(paths.copyRoot),{recursive:true});await fs.writeFile(paths.copyRoot,'blocking file');await assert.rejects(setCatalog(s.root,s.config,file));assert.deepEqual([...await skillFiles(folder)],[...before]);
  await fs.unlink(paths.copyRoot);await setCatalog(s.root,s.config,file);const sourceBefore=await skillFiles(folder),copyBefore=await skillFiles(paths.copyRoot);
  incoming.verifiedBy='Next single line';await writeJson(file,incoming);const rename=fs.rename;let injected=false;
  fs.rename=async function(a,b){if(!injected&&b===paths.copyRoot&&String(a).includes('.stage-')){injected=true;throw Object.assign(new Error('injected install failure'),{code:'EACCES'});}return rename.call(this,a,b);};
  try{await assert.rejects(setCatalog(s.root,s.config,file),/injected/);}finally{fs.rename=rename;}
  assert(injected);assert.deepEqual([...await skillFiles(folder)],[...sourceBefore]);assert.deepEqual([...await skillFiles(paths.copyRoot)],[...copyBefore]);
});
