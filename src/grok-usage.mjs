import { readGrokBilling } from './grok-rpc.mjs';
import { windowReading, validateAllowance, invalidAllowance, AllowanceError } from './allowance.mjs';

const SOURCE = 'grok agent _x.ai/billing';
const PERIOD_MINUTES = { USAGE_PERIOD_TYPE_WEEKLY: 10080, USAGE_PERIOD_TYPE_DAILY: 1440, USAGE_PERIOD_TYPE_MONTHLY: null };
const PERIOD_LABEL = { USAGE_PERIOD_TYPE_WEEKLY: 'weekly', USAGE_PERIOD_TYPE_DAILY: 'daily', USAGE_PERIOD_TYPE_MONTHLY: 'monthly' };

/** Normalizes an ISO time with microseconds (`2026-11-16T04:53:24.819029+00:00`) to a plain ISO string, or null. */
function isoTime(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value.trim());
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Maps the `_x.ai/billing` result to roster's allowance reading. A missing or malformed `creditUsagePercent` or period
 * (API-key sign-in, another account type, a renamed field) is "unknown", never 0 %.
 */
export function grokAllowanceFromBilling(result, now = Date.now()) {
  const config = result?.config;
  if (!config || typeof config !== 'object') throw new AllowanceError('billing result has no config');
  const used = config.creditUsagePercent;
  if (!Number.isFinite(used)) throw new AllowanceError('creditUsagePercent missing or not a number');
  const period = config.currentPeriod ?? {};
  const end = isoTime(period.end ?? config.billingPeriodEnd), start = isoTime(period.start ?? config.billingPeriodStart);
  if (!end) throw new AllowanceError('billing period end missing or invalid');
  let minutes = PERIOD_MINUTES[period.type];
  let label = PERIOD_LABEL[period.type];
  if (minutes === undefined) { // unknown period type: derive from the dates
    const span = start ? Math.round((Date.parse(end) - Date.parse(start)) / 60000) : null;
    minutes = span && span > 0 ? span : null;
    label = minutes === 10080 ? 'weekly' : minutes ? `${minutes}-minute` : 'period';
  }
  const window = windowReading(label, minutes, used, end, { id: 'credits' });
  if (!window) throw new AllowanceError('invalid usage percentage or reset time');
  const plan = typeof result.subscription_tier === 'string' && result.subscription_tier.trim() ? result.subscription_tier.trim().slice(0, 40) : null;
  const money = name => (Number.isFinite(config[name]?.val) ? config[name].val : null);
  const reading = {
    groups: [{ id: 'default', name: 'All models', windows: [window] }],
    plan, source: SOURCE, readAt: new Date(now).toISOString(), observedAt: new Date(now).toISOString(),
    credits: { onDemandCap: money('onDemandCap'), onDemandUsed: money('onDemandUsed'), prepaidBalance: money('prepaidBalance') },
  };
  return validateAllowance(reading, 'grok');
}

export async function readGrokUsage({ binary, now = Date.now(), timeoutMs = 15000, read = readGrokBilling } = {}) {
  const fallback = { source: SOURCE, readAt: new Date(now).toISOString() };
  if (!binary) return { ...fallback, unknown: true, reason: 'Grok CLI is not installed; local token/cost gauge only.' };
  let result;
  try { result = await read(binary, { timeoutMs }); }
  catch (e) {
    const reason = e?.code === -32601 ? 'This Grok CLI has no _x.ai/billing method; local token/cost gauge only.' : `Grok billing unavailable (${e?.message || 'error'}); local token/cost gauge only.`;
    return { ...fallback, unknown: true, reason };
  }
  try { return grokAllowanceFromBilling(result, now); }
  catch (e) {
    if (e instanceof AllowanceError || e instanceof TypeError) return invalidAllowance(e.message, fallback);
    throw e;
  }
}
