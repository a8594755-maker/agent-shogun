import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grokAllowanceFromBilling, readGrokUsage } from '../src/grok-usage.mjs';
import { readGrokBilling } from '../src/grok-rpc.mjs';

const NOW = Date.parse('2026-11-14T23:50:00Z');
const billing = (config = {}, tier = 'SuperGrok') => ({
  config: {
    creditUsagePercent: 11,
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-09T04:53:24.819029+00:00', end: '2026-11-16T04:53:24.819029+00:00' },
    onDemandCap: { val: 0 }, onDemandUsed: { val: 0 }, prepaidBalance: { val: 0 }, isUnifiedBillingUser: true,
    billingPeriodStart: '2026-11-09T04:53:24.819029+00:00', billingPeriodEnd: '2026-11-16T04:53:24.819029+00:00',
    ...config,
  },
  subscription_tier: tier,
});

test('maps the weekly billing period to one weekly window with plan and reset', () => {
  const r = grokAllowanceFromBilling(billing(), NOW);
  assert.equal(r.plan, 'SuperGrok');
  assert.equal(r.source, 'grok agent _x.ai/billing');
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].id, 'default');
  const w = r.groups[0].windows[0];
  assert.equal(w.label, 'weekly');
  assert.equal(w.minutes, 10080);
  assert.equal(w.usedPercent, 11);
  assert.equal(new Date(w.resetsAt).toISOString(), '2026-11-16T04:53:24.819Z');
  assert.ok(!r.unknown && !r.invalid);
});

test('a missing or non-numeric percentage is invalid, never 0 %', () => {
  for (const creditUsagePercent of [undefined, null, '11', NaN]) {
    const r = grokAllowanceFromBilling ? (() => { try { return grokAllowanceFromBilling(billing({ creditUsagePercent }), NOW); } catch (e) { return e; } })() : null;
    assert.ok(r instanceof Error, `creditUsagePercent ${String(creditUsagePercent)} must not produce a reading`);
  }
});

test('falls back to billingPeriodEnd and derives the window from the dates for an unknown period type', () => {
  const r = grokAllowanceFromBilling(billing({ currentPeriod: { type: 'USAGE_PERIOD_TYPE_SOMETHING_NEW' } }), NOW);
  const w = r.groups[0].windows[0];
  assert.equal(w.minutes, 10080);
  assert.equal(w.label, 'weekly');
  assert.equal(new Date(w.resetsAt).toISOString(), '2026-11-16T04:53:24.819Z');
});

test('readGrokUsage: a rejected or failing billing call is unknown with the reason, not 0 %', async () => {
  const binary = { file: 'grok', args: [] };
  const missing = await readGrokUsage({ binary, now: NOW, read: async () => { throw Object.assign(new Error('x'), { code: -32601 }); } });
  assert.equal(missing.unknown, true);
  assert.match(missing.reason, /no _x\.ai\/billing method/);
  assert.equal(missing.groups, undefined);
  const broken = await readGrokUsage({ binary, now: NOW, read: async () => ({ config: {} }) });
  assert.equal(broken.unknown, true);
  assert.equal(broken.invalid, true);
  const none = await readGrokUsage({ binary: null, now: NOW });
  assert.equal(none.unknown, true);
});

function fakeGrok(dir, { billingReply }) {
  const script = path.join(dir, 'fake-grok.mjs');
  fs.writeFileSync(script, `
    const args = process.argv.slice(2);
    if (args.join(' ') !== 'agent --no-leader stdio') { process.stderr.write('bad args ' + args.join(' ')); process.exit(3); }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1 } }) + '\\n');
      else if (m.method === '_x.ai/billing') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...${JSON.stringify(billingReply)} }) + '\\n');
      else if (m.method === 'session/new' || m.method === 'session/prompt') { process.stderr.write('model turn started'); process.exit(4); }
    } });
    process.stdin.on('end', () => process.exit(0));
  `);
  return { file: process.execPath, args: [script] };
}

test('readGrokBilling talks to the agent over stdio: initialize, then _x.ai/billing, and no session or prompt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-grok-'));
  try {
    const binary = fakeGrok(dir, { billingReply: { result: billing() } });
    const result = await readGrokBilling(binary, { timeoutMs: 10000 });
    assert.equal(result.config.creditUsagePercent, 11);
    const reading = await readGrokUsage({ binary, now: NOW, timeoutMs: 10000 });
    assert.equal(reading.groups[0].windows[0].usedPercent, 11);
    assert.equal(reading.plan, 'SuperGrok');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readGrokBilling surfaces a JSON-RPC error code (method not found) for the caller to map to unknown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-grok-'));
  try {
    const binary = fakeGrok(dir, { billingReply: { error: { code: -32601, message: 'Method not found' } } });
    await assert.rejects(readGrokBilling(binary, { timeoutMs: 10000 }), e => e.code === -32601);
    const reading = await readGrokUsage({ binary, now: NOW, timeoutMs: 10000 });
    assert.equal(reading.unknown, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
