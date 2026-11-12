# Use the skill without roster

This folder is sufficient for planning and dispatch. The CLIs themselves must be
installed and signed in; use each provider's `cli` and `signIn` catalog fields.
Probe `--help`, version, and a non-inference sign-in/model-list command before
launching. Do not open provider credential or cookie files. Confirm every chosen
model/effort against the catalog and current CLI; the initial allocation is provisional.

Create separate Git branches/worktrees, write briefs with ownership and forbidden
mechanisms, and retain the selected directory, process handle, session ID, raw
output, final answer, and exit code. Use argument arrays without a shell. A planner
may supervise its own processes or use an existing background-task facility;
never terminate workers by image name. Preserve the user's access authorization.

## Headless invocation templates

Replace placeholders with the selected catalog values. These are argument-array
templates, not shell strings to interpolate untrusted prompts into.

| CLI | New conversation | Resume |
| --- | --- | --- |
| Codex | `codex exec -m MODEL -c model_reasoning_effort="EFFORT" --approve-for-me --json -o ANSWER -` with brief on stdin | `codex --approve-for-me exec resume ID -m MODEL -c model_reasoning_effort="EFFORT" --json -o ANSWER -` with follow-up on stdin |
| Antigravity | `agy -p BRIEF --model MODEL --effort EFFORT --output-format json --settings SETTINGS --mode accept-edits` | Same flags plus `--conversation ID` |
| Claude | `claude -p --model MODEL --effort EFFORT --output-format json --permission-mode acceptEdits` with brief on stdin | Same flags plus `--resume ID` |
| Grok | `grok --prompt-file BRIEF_FILE -m MODEL --reasoning-effort EFFORT --output-format json --cwd DIRECTORY --permission-mode default --sandbox workspace -s UUID` | Same flags with `-r ID` instead of `-s UUID` |

Codex's first `thread.started.thread_id`, Antigravity's `conversation_id`,
Claude's `session_id`, and Grok's `sessionId` are the conversation identifiers.
Choose Grok's UUID before launch. Treat nonzero exit, failed envelopes, truncated
turns, and Grok stop reasons other than `end_turn` as failures. A final answer can
be a refusal; verify the requested files, tests and commit separately.

For Antigravity, supply a session-only settings JSON with `toolPermission` set to
`always-proceed`, guarded workspace access, and `permissions.deny` entries using
its documented `command(regex:...)` rules. Deny pushes, destructive Git operations,
deployment/publication, and web tools unless authorized. Probe the installed guide
for its exact settings schema; do not change global configuration automatically.
For Grok add repeated `--deny` rules, including `Bash(git push*)`,
`Bash(git * push*)`, `Bash(*wrangler*)`, `Bash(*npm publish*)`, and
`Bash(*npm run deploy*)`; add `--disable-web-search` without web authorization.
Add `--allow 'Edit(./**)'`, `--allow 'Write(./**)'`, `--allow 'Bash(git add *)'`,
`--allow 'Bash(git commit *)'`, and explicit project test/check command grants for
unattended guarded writes. Other default-mode commands may be cancelled. Do not silently switch to
bypass mode. The installed Grok 1.0.41 rejected `none`; its observed minimum was
`low`. Its guide documents kernel sandbox enforcement on Linux/macOS, not Windows.

Apply the same executor rules in the brief: directory/branch ownership; no push,
deploy or publish; run relevant checks and fix failures; never weaken tests.
Child-only Git/environment accident guards can supplement provider policies:
append a `remote.origin.pushurl=disabled://workers-do-not-push` entry using
`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`, preserving inherited
entries. Override deploy credentials with dummy values if authorized. These guards
are bypassable and are not an isolation boundary or blanket network restriction.

## Allowance without roster

- Antigravity: spawn `agy` with `['--print','/usage','--output-format','json']`
  directly, without `--disable-slash-commands`. Read `command.data.groups` and
  compute `(1 - remaining_fraction) * 100` per bucket. Never collapse the Gemini
  and Claude/GPT groups. This is not a model turn; a shell/MSYS can corrupt `/usage`.
- Codex: inspect only session `rollout-*.jsonl` for the newest `rate_limits`, from
  the end in bounded chunks. Window minutes identify 5-hour vs weekly; some plans
  are weekly only. If stale, the documented app-server protocol supports
  `initialize`, then `initialized`, then `account/rateLimits/read` over stdio JSON
  messages. Stop only the temporary server you started; do not print raw sign-in
  responses or read credentials to make this work.
- Claude: use a supplied dashboard reading, or an already-authorized status-line
  cache. Status-line stdin supplies `rate_limits.five_hour` and `.seven_day` with
  `used_percentage` and Unix-seconds `resets_at` after a response. Per-model weekly
  readings require the planner/dashboard. Do not install a hook without permission.
- Grok: subscription allowance is unknown. Sum reported turn-envelope tokens and
  `total_cost_usd` over 5 hours / 7 days as a rough local gauge; absent cost is
  unknown. Never send `grok -p /usage`; it calls the model. Persisted session spend
  from `grok usage` is not remaining allowance.

Record source and observation time, exclude signed-out workers, and disclose
unknown/stale readings. Prefer the catalog order unless allowance constraints
justify another eligible candidate. Cross-review must use a different underlying
family, even when a model is hosted through another CLI.
