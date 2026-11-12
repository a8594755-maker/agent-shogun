import { exec } from './io.mjs';

export function authCommand(binary, args) {
  return exec(binary.file, [...binary.args, ...args], { shell: false, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
}
const negative = text => /not (?:authenticated|logged in)|logged out|sign.in required|unauthorized|\b401\b/i.test(text);
export async function codexAuth({ binary }) {
  try {
    const r = await authCommand(binary, ['login', 'status']);
    const text = r.stdout + r.stderr;
    return /logged in|authenticated/i.test(text) && !negative(text) ? 'signed in' : negative(text) ? 'not signed in' : 'unknown';
  } catch (e) { return negative((e.stdout || '') + (e.stderr || '')) ? 'not signed in' : 'unknown'; }
}
export async function claudeAuth({ binary }) {
  try {
    const r = await authCommand(binary, ['auth', 'status', '--json']);
    const data = JSON.parse(r.stdout);
    return data.loggedIn === true ? 'signed in' : data.loggedIn === false ? 'not signed in' : 'unknown';
  } catch (e) {
    try { if (JSON.parse(e.stdout).loggedIn === false) return 'not signed in'; } catch { /* no raw identity data is returned */ }
    return 'unknown';
  }
}
export async function agyAuth({ binary }) {
  try {
    const r = await authCommand(binary, ['--print', '/usage', '--output-format', 'json']);
    const data = JSON.parse(r.stdout);
    return data.status === 'SUCCESS' && data.command?.name === 'usage' && Array.isArray(data.command.data?.groups) ? 'signed in' : negative(r.stdout) ? 'not signed in' : 'unknown';
  } catch (e) { return negative((e.stdout || '') + (e.stderr || '')) ? 'not signed in' : 'unknown'; }
}
export async function grokAuth({ binary, modelsOutput }) {
  try {
    const text = modelsOutput ?? (await authCommand(binary, ['models'])).stdout;
    return negative(text) ? 'not signed in' : /you are logged in with grok\.com/i.test(text) ? 'signed in' : 'unknown';
  } catch (e) { return negative((e.stdout || '') + (e.stderr || '')) ? 'not signed in' : 'unknown'; }
}
