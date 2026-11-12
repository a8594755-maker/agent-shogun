// Loaded before every test, and preloaded in its Node children. Never reuse a worker's state.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {fileURLToPath} = require('node:url');
const {syncBuiltinESMExports} = require('node:module');
const marker = Symbol.for('roster.test.isolation');
if (!globalThis[marker]) {
  globalThis[marker] = true;
  const newTest = /\.test\.[cm]?js$/.test(process.argv[1] || '');
  const created = newTest || !process.env.ROSTER_TEST_ROOT;
  const root = created ? fs.mkdtempSync(path.join(os.tmpdir(),'roster-isolated-')) : process.env.ROSTER_TEST_ROOT;
  const inside = (parent, file) => { const r=path.relative(path.resolve(parent),path.resolve(file));return !r || r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r); };
  if (!inside(os.tmpdir(),root) || !path.basename(root).startsWith('roster-isolated-')) throw new Error('Invalid isolated test root.');
  process.env.ROSTER_TEST_ROOT=root; process.env.ROSTER_TEST_MODE='1';
  if(created){
    process.env.ROSTER_STATE_DIR=path.join(root,'state'); process.env.ROSTER_HOME=path.join(root,'home','.roster');
    process.env.HOME=path.join(root,'home');process.env.USERPROFILE=process.env.HOME;
    process.env.LOCALAPPDATA=path.join(root,'local');process.env.APPDATA=path.join(root,'roaming');
    process.env.CODEX_HOME=path.join(root,'home','.codex');
    for(const name of Object.keys(process.env)) if(/TOKEN|SECRET|CREDENTIAL|API_KEY|COOKIE/i.test(name)||/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_)/.test(name)) delete process.env[name];
    fs.mkdirSync(process.env.HOME,{recursive:true});
  }
  const preload='--require '+JSON.stringify(__filename.replaceAll('\\','/'));
  if(!(process.env.NODE_OPTIONS||'').includes('isolation.cjs')) process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS||'')+' '+preload).trim();
  let violations=0;
  process.once('exit',()=>{if(violations)process.exitCode=1;});
  const check = file => {
    if(typeof file==='number'||file==null)return;
    if(file instanceof URL)file=fileURLToPath(file); if(Buffer.isBuffer(file))file=file.toString(); if(typeof file!=='string')return;
    const full=path.resolve(file), parts=full.split(path.sep);
    if((parts.includes('.roster') || parts.includes('.codex')&&parts.includes('sessions'))&&!inside(root,full)) {
      if(!globalThis[Symbol.for('roster.test.expectedGuard')]){violations++;process.stderr.write('TEST STATE GUARD: forbidden state access makes this test process fail\n');}
      throw new Error('TEST STATE GUARD: real repository/home state access refused');
    }
  };
  const methods=['readFile','writeFile','appendFile','open','mkdir','readdir','stat','lstat','access','unlink','rm','rmdir','opendir','realpath'];
  for(const name of methods){
    const original=fs[name];if(original)fs[name]=function(file,...args){check(file);return original.call(this,file,...args);};
    const sync=fs[name+'Sync'];if(sync)fs[name+'Sync']=function(file,...args){check(file);return sync.call(this,file,...args);};
    const promise=fs.promises[name];if(promise)fs.promises[name]=async function(file,...args){check(file);return promise.call(this,file,...args);};
  }
  for(const name of ['rename','copyFile','cp']){
    const original=fs[name];if(original)fs[name]=function(a,b,...args){check(a);check(b);return original.call(this,a,b,...args);};
    const promise=fs.promises[name];if(promise)fs.promises[name]=async function(a,b,...args){check(a);check(b);return promise.call(this,a,b,...args);};
  }
  for(const name of ['createReadStream','createWriteStream']){const original=fs[name];fs[name]=function(file,...args){check(file);return original.call(this,file,...args);};}
  syncBuiltinESMExports();
  if(created)process.once('exit',()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}});
}
