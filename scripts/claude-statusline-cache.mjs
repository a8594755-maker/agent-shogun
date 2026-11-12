#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { findBinary } from '../src/binaries.mjs';
import { rosterHome } from '../src/state.mjs';
import {isoSeconds} from '../src/allowance.mjs';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1024 * 1024) { console.error('roster: status-line input exceeds 1 MiB.'); process.exit(1); }
}
let data,invalid=false;
try { data = JSON.parse(input); } catch { data = {};invalid=true; }
if(!data||typeof data!=='object'||Array.isArray(data)){data={};invalid=true;}
if(data.rate_limits!==undefined&&(!data.rate_limits||typeof data.rate_limits!=='object'||Array.isArray(data.rate_limits)))invalid=true;
const limits = {};
for (const key of ['five_hour', 'seven_day']) {
  const w = data.rate_limits?.[key];
  if(w!=null){if(Number.isFinite(w.used_percentage)&&w.used_percentage>=0&&w.used_percentage<=100&&isoSeconds(w.resets_at))limits[key]={used_percentage:w.used_percentage,resets_at:w.resets_at};else invalid=true;}
}
if (Object.keys(limits).length || invalid) {
  const file = path.join(rosterHome(), 'claude-usage.json'), temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temp, JSON.stringify({ rate_limits: invalid?{}:limits, ...(invalid?{invalid:true,reason:'Invalid status-line allowance payload'}:{}),readAt: new Date().toISOString() }) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } catch { await fs.unlink(temp).catch(() => {}); console.error('roster: could not update the status-line cache.'); }
}
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length) {
  try {
    const command = args.shift(), binary = await findBinary(command, /[\\/]/.test(command) ? command : undefined);
    if (!binary) throw new Error('not installed');
    const child = spawn(binary.file, [...binary.args, ...args], { shell: false, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
  } catch { console.error('roster: could not run the existing status-line command.'); process.exitCode = 1; }
} else {
  const parts = invalid?[]:Object.entries(limits).map(([key, w]) => `${key === 'five_hour' ? '5h' : '7d'} ${w.used_percentage}%`);
  console.log(`Claude ${parts.join(' ') || 'usage unknown'}`);
}
