import fs from 'node:fs';
import { spawn } from 'node:child_process';
export async function fake(provider) {
  const args = process.argv.slice(2);
  // node --test also discovers helper files under test/; discovery must be inert.
  if (!args.length) return;
  if (args.includes('--version')) { console.log(`${provider} fake-1.0`); return; }
  if (args[0] === 'models') { console.log('fake-small\nfake-large'); return; }
  const val = flag => args[args.indexOf(flag) + 1];
  let prompt = '';
  if (provider === 'agy') prompt = val('-p');
  else for await (const chunk of process.stdin) prompt += chunk;
  const resumed = args.includes('resume') || args.includes('--conversation') || args.includes('--resume');
  const prior = provider === 'codex' ? val('resume') : provider === 'agy' ? val('--conversation') : val('--resume');
  const id = resumed ? prior : `fake-${provider}-conversation`;
  if (provider === 'codex') console.log(JSON.stringify({ type: 'thread.started', thread_id: id }));
  if (prompt.includes('SLOW')) {
    if (prompt.includes('TREE')) {
      const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
      fs.writeFileSync('descendant.pid', String(descendant.pid));
    }
    fs.writeFileSync('ready.txt', 'ready');
    await new Promise(r => setTimeout(r, 3000));
  }
  if (prompt.includes('MALFORMED')) { console.log('not json'); return; }
  let answer = resumed ? 'hello.txt' : 'DONE';
  if (prompt.includes('CAPTURE')) answer = JSON.stringify({ args, push: process.env[`GIT_CONFIG_VALUE_${Number(process.env.GIT_CONFIG_COUNT) - 1}`], deploy: process.env.CLOUDFLARE_API_TOKEN, prompt, cwd: process.cwd() });
  const limited = prompt.includes('LIMIT');
  if (limited) answer = 'Rate limit exceeded: quota exhausted, try later.';
  if (provider === 'codex') {
    fs.writeFileSync(val('-o'), answer);
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: answer } }));
    console.log(JSON.stringify(limited ? { type: 'turn.failed', error: { message: answer } } : { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 5 } }));
  } else if (provider === 'agy') {
    console.log(JSON.stringify({ conversation_id: id, status: limited ? 'error' : 'success', response: answer, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 }, denied_actions: [] }));
  } else {
    console.log(JSON.stringify({ type: 'result', session_id: id, subtype: limited ? 'error_during_execution' : 'success', is_error: limited, result: answer, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 }, permission_denials: [] }));
  }
  if (limited && !prompt.includes('ZERO_EXIT')) process.exitCode = 1;
}
