import './isolation.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {scratch,project} from './helpers.mjs';
import {readJson,writeJson,sleep,exec} from '../src/io.mjs';
import {stateDirectory,rosterHome} from '../src/state.mjs';
import {processIdentity,terminateOwned,ownChild,sameProcess} from '../src/process-owner.mjs';
import {resolveModelEffort,sessionSelection} from '../src/model-selection.mjs';
import {loadCatalog} from '../src/catalog.mjs';
import {loadConfig,defaults,providerNames} from '../src/config.mjs';
import {adapters} from '../src/adapters/index.mjs';
import {pick} from '../src/pick.mjs';
import {binaryCandidates,findBinary,probe} from '../src/binaries.mjs';

test('state guard refuses real repository state before any filesystem operation',async()=>{
  globalThis[Symbol.for('roster.test.expectedGuard')]=true;
  try{await assert.rejects(fs.readFile(path.join(project,'.roster','sessions','any','meta.json')),/TEST STATE GUARD/);}finally{delete globalThis[Symbol.for('roster.test.expectedGuard')];}
  assert(stateDirectory(project).startsWith(process.env.ROSTER_TEST_ROOT));
  assert(rosterHome().startsWith(process.env.ROSTER_TEST_ROOT));
});
test('catching a forbidden state-read error cannot silently make the test run pass',async()=>{
  const code="try { await import('node:fs/promises').then(fs=>fs.readFile(process.env.ROSTER_FORBIDDEN_TEST_PATH)); } catch {}";
  await assert.rejects(exec(process.execPath,['--input-type=module','-e',code],{env:{...process.env,ROSTER_FORBIDDEN_TEST_PATH:path.join(project,'.roster','any.json')},windowsHide:true}),e=>e.code===1&&/TEST STATE GUARD/.test(e.stderr));
});
test('every test module installs the isolation bootstrap first',async()=>{
  for(const name of await fs.readdir(path.join(project,'test'))) if(name.endsWith('.test.mjs')) {
    assert((await fs.readFile(path.join(project,'test',name),'utf8')).startsWith("import './isolation.cjs';"),name);
  }
});
test('state and home overrides reject escape attempts in test mode',()=>{
  const old=process.env.ROSTER_STATE_DIR;process.env.ROSTER_STATE_DIR=path.join(project,'.roster');
  try{assert.throws(()=>stateDirectory(project),/Test isolation/);}finally{process.env.ROSTER_STATE_DIR=old;}
});
test('a PID or forged receipt is not enough to signal a process',async()=>{
  const id=await processIdentity(process.pid);assert(id?.startTime);
  assert.equal(await sameProcess({...id,startTime:'different'}),false);
  assert.equal((await terminateOwned({pid:process.pid,exitCode:null,signalCode:null})).signalled,false);
  await assert.rejects(ownChild({pid:process.pid}),/ChildProcess/);
});
test('an owned child with a mismatched creation time is never signalled',async t=>{
  const child=spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,ROSTER_CHILD_TOKEN:'owned-test'}});
  const closed=new Promise(resolve=>child.once('close',resolve)),record=await ownChild(child,'owned-test'),birth=record.startTime;
  t.after(async()=>{record.startTime=birth;await terminateOwned(child);await closed;});
  assert(birth);record.startTime='mismatched';assert.equal((await terminateOwned(child)).signalled,false);
  assert.equal(child.exitCode,null);record.startTime=birth;assert.equal((await terminateOwned(child)).signalled,true);await closed;
});
test('stale heartbeat never interrupts a supervisor whose identity is still live',async t=>{
  const s=await scratch(t);await s.run('start','alive','--provider','codex','--brief',await s.brief('SLOW TREE'));
  const dir=path.join(s.root,'.roster','sessions','alive','turn-0001'), running=await readJson(path.join(dir,'running.json'));
  await writeJson(path.join(dir,'heartbeat.json'),{nonce:running.nonce,at:'2000-01-01T00:00:00Z'});
  assert.equal((await s.run('status','alive')).state,'running');
  await s.run('stop','alive');await s.fail('wait','alive','--timeout','20s');
});
test('transient control-file I/O errors are audited instead of killing a worker as stopped',async t=>{
  const s=await scratch(t);await s.run('start','io','--provider','codex','--brief',await s.brief('SLOW TREE'));
  const dir=path.join(s.root,'.roster','sessions','io','turn-0001');
  await fs.writeFile(path.join(dir,'stop.json'),'{temporarily malformed');
  let audited=false;
  for(let i=0;i<100;i++){audited=await fs.readFile(path.join(dir,'control.jsonl'),'utf8').then(s=>s.includes('control_io_error'),()=>false);if(audited)break;await sleep(50);}
  assert(audited);await fs.unlink(path.join(dir,'stop.json'));
  assert.equal((await s.run('wait','io','--timeout','20s')).ok,true);
  const audit=await fs.readFile(path.join(dir,'control.jsonl'),'utf8');assert.match(audit,/control_io_error/);
});
test('a managed worker runs this repository suite subset inside itself and survives',async t=>{
  const s=await scratch(t);
  await s.run('start','nested','--provider','codex','--dir',project,'--brief',await s.brief('RUN_NESTED_SUITE'));
  const r=await s.run('wait','nested','--timeout','100s');assert.equal(r.ok,true);
  assert.match((await s.run('answer','nested')).answer,/Nested suite passed/);
  assert.equal((await s.run('status','nested')).state,'done');
});
test('model suffix supplies effort when start omits it; base plus explicit effort resolves to the offered id',async t=>{
  const s=await scratch(t);
  await s.run('start','suffix','--provider','agy','--model','gemini-4-carbon-high','--brief',await s.brief('CAPTURE'));
  await s.run('wait','suffix','--timeout','20s');const capture=JSON.parse((await s.run('answer','suffix')).answer);
  assert.equal(capture.args[capture.args.indexOf('--effort')+1],'high');
  const selected=await sessionSelection(s.root,s.config,'agy','gemini-4-carbon','high');assert.equal(selected.model,'gemini-4-carbon-high');
  await assert.rejects(sessionSelection(s.root,s.config,'agy','gemini-4-carbon-high','low'),/conflicting/);
});
test('every catalog pick can feed its adapter argument builder without an effort conflict',async t=>{
  const s=await scratch(t),info=await loadCatalog(s.root,s.config),installed=providerNames.map(provider=>({provider,installed:true,authState:'signed in'}));
  for(const [kind,choices]of Object.entries(info.catalog.allocation))for(const choice of choices){
    const config={...s.config,kinds:{[kind]:[choice]}};const selected=pick(config,kind,installed,[],undefined,info).selected;assert(selected);
    const args=adapters[selected.provider].build({...selected,access:'safe',catalog:info.catalog,directory:s.root,prompt:'hello',promptFile:'brief.txt',providerSessionId:'fixture',answer:'answer.txt',settings:'settings.json'}).args;
    if(selected.provider==='agy'){const model=args[args.indexOf('--model')+1],effort=args[args.indexOf('--effort')+1];assert.equal(/-(low|medium|high|xhigh|max)$/.exec(model)?.[1],effort);}
  }
  for(const provider of providerNames){const m=info.catalog.providers[provider].models[0];assert.throws(()=>resolveModelEffort(provider,m.id,'not-supported',{catalog:info.catalog}),/effort/);}
  assert.throws(()=>resolveModelEffort('claude','opus','not-supported',{catalog:info.catalog}),/effort/);
});
test('default install locations exist for Windows, macOS and Linux without relying on PATH',()=>{
  const env={PATH:'',USERPROFILE:'C:\\fixture',LOCALAPPDATA:'C:\\fixture\\local',HOME:'/fixture'};
  assert(binaryCandidates('agy',null,env,'win32').includes('C:\\fixture\\local\\agy\\bin\\agy.exe'));
  assert(binaryCandidates('grok',null,env,'win32').includes('C:\\fixture\\.grok\\bin\\grok.exe'));
  for(const platform of ['darwin','linux']){assert(binaryCandidates('agy',null,env,platform).includes('/fixture/.local/bin/agy'));assert(binaryCandidates('grok',null,env,platform).includes('/fixture/.grok/bin/grok'));}
});
test('user-level paths merge below project overrides and missing binary reports its search paths',async t=>{
  const s=await scratch(t),personal=path.join(rosterHome(),'config.json');
  await writeJson(personal,{providers:{agy:{path:path.join(project,'test','fakes','agy.mjs')}}});
  await fs.writeFile(path.join(s.root,'roster.config.json'),JSON.stringify({providers:{codex:s.config.providers.codex,claude:s.config.providers.claude,grok:s.config.providers.grok}}));
  const config=await loadConfig(s.root);assert.equal(config.providers.agy.binary,path.join(project,'test','fakes','agy.mjs'));
  await fs.writeFile(path.join(s.root,'roster.config.json'),JSON.stringify({providers:{agy:{path:'missing executable'}}}));
  const overridden=await loadConfig(s.root);assert.equal(overridden.providers.agy.binary,path.join(s.root,'missing executable'));
  const p=await probe('agy',overridden,adapters.agy);assert.equal(p.installed,false);assert(p.searched.includes(overridden.providers.agy.binary));assert.match(p.reason,/looked in/);
});
