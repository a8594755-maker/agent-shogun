import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {within} from './state.mjs';
import {skillFiles} from './skill-sync.mjs';

export async function preflightTree(root) {
  root=path.resolve(root);
  const stat=await fs.lstat(root).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw new Error('Skill root/copy must be a real directory, not a file or symlink.');
  if(stat){const real=await fs.realpath(root);if(path.relative(real,root))throw new Error('Skill transaction paths must not traverse symlinks.');}
  return {root,exists:!!stat,files:stat?await skillFiles(root):new Map()};
}
export function separateTrees(a,b){if(within(a,b)||within(b,a))throw new Error('Skill source and copy must be separate trees.');}
// Staging and directory swaps keep incomplete content out of both published trees.
// Ordinary failures roll back; no filesystem can atomically swap two paths across a crash.
export async function replaceTrees(plans) {
  const nonce=randomUUID(),items=plans.map(p=>{
    const root=path.resolve(p.root),parent=path.dirname(root),base=path.basename(root);
    const item={...p,root,parent,stage:path.join(parent,`.${base}.stage-${nonce}`),backup:path.join(parent,`.${base}.backup-${nonce}`),backed:false,installed:false};
    for(const target of [root,item.stage,item.backup])if(path.dirname(target)!==parent||!within(parent,target)||target===parent)throw new Error('Unsafe tree transaction target.');
    return item;
  });
  const created=[];
  async function parents(dir){
    const missing=[];let cursor=dir;
    while(!await fs.lstat(cursor).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})){missing.push(cursor);cursor=path.dirname(cursor);}
    const real=await fs.realpath(cursor);if(path.relative(real,cursor))throw new Error('Skill transaction parent traverses a symlink.');
    for(const d of missing.reverse()){await fs.mkdir(d);created.push(d);}
  }
  async function removeOwned(item,which){const file=item[which];if(path.dirname(file)!==item.parent||!path.basename(file).endsWith(nonce))throw new Error('Unsafe transaction cleanup');await fs.rm(file,{recursive:true,force:true});}
  let committed=false;
  try {
    for(const item of items){
      await parents(item.parent);await fs.mkdir(item.stage);
      for(const [relative,content]of item.files){const target=path.resolve(item.stage,relative);if(!within(item.stage,target)||target===item.stage)throw new Error('Unsafe staged skill file');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});}
    }
    for(const item of items){
      if(item.exists){await fs.rename(item.root,item.backup);item.backed=true;}
      await fs.rename(item.stage,item.root);item.installed=true;
    }
    committed=true;
  } catch(error){
    const failures=[];
    for(const item of [...items].reverse())try{
      if(item.installed){await fs.rename(item.root,item.stage);item.installed=false;}
      if(item.backed){await fs.rename(item.backup,item.root);item.backed=false;}
    }catch(e){failures.push(e.message);}
    if(failures.length){for(const item of items)item.retain=true;throw new Error(`Catalog update failed and rollback could not complete; retained backups for recovery: ${failures.join('; ')}`,{cause:error});}
    throw error;
  } finally {
    for(const item of items){if(!item.retain)await removeOwned(item,'stage').catch(()=>{});if(committed)await removeOwned(item,'backup').catch(()=>{});}
    if(!committed)for(const dir of created.reverse())await fs.rmdir(dir).catch(()=>{});
  }
}
