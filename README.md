# roster 0.1

One planner, several coding CLI workers, and allowance-aware dispatch. `roster`
starts detached turns, resumes the same conversations, records answers and token
counts, and recommends a provider with room left. It has zero runtime dependencies
and no build step. Requires Node.js 18+, Git, and separately installed provider CLIs.

No licence has been selected yet. See [LICENSE-TODO.md](LICENSE-TODO.md).

## Install

Clone this repository, change into it, then either run `npm link` to make `roster`
available on PATH, or run `node /path/to/roster/bin/roster.mjs` directly. On Windows,
PowerShell, cmd, and Git Bash are supported. On Unix the entry point is executable.
`npm link` installs a local command; it does not publish a package. This package is
marked private to prevent accidental npm publication.

Run roster commands from a Git repository, including from its subdirectories.
State and configuration belong to that repository, even when a worker runs in a
different directory or linked worktree. Keep using the same controlling repository
for `send`, `status`, and `wait`.

## Five-minute walkthrough

```text
roster init
roster providers
roster usage --refresh
roster pick --kind server --json
```

Create `brief.txt` describing a small task, the files it owns, its acceptance
checks, and the mechanisms it must never use. Commit a baseline first if this is
a new repository. Substitute an installed provider and an available model below:

```text
roster start api --provider codex --brief brief.txt --worktree ../api-worker --branch worker/api --base main
roster status api
roster wait api --timeout 30m
roster answer api
roster send api --message "Explain the tests you ran."
roster wait api
roster answer api --turn 2
roster pick --kind review --not-family codex
roster review api --by agy
```

The review command returns a new session name. Wait for that name and inspect its
answer. Reviewers get separate detached worktrees; inspect their reproduction tests
there. Read the worker diff and tests yourself before merging. Roster never merges
or pushes for you. Worktrees, branches, logs, and sessions remain until you remove
them yourself; use `git worktree remove` when finished.

## Commands

Every command accepts `--json`; output is one JSON value, and errors are JSON on
stderr with exit code 1. Human output is a compact table, except `answer` prints
the answer and `pick` prints its explanation. `--help` lists the syntax. Quote paths
and text containing spaces in your shell. Arguments go through argument arrays,
never a shell assembled from user text. `--flag=value` is supported.

| Command | Behavior |
| --- | --- |
| `init` | Write `roster.config.json` if absent and add `.roster/` to `.gitignore`; preserve an existing config. |
| `providers` | Find binaries, probe `--version`, list models when a listing command exists. Missing CLIs do not break other providers. |
| `usage [--refresh]` | Show windows, percentage, resets, plan, source, reading age, staleness, learned limits, and local token gauges. Refresh bypasses the source cache. |
| `usage set <provider> --window <label> --used <0–100> --resets <ISO> [--plan <text>]` | Record a dashboard/planner reading. Repeat each complete `--window … --used … --resets …` group. Other saved windows are retained. |
| `pick --kind <ui\|server\|review\|mechanical\|research> [--not-family <provider>]` | Recommend provider, model, effort, and research web request with the numbers and exclusions used. Exit 1 if none qualify. |
| `start <name> --provider <p> --brief <file>` | Start in the background, returning a name and `running` state. Optional `--model`, `--effort`, `--dir`, `--access safe\|full`, and `--web`. |
| `start … --worktree <path> --branch <branch> [--base <ref>]` | Create a linked worktree and branch if absent; otherwise verify the existing worktree's branch. Base defaults to HEAD. Cannot combine with `--dir`. |
| `send <name> --message <file or text>` | Start a follow-up in the same conversation. An existing path is read as UTF-8; otherwise the argument is literal text. Refuse overlapping turns or a changed branch. |
| `status [name]` | Current state, error, provider/model/effort/access, turn, elapsed seconds, provider conversation ID, token counts, current HEAD, uncommitted file count, directory, and answer path. |
| `wait <name>... [--timeout 30m]` | Wait for named current turns. Exit 0 only when all are done; a failed turn or timeout exits 1. Timeout leaves workers running. Units: ms, s, m, h. |
| `answer <name> [--turn <n>]` | Read the latest or specified saved answer. |
| `stop <name>` | Ask the owning supervisor to terminate its live provider process tree. Follow with `wait` to observe `failed: stopped`. Never kills by image name or a PID taken from disk. |
| `review <name> --by <provider> [--brief <file>]` | Cross-family review of the clean, completed author branch at its current commit. The built-in brief requires severity, file:line, and a reproduction test for every finding; forbids edits to author files and commits. |

Example supplied readings:

```text
roster usage set claude --window weekly --used 85 --resets 2026-11-14T14:00:00Z --window weekly:model-x --used 88 --resets 2026-11-14T14:00:00Z
```

Names are unique within a controlling repository, 1–80 ASCII letters, digits,
underscores or hyphens. Start names with a letter or digit. Use a new name to start
a fresh conversation. Different sessions may share a directory, but roster does
not serialize their file edits: assign one worker per branch/worktree.

## Access and guards

The default is **safe**. Codex starts with `--approve-for-me`, without `-s`.
Resume uses that flag at the top CLI level because `exec resume` does not expose
it. Antigravity uses `toolPermission: always-proceed`, its terminal sandbox,
`allowNonWorkspaceAccess: false`, `--mode accept-edits`, and the deny list below.
Claude uses `--permission-mode acceptEdits`; commands that require approval may
be denied or fail in print mode. Safe mode is each provider's own policy, not a
roster isolation boundary, and providers can change how it works.

**Full** must be chosen with `--access full` or `access` in config. Codex uses
`-s danger-full-access -c approval_policy="never"` (on resume the equivalent
`sandbox_mode` config). Claude uses `--permission-mode bypassPermissions`.
Antigravity disables its terminal sandbox and allows non-workspace access;
`always-proceed` accepts actions except those denied by its settings.

In **both** modes, by default:

- A child-only Git environment config overrides `remote.origin.pushurl` with
  `disabled://roster-do-not-push`. Inherited `GIT_CONFIG_*` entries are preserved.
- A configurable environment map overrides `CLOUDFLARE_API_TOKEN` with a dummy
  value, intended to make ordinary Cloudflare deploy commands fail.
- Antigravity settings deny pushes, merges, branch changes, resets, other
  destructive Git operations, common deploy/publish tools, gh/ssh/scp, and,
  without `--web`, curl/wget, URL tools, and MCP.
- Every turn includes the configured executor header plus assigned directory,
  branch, access, and requested web policy.

These are accident guards. They do **not** prevent an intentional worker from
overriding its environment, pushing to a different remote or explicit URL, using
another deployment mechanism, escaping a regex, or accessing secrets allowed by
its provider. Regex rules are interpreted by Antigravity and are not an exhaustive
command firewall. A dummy environment value is not a credential revocation.
The review restrictions are instructions plus a separate worktree, not an enforced
read-only sandbox. Inspect code before running an untrusted brief. Full mode can
access the host. Roster itself does not inspect provider authentication files or
dump the child's inherited environment; provider CLIs use their existing sign-in.

`--web` requests live search for Codex and removes Antigravity's web denies.
Claude uses its own available web tools and policy. Without `--web`, roster does
not enforce a network ban for Codex or Claude. Research picks include `web: true`;
pass `--web` when starting that recommendation.

## Usage and selection

Codex reads only `rollout-*.jsonl` under `~/.codex/sessions`, newest modified
files first, lines from the end in 64 KiB chunks. It skips malformed/truncated and
oversized lines (over 4 MiB), symlinks, unrelated limits, and files/directories
whose names suggest secret storage. It extracts the most recent `rate_limits`
event in the first file containing one. Window duration determines the label,
so primary/secondary can swap. Credits and plan are preserved. `readAt` is the
scan time, `observedAt` the event timestamp (file mtime when absent).

Antigravity has no known stable local allowance source. Claude accepts supplied
dashboard/planner readings and has no automatic local source. Both learn quota
errors from failed turns and show tokens from local roster receipts in the last
5 hours and 7 days. These gauges exclude work outside roster and are **not**
subscription percentages. Cached, input and output counts follow provider
reporting; they are not interchangeable billing units.

All providers accept `usage set`. The newest supplied reading or automatic
observation wins; supplied data wins when the automatic source is unknown.
Supplied windows retain their individual timestamps when another window is
updated. Readings become stale after 30 minutes by default. Expired windows stay
visible but are excluded from percentage comparison; no zero-percent reset is
invented. Stale, non-expired readings remain conservative inputs and are marked
stale. Unknown allowance stays explicitly unknown and remains eligible.

A learned limit remains until a later successful roster turn or a newer supplied
reading below the ceiling with future resets. It is not automatically cleared
after a guessed reset. `--refresh` rescans known local sources, without querying
provider billing APIs or starting an inference turn.

`pick` starts with the configured ordered preferences. It drops missing
providers, learned limits, any non-expired window **at or above 90%**, and the
excluded family. The first eligible choice wins unless its tightest percentage
is more than 25 points above the least-full known candidate. Unknown values
never masquerade as 0%. JSON includes candidates, per-window numbers and rejected
providers. The current model is a preference, not a promise of model availability.

## Configuration

`roster init` writes all defaults as editable JSON; every field is optional.
Nested objects merge with defaults; arrays replace them. Relative binary paths
resolve from the command's working directory; absolute paths are recommended.

| Field | Default / meaning |
| --- | --- |
| `providers.<codex\|agy\|claude>.binary` | Search PATH unless configured; use a native executable or .js/.mjs/.cjs entry point. Common npm shims resolve without invoking a shell; arbitrary shell wrappers require the underlying executable. |
| `providers.<p>.model`, `.effort` | codex: `gpt-6-astra`, low; agy: `gemini-3.8-flash-low`, low; claude: `sonnet`, medium. Used when start flags are absent. |
| `access` | `safe`; session metadata preserves this choice for follow-ups. |
| `guards.blockPush` | `true`; child environment override for origin pushes. |
| `guards.env` | Map of environment names to replacement strings. Set to `false` to disable overrides; set an entry to `null` to remove that variable from the child. Use dummy values, never secrets in shared config. |
| `guards.antigravityDeny` | `true`; false disables the entire extra deny list, including web denies. |
| `briefHeader` | Executor rules: assigned directory/branch only; never push, deploy or publish; run type check/tests until green; never weaken tests. Replace with text as needed. |
| `kinds.<kind>` | Ordered `{provider, model, effort, web?}` arrays. ui: claude, agy, codex; server: codex, claude, agy; mechanical: codex, agy, claude; review: agy, codex, claude; research: agy, claude, codex with web requested. |
| `usage.ceiling` | 90; at-or-above excludes a provider. |
| `usage.balancePoints` | 25; strictly greater gap allows rebalancing. |
| `usage.suppliedMaxAgeMinutes` | 30; age limit for dashboard/planner readings. |
| `usage.sourceMaxAgeMinutes` | 30; age limit for automatic observations. |
| `usage.cacheSeconds` | 30; cached automatic source lifetime. `--refresh` bypasses it. |

Provider versions are probed with `--version`. Antigravity exposes `models`;
the checked Codex and Claude CLIs have no model-list command, so roster labels
their configured model separately instead of inventing a catalogue. Missing
installation and unavailable model listing are separate states.

## State and recovery

```text
.roster/sessions/<name>/
  meta.json
  turns.jsonl
  turn-0001/
    prompt.txt  events.jsonl  answer.txt  stderr.txt
    request.json  running.json  heartbeat.json  result.json
    settings.json  stop.json
```

The last two files are created only when needed. JSON providers store their
single raw envelope in `events.jsonl`; Codex stores the event stream. Keep `.roster`
private: prompts, outputs and errors can contain sensitive work. Config is meant
to be shareable; session state is ignored. No inherited environment dump is saved.

A detached Node supervisor owns each child and emits heartbeat/result files.
Atomic JSON replacement prevents partial reads. Per-session locks reject
concurrent mutations and recover when their owner process is gone. Status uses
the result first; missing/dead ownership, a reboot, or a heartbeat missing for
15 seconds yields `failed: interrupted`. Actual reboot behavior is modeled in
tests; a live reboot is not part of the smoke check. Very long machine suspension
or severe event-loop starvation can also look interrupted. Do not use network
filesystems for state. Supervisor death can leave descendants behind; roster
deliberately refuses to kill unverified persisted PIDs. On Unix stop signals the
owned provider process group; on Windows it runs `taskkill /PID <live-child> /T /F`.
Processes that deliberately detach from that tree/group can escape termination.

`done` means the CLI reported a successful turn, not that its answer is correct,
its tests passed, or it committed. Verify the answer, HEAD, and diff. Roster never
promotes a refusal or an unsupported claim into task completion evidence.

## Development and adding a provider

Run `node --test` (or `npm test`). Tests use fake Node executables and fixture
logs, temporary Git repositories and a temporary home; they never call a real
provider or the network. Helpers are inert if discovered directly by Node's test
runner. Windows is verified locally; macOS/Linux require independent execution.

Add one adapter in `src/adapters/` with `build`, `parse`, and `readUsage`. `build`
returns an argument array and whether the prompt goes on stdin. `parse` returns
conversation ID, answer, normalized usage, `ok`, and optional error/details.
`readUsage` returns `{windows, plan, credits?, source, readAt}` or
`{unknown: true, reason}`; a new quota source is a replacement for that function.
Optional `modelsArgs`/`parseModels` expose model discovery. Register it in the
adapter index and provider/config lists, add fake-binary lifecycle/error tests,
and document its access policy. No launcher rewrite should be needed.

The reusable planning workflow is [skill/SKILL.md](skill/SKILL.md).

## Real smoke evidence

On Windows, 2026-11-12, one new conversation and one follow-up per provider were
run in temporary Git repositories using safe access. Codex CLI 0.167.0 with
`gpt-6-astra`, low effort, answered `DONE`, created a tracked `hello.txt` containing
`roster`, committed it, and resumed with `hello.txt`. Antigravity 1.5.7 with
`gemini-3.8-flash-low`, low effort, answered `DONE` followed by a newline, committed
the same file/content, and resumed with `hello.txt` followed by a newline. Neither
refused the task. Conversation IDs matched across each pair of turns.

Antigravity initially appeared failed because its real envelope used uppercase
`SUCCESS`. The adapter now normalizes case, with a regression fixture; both saved
envelopes were replayed locally and classified done, without another provider
call. Claude 2.1.296 was discovered and its help checked, but its real smoke turn
was intentionally skipped to conserve allowance. No live reboot, macOS/Linux run,
or real-provider full-access turn was performed. The guards were exercised offline;
they were not challenged with a real push or deployment.
