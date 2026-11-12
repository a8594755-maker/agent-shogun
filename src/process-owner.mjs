import fs from 'node:fs/promises';
import { exec } from './io.mjs';
import { randomUUID } from 'node:crypto';
import { ChildProcess } from 'node:child_process';

const owned = new WeakMap();
export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const command = `$rosterProcess = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($rosterProcess) { $rosterProcess.StartTime.ToUniversalTime().Ticks.ToString() }`;
      const {stdout} = await exec('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',command], {windowsHide:true, timeout:5000, maxBuffer:1024});
      return /^\d+$/.test(stdout.trim()) ? {pid, startTime:stdout.trim()} : null;
    }
    if (process.platform === 'linux') {
      const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
      return {pid, startTime:fields[19]};
    }
    const {stdout} = await exec('ps',['-p',String(pid),'-o','lstart='],{timeout:5000});
    return stdout.trim() ? {pid,startTime:stdout.trim()} : null;
  } catch { return null; }
}
export async function sameProcess(record) {
  if (!record?.startTime) return false;
  const current = await processIdentity(record.pid);
  return current?.startTime === record.startTime;
}
export async function ownChild(child, token = randomUUID()) {
  if (!(child instanceof ChildProcess)) throw new Error('Only a live spawned ChildProcess can be owned.');
  let identity = child.exitCode === null && child.signalCode === null ? await processIdentity(child.pid) : null;
  if (child.exitCode !== null || child.signalCode !== null) identity=null;
  const record = {...identity, pid:child.pid, token};
  owned.set(child, record);
  return record;
}
export async function terminateOwned(child) {
  const record = owned.get(child);
  if (!record || child.exitCode !== null || child.signalCode !== null) return {signalled:false, reason:'child already exited or not owned'};
  if (!await sameProcess(record)) return {signalled:false, reason:'process identity unverified; refused to signal'};
  if (child.exitCode !== null || child.signalCode !== null) return {signalled:false, reason:'child already exited'};
  if (process.platform === 'win32') await exec('taskkill.exe',['/PID',String(record.pid),'/T','/F'],{windowsHide:true});
  else { try { process.kill(-record.pid,'SIGKILL'); } catch(e) { if(e.code!=='ESRCH') throw e; } }
  return {signalled:true};
}
