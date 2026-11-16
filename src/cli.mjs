import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './io.mjs';
import { loadConfig, init, providerNames, checkProvider } from './config.mjs';
import { probe } from './binaries.mjs';
import { adapters } from './adapters/index.mjs';
import { usage, setUsage } from './usage.mjs';
import { pick } from './pick.mjs';
import * as sessions from './sessions.mjs';
import { loadCatalog, setCatalog, modelDrift } from './catalog.mjs';

const help = `agent-shogun 0.1.0 — coding CLI workers and allowance-aware dispatch
Usage: agent-shogun [--config <path>] <command> [options] [--json]
  init
  providers
  usage [--refresh]
  usage set <provider> --window <label> --used <percent> --resets <ISO> [--window ...] [--plan <name>] [--group <id>]
  catalog show | status | set <file.json>
  pick --kind <kind> [--not-family <provider>]
  start <name> --provider <p> --brief <file> [--model <m>] [--effort <e>]
        [--dir <path> | --worktree <path> --branch <b> --base <ref>] [--access safe|full] [--web]
  send <name> --message <file or text>
  status [name]
  wait <name>... [--timeout 30m]
  answer <name> [--turn <n>]
  stop <name>
  review <name> --by <provider> [--model <m>] [--effort <e>] [--access safe|full] [--brief <file>]`;
const definitions = {
  init: {}, providers: {}, catalog: {}, usage: { refresh: false, window: true, used: true, resets: true, plan: true, group: true },
  pick: { kind: true, 'not-family': true },
  start: { provider: true, model: true, effort: true, brief: true, dir: true, worktree: true, branch: true, base: true, access: true, web: false },
  send: { message: true }, status: {}, wait: { timeout: true }, answer: { turn: true }, stop: {}, review: { by: true, brief: true,model:true,effort:true,access:true }
};
export function parseArgs(argv) {
  const args = [...argv]; let leadingJson = false, leadingConfig;
  while (args[0] === '--json' || args[0] === '--config' || args[0]?.startsWith('--config=')) {
    const arg = args.shift();
    if (arg === '--json') leadingJson = true;
    else {
      if (leadingConfig !== undefined) throw new Error('Duplicate --config');
      leadingConfig = arg === '--config' ? args.shift() : arg.slice(9);
      if (!leadingConfig || leadingConfig.startsWith('--')) throw new Error('--config needs a path.');
    }
  }
  const [command, ...rest] = args;
  if (!command || ['--help', '-h', 'help'].includes(command)) return { command: 'help', json: argv.includes('--json'), positional: [], options: {}, sequence: [] };
  if (!Object.hasOwn(definitions,command)) throw new Error(`Unknown command: ${command}`);
  const options = leadingConfig === undefined ? {} : { config: leadingConfig }, positional = [], sequence = []; let json = leadingJson;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') { positional.push(...rest.slice(i + 1)); break; }
    if (arg === '--json') { json = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equal = arg.indexOf('='), key = arg.slice(2, equal < 0 ? undefined : equal);
    if (key !== 'config' && !Object.hasOwn(definitions[command], key)) throw new Error(`Unknown option: --${key}`);
    const needsValue = key === 'config' || definitions[command][key];
    let value = true;
    if (needsValue) {
      value = equal < 0 ? rest[++i] : arg.slice(equal + 1);
      if (value === undefined || value === '' || equal < 0 && value.startsWith('--')) throw new Error(`--${key} needs a value (use --${key}=... for text beginning with --).`);
    } else if (equal >= 0) throw new Error(`--${key} does not take a value.`);
    if (key in options && !['window', 'used', 'resets'].includes(key)) throw new Error(`Duplicate --${key}`);
    options[key] = value; sequence.push([key, value]);
  }
  return { command, options, positional, sequence, json };
}
export function duration(value = '30m') {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
  if (!match) throw new Error('Timeout must be a duration such as 30m or 5s.');
  const ms = Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2] || 's']);
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Invalid timeout.');
  return ms;
}
function requireOption(options, key) { if (!options[key]) throw new Error(`Missing --${key}`); return options[key]; }
function arity(args, min, max = min) { if (args.length < min || args.length > max) throw new Error('Wrong number of arguments. See agent-shogun --help.'); }
async function messageText(value) {
  try { return await fs.readFile(path.resolve(value), 'utf8'); }
  catch (e) { if (['ENOENT','ENAMETOOLONG','EISDIR','EINVAL'].includes(e.code)) return value; throw e; }
}
function windowsFrom(sequence) {
  const windows = []; let current;
  for (const [key, value] of sequence) {
    if (key === 'window') { current = { label: value, minutes: value === 'weekly' || value.startsWith('weekly:') ? 10080 : value === '5-hour' ? 300 : null }; windows.push(current); }
    if (['used', 'resets'].includes(key)) {
      if (!current) throw new Error('--used and --resets must follow --window.');
      const prop = key === 'used' ? 'usedPercent' : 'resetsAt';
      if (Object.hasOwn(current, prop)) throw new Error(`Duplicate --${key} in window.`);
      current[prop] = key === 'used' ? Number(value) : value;
    }
  }
  return windows;
}
function compact(value) { return value == null ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value).replace(/[\r\n\t]/g, ' '); }
function table(rows, columns) {
  const data = [columns, ...rows.map(row => columns.map(k => compact(row[k])))];
  const widths = columns.map((_, i) => Math.max(...data.map(r => r[i].length)));
  return data.map(row => row.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}
function human(command, value) {
  if (command === 'answer') return value.answer;
  if (command === 'pick') return [...(value.warnings || []).map(w => `WARNING: ${w}`), value.reason].join('\n');
  if (command === 'catalog-status') return value.line;
  if (command === 'catalog-show') return [`Catalog: ${value.verifiedAt} by ${value.verifiedBy}`, table(Object.entries(value.providers).flatMap(([provider, data]) => data.models.map(m => ({ provider, model: m.id, group: m.group, tier: m.tier, bestFor: m.bestFor.join('; ') }))), ['provider', 'model', 'group', 'tier', 'bestFor']), table(Object.entries(value.allocation).map(([kind, choices]) => ({ kind, first: `${choices[0].provider}/${choices[0].model}`, second: choices[1] ? `${choices[1].provider}/${choices[1].model}` : '-' })), ['kind', 'first', 'second'])].join('\n');
  if (command === 'help') return help;
  if (command === 'usage' && Array.isArray(value)) {
    const text = table(value.flatMap(r => r.groups.flatMap(g => (g.windows.length ? g.windows : [{ label: 'unknown' }]).map(w => ({ provider: r.provider, group: g.id, window: w.label, used: w.usedPercent == null ? '?' : `${w.usedPercent}%`, resets: w.resetsAt, plan: r.plan, age: `${Math.round(w.ageSeconds ?? r.ageSeconds ?? 0)}s${w.stale || g.stale ? ' stale' : ''}`, source: w.source || r.source, state: g.limited ? `limited since ${g.limitedSince}: ${g.lastMessage}` : g.unknown ? g.reason : 'known', tokens5h: g.tokenGauge.last5Hours, tokens7d: g.tokenGauge.last7Days, usd5h: g.costGauge?.last5Hours.totalUsd, usd7d: g.costGauge?.last7Days.totalUsd })))), ['provider', 'group', 'window', 'used', 'resets', 'plan', 'age', 'source', 'state', 'tokens5h', 'tokens7d', 'usd5h', 'usd7d']);
    return [text, ...value.flatMap(r => r.catalogWarnings || []).map(w => `WARNING: ${w}`)].join('\n');
  }
  if (command === 'providers') return [table(value.flatMap(r => (r.models.length ? r.models : [`${r.configuredModel || '-'} (${r.modelsSource || r.reason})`]).map((model, i) => ({ provider: i ? '' : r.provider, installed: i ? '' : r.installed ? 'yes' : 'no', auth: i ? '' : r.authState, signIn: i ? '' : r.signIn, version: i ? '' : r.version, models: model }))), ['provider', 'installed', 'version', 'auth', 'signIn', 'models']), ...value.flatMap(r => r.catalogWarnings || []).map(w => `WARNING: ${w}`)].join('\n');
  if (command === 'status' || command === 'wait') return table((value.sessions || (Array.isArray(value) ? value : [value])).map(r => ({ ...r, seconds: Math.round(r.seconds), tokens: r.tokens?.total, head: r.head?.slice(0, 12) })), ['name', 'state', 'error', 'provider', 'model', 'turn', 'seconds', 'tokens', 'head', 'uncommitted', 'answer']);
  const rows = Array.isArray(value) ? value : [value];
  return table(rows, [...new Set(rows.flatMap(Object.keys))]);
}
export async function main(argv = process.argv.slice(2)) {
  let json = argv.includes('--json');
  try {
    const parsed = parseArgs(argv); json = parsed.json;
    const { command, options: o, positional: p } = parsed;
    if (command === 'help') { console.log(json ? JSON.stringify({ help }) : help); return; }
    const root = await repoRoot().catch(e => { if (command === 'catalog') return process.cwd(); throw e; }), config = await loadConfig(root, { cwd: process.cwd(), configPath: o.config });
    const catalogInfo = await loadCatalog(root, config);
    const providers = async () => {
      const result = await Promise.all(providerNames.map(name => probe(name, config, adapters[name])));
      const drift = modelDrift(catalogInfo.catalog, result);
      return result.map(p => ({ ...p, catalogWarnings: [...(catalogInfo.status.stale ? [catalogInfo.status.line] : []), ...(drift.get(p.provider) || [])] }));
    };
    let outputCommand = command;
    let value;
    switch (command) {
      case 'init': arity(p, 0); value = await init(root); break;
      case 'providers': arity(p, 0); value = await providers(); break;
      case 'catalog':
        if (p[0] === 'status') { arity(p, 1); value = catalogInfo.status; outputCommand = 'catalog-status'; if (value.stale) process.exitCode = 3; }
        else if (p[0] === 'show') { arity(p, 1); if (!catalogInfo.catalog) throw new Error(catalogInfo.status.line); value = catalogInfo.catalog; outputCommand = 'catalog-show'; }
        else if (p[0] === 'set') { arity(p, 2); value = await setCatalog(root, config, path.resolve(p[1])); }
        else throw new Error('Use catalog show, catalog status, or catalog set <file.json>.');
        break;
      case 'usage':
        if (p[0] === 'set') { arity(p, 2); if (o.refresh) throw new Error('--refresh is for reading usage.'); value = await setUsage(root, p[1], windowsFrom(parsed.sequence), o.plan, o.group); }
        else { arity(p, 0); if (parsed.sequence.some(([k]) => !['refresh', 'config'].includes(k))) throw new Error('Reading options require usage set.'); const probes = await providers(); value = (await usage(root, config, { refresh: o.refresh })).map(r => ({ ...r, catalogWarnings: probes.find(p => p.provider === r.provider)?.catalogWarnings || [] })); }
        break;
      case 'pick': arity(p, 0); if (o['not-family']) checkProvider(o['not-family']); value = pick(config, requireOption(o, 'kind'), await providers(), await usage(root, config), o['not-family'], catalogInfo); if (!value.selected) process.exitCode = 1; break;
      case 'start': arity(p, 1); requireOption(o, 'provider'); value = await sessions.start(root, config, p[0], o, await fs.readFile(path.resolve(requireOption(o, 'brief')), 'utf8')); break;
      case 'send': arity(p, 1); value = await sessions.send(root, config, p[0], await messageText(requireOption(o, 'message'))); break;
      case 'status': arity(p, 0, 1); value = await sessions.status(root, p[0]); break;
      case 'wait': arity(p, 1, Infinity); value = await sessions.wait(root, p, duration(o.timeout)); if (!value.ok) process.exitCode = 1; break;
      case 'answer': arity(p, 1); value = await sessions.answer(root, p[0], o.turn); break;
      case 'stop': arity(p, 1); value = await sessions.stop(root, p[0]); break;
      case 'review': arity(p, 1); value = await sessions.review(root, config, p[0], checkProvider(requireOption(o, 'by')), o.brief ? await fs.readFile(path.resolve(o.brief), 'utf8') : '',o); break;
    }
    console.log(json ? JSON.stringify(value) : human(outputCommand, value));
  } catch (e) { console.error(json ? JSON.stringify({ error: e.message }) : `agent-shogun: ${e.message}`); process.exitCode = 1; }
}
