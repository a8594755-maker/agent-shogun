import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readJson } from './io.mjs';
import { processIdentity, sameProcess } from './process-owner.mjs';

let selfIdentity;
function busy() { return new Error('Another roster command holds this lock.'); }
function valid(owner) { return Number.isSafeInteger(owner?.pid) && owner.pid>0 && typeof owner.startTime==='string' && /^[a-f0-9-]{36}$/i.test(owner.nonce); }
async function readOwner(file) {
  const owner=await readJson(file,null);
  if(owner!==null&&!valid(owner))throw new Error('Lock ownership is corrupt; refusing unsafe recovery.');
  return owner;
}
// Immutable per-generation recovery claims serialize reapers, without deleting a
// newer holder's lock. A crashed reaper is superseded by the next claim, never unlinked.
async function claimRecovery(file, previous, privateFile) {
  const key=createHash('sha256').update(previous.nonce).digest('hex').slice(0,24);
  for(let i=0;i<1000;i++){
    const claim=`${file}.reap-${key}-${i}`;
    try { await fs.link(privateFile,claim); return; }
    catch(e){if(e.code!=='EEXIST')throw e;}
    const owner=await readOwner(claim);
    if(!owner || await sameProcess(owner))throw busy();
  }
  throw new Error('Too many abandoned lock recovery claims.');
}
export async function withFileLock(file, fn) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  selfIdentity ||= processIdentity(process.pid);
  const identity=await selfIdentity;
  if(!identity)throw new Error('Cannot verify lock owner process identity.');
  const owner={...identity,nonce:randomUUID()},privateFile=`${file}.${owner.nonce}.owner`;
  // Publish a complete wx-created record atomically; no empty public-lock window.
  await fs.writeFile(privateFile,JSON.stringify(owner)+'\n',{flag:'wx'});
  let acquired=false;
  try {
    for(let attempt=0;attempt<100;attempt++){
      try { await fs.link(privateFile,file); acquired=true;break; }
      catch(e){if(e.code!=='EEXIST')throw e;}
      const previous=await readOwner(file);
      if(!previous)continue;
      if(await sameProcess(previous))throw busy();
      await claimRecovery(file,previous,privateFile);
      const current=await readOwner(file);
      if(current?.nonce===previous.nonce)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
    }
    if(!acquired)throw busy();
    return await fn();
  } finally {
    if(acquired){const current=await readOwner(file);if(current?.nonce===owner.nonce)await fs.unlink(file);}
    await fs.unlink(privateFile).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
}
