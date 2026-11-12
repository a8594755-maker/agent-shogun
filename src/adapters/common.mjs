import fs from 'node:fs/promises';
export async function envelope(file) {
  if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new Error('JSON envelope exceeds 32 MiB; inspect events.jsonl.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export function tokens(usage = {}) {
  const n = (...names) => { for (const name of names) if (Number.isFinite(usage[name])) return usage[name]; return 0; };
  const input = n('input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount');
  const output = n('output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount');
  const cacheRead = n('cache_read_input_tokens', 'cached_input_tokens', 'cachedContentTokenCount');
  const cacheWrite = n('cache_creation_input_tokens');
  // Codex's cached_input_tokens is already included in input_tokens; Claude caches are additional.
  const total = n('total_tokens', 'totalTokens', 'totalTokenCount') || input + output + (usage.cache_read_input_tokens || 0) + cacheWrite;
  return { input, output, cacheRead, cacheWrite, total };
}
export function limitedMessage(text) {
  return /rate[ _-]?limit|quota.{0,40}(exceed|exhaust|limit)|usage limit|too many requests|resource_exhausted|\b429\b|credit.{0,20}(exhaust|insufficient)|hit your limit/i.test(text);
}
