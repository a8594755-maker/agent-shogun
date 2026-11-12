import './isolation.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {scratch,project} from './helpers.mjs';
import {defaults} from '../src/config.mjs';
import {validateAllowance} from '../src/allowance.mjs';
import {mapExternalUsage} from '../src/external-usage.mjs';
import {readClaudeUsage} from '../src/claude-usage.mjs';
import {readCodexUsage} from '../src/codex-usage.mjs';
import {pick} from '../src/pick.mjs';
import {withFileLock} from '../src/file-lock.mjs';
import {writeJson,readJson} from '../src/io.mjs';
const reset='2099-11-18T20:00:00Z';
const window={label:'weekly',minutes:10080,usedPercent:20,resetsAt:reset};

test('all allowance entry points reject malformed windows as a whole provider',async t=>{
  const s=await scratch(t);
  for(const bad of [{...window,label:1},{...window,label:''},{...window,usedPercent:Infinity},{...window,resetsAt:'2099-02-30T00:00:00Z'},window]){
    const reading={groups:[{id:'default',windows:[window,bad]}]};
    assert.equal(validateAllowance(reading,'claude').invalid,true);
    const external=mapExternalUsage([{provider:'claude',...reading}]);assert.equal(external[0].invalid,true);assert.deepEqual(external[0].groups,[]);
  }
  const cache=path.join(s.parent,'claude-usage.json');
  await writeJson(cache,{readAt:new Date().toISOString(),rate_limits:{five_hour:{used_percentage:20,resets_at:4098693600},seven_day:{used_percentage:101,resets_at:4098693600}}});
  assert.equal((await readClaudeUsage({cacheFile:cache})).invalid,true);
  const hook=spawn(process.execPath,[path.join(project,'scripts','claude-statusline-cache.mjs')],{env:s.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  hook.stdin.end(JSON.stringify({rate_limits:{five_hour:{used_percentage:20,resets_at:4098693600},seven_day:{used_percentage:-1,resets_at:4098693600}}}));
  let output='';hook.stdout.on('data',b=>output+=b);assert.equal(await new Promise((resolve,reject)=>{hook.on('error',reject);hook.on('close',resolve);}),0);
  assert.match(output,/unknown/);assert.equal((await readJson(path.join(s.env.ROSTER_HOME,'claude-usage.json'))).invalid,true);
});

test('catalog unknown leader yields to known allowance; project rule retains it explicitly; live missing models are rejected',()=>{
  const installed=['claude','codex'].map(provider=>({provider,installed:true,authState:'signed in'}));
  const choices=[{provider:'claude',model:'claude-opus-5-5',effort:'low'},{provider:'codex',model:'gpt-6.1-sol',effort:'low'}];
  const readings=[{provider:'claude',unknown:true,groups:[]},{provider:'codex',windows:[window]}];
  const catalog={catalog:{allocation:{ui:choices}},status:{stale:false}};
  const result=pick(defaults,'ui',installed,readings,undefined,catalog);assert.equal(result.selected.provider,'codex');assert.match(result.reason,/first choice allowance unknown; prefer known/);
  const ruled=pick({...defaults,userKinds:{ui:choices}},'ui',installed,readings,undefined,catalog);assert.equal(ruled.selected.provider,'claude');assert.match(ruled.reason,/project rule retained/);
  const live=pick(defaults,'ui',installed.map(p=>({...p,modelsListed:true,models:p.provider==='claude'?['claude-haiku-5-5']:['gpt-6.1-sol']})),readings,undefined,catalog);assert.equal(live.selected.provider,'codex');assert.match(live.rejected[0].reason,/not offered/);
});

test('Codex log reader honors CODEX_HOME and ignores unrelated large lines',async t=>{
  const s=await scratch(t),previous=process.env.CODEX_HOME;
  process.env.CODEX_HOME=path.join(s.parent,'alternate-codex');t.after(()=>{process.env.CODEX_HOME=previous;});
  const dir=path.join(process.env.CODEX_HOME,'sessions');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'rollout-fixture.jsonl'),JSON.stringify({payload:{rate_limits:{primary:{used_percent:42,window_minutes:10080,resets_at:4098693600}}}})+'\n'+JSON.stringify({text:'x'.repeat(200000)})+'\n');
  assert.equal((await readCodexUsage()).windows[0].usedPercent,42);
  await fs.appendFile(path.join(dir,'rollout-fixture.jsonl'),JSON.stringify({payload:{rate_limits:null}})+'\n');
  assert.equal((await readCodexUsage()).invalid,true,'malformed newest reading cannot reveal older known values');
});

test('lock ownership survives contending recovery and release cannot remove a replacement generation',async t=>{
  const s=await scratch(t),file=path.join(s.parent,'race.lock');
  await writeJson(file,{pid:2147483647,startTime:'not-a-live-process',nonce:'00000000-0000-0000-0000-000000000000'});
  let entered=0,release,ready;const holding=new Promise(r=>release=r),started=new Promise(r=>ready=r);
  const first=withFileLock(file,async()=>{entered++;ready();await holding;});await started;
  await assert.rejects(withFileLock(file,async()=>entered++),/holds this lock/);
  assert.equal(entered,1);const original=await readJson(file),replacement={...original,nonce:'11111111-1111-1111-1111-111111111111'};
  await writeJson(file,replacement);release();await first;assert.equal((await readJson(file)).nonce,replacement.nonce);
});
