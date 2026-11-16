# roster 0.1

One planner, several coding CLI workers, and allowance-aware dispatch. `roster`
starts detached turns, resumes the same conversations, records answers and token
counts, and recommends a provider with room left. It has zero runtime dependencies
and no build step. Requires Node.js 18+, Git, and separately installed provider CLIs.

Providers: Codex, Antigravity, Claude Code, and Grok Build. The portable skill
includes its own model catalog and research instructions, so it remains usable
without installing roster or cloning a particular target project.

Dual-licensed: AGPL-3.0-only ([LICENSE](LICENSE)) or a commercial licence from the
copyright holder. See [LICENSING.md](LICENSING.md). Contributions are accepted under
the [Contributor Licence Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install

Clone this repository, change into it, then either run `npm link` to make `roster`
available on PATH, or run `node /path/to/roster/bin/roster.mjs` directly. On Windows,
PowerShell, cmd, and Git Bash are supported. On Unix the entry point is executable.
`npm link` installs a local command; it does not publish a package. This package is
marked private to prevent accidental npm publication.

If Windows PowerShell blocks the generated `npm.ps1` or `roster.ps1` shim,
use `npm.cmd link` and `roster.cmd`, or the direct `node` invocation above.
No execution-policy change is needed.

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
roster start api --provider codex --brief brief.txt --worktree ../api-worker --branch worker/api --base HEAD
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
| `catalog show [--json]` | Read the catalog in roster's installed skill folder, or the configured skill folder. Works outside Git repositories too. |
| `catalog status [--json]` | Report verification date, age in days and next check. Exit 3 with one clear line if missing/invalid or older than `catalog.maxAgeDays`; exit 0 otherwise. |
| `catalog set <file.json>` | Validate before changing anything; archive the previous and incoming catalog, write the new JSON, regenerate the skill's marked tables and date lines, then sync the full skill copy. |
| `usage [--refresh]` | Show windows, percentage, resets, plan, source, reading age, staleness, learned limits, and local token gauges. Refresh bypasses the source cache. |
| `usage set <provider> --window <label> --used <0–100> --resets <ISO> [--plan <text>] [--group <id>]` | Record a dashboard/planner reading. Repeat complete window groups. Other saved windows are retained. Antigravity groups: `gemini` (default) or `third-party`; other providers use `default`. |
| `pick --kind <kind> [--not-family <provider>]` | Recommend a signed-in provider, model and effort using user preferences, the catalog and allowance. Kinds are open strings; mechanical aliases tests. Exit 1 if none qualify. |
| `start <name> --provider <p> --brief <file>` | Start in the background, returning a name and `running` state. Optional `--model`, `--effort`, `--dir`, `--access safe\|full`, and `--web`. |
| `start … --worktree <path> --branch <branch> [--base <ref>]` | Create a linked worktree and branch if absent; otherwise verify its branch. A supplied base must resolve to a commit and match an existing branch exactly; omit it to attach intentionally. New branches default to HEAD. Cannot combine with `--dir`. |
| `send <name> --message <file or text>` | Start a follow-up in the same conversation. An existing path is read as UTF-8; otherwise the argument is literal text. Refuse overlapping turns or a changed branch. |
| `status [name]` | Current state, error, provider/model/effort/access, turn, elapsed seconds, provider conversation ID, token counts, current HEAD, uncommitted file count, directory, and answer path. |
| `wait <name>... [--timeout 30m]` | Wait for named current turns. Exit 0 only when all are done; a failed turn or timeout exits 1. Timeout leaves workers running. Units: ms, s, m, h. |
| `answer <name> [--turn <n>]` | Read the latest or specified saved answer. |
| `stop <name>` | Ask the owning supervisor to terminate its live provider process tree. Follow with `wait` to observe `failed: stopped`. Never kills by image name or a PID taken from disk. |
| `review <name> --by <provider> [--model <m>] [--effort <e>] [--access safe\|full] [--brief <file>]` | Cross-family review of the clean, completed author branch. Defaults to the configured access and that provider's project/catalog review model, never inherits author access. Preflight sign-in, binary and model before creating a worktree. The brief requires severity, file:line and a reproduction test; forbids author edits and commits. |

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

Grok safe sessions use `--permission-mode default --sandbox workspace`, explicit
`--allow` rules for rooted edits, git add/commit and project check commands, plus
`--deny` rules for pushes and common deploy/publish commands. Its bundled guide
recommends `workspace` for coding; its separate automation advice recommends
always-approve, which roster deliberately does not enable for safe access.
Other default-mode headless calls may still be denied/cancelled. Configure project
check commands with `providers.grok.testCommands`; defaults include `node --test`,
`npm test`, and package scripts named test/check/typecheck/lint/build. No catch-all
Bash grant is added. Test scripts can themselves run arbitrary project code.
The guide documents
kernel sandbox enforcement on Linux/macOS only, and warns that unsupported
built-in profiles may continue unenforced; **do not assume Windows isolation**.
Grok full sessions explicitly use `bypassPermissions` and sandbox `off`. Both
modes retain roster's child-environment guards. Without `--web`, Grok also receives
`--disable-web-search`. Grok creates a chosen UUID up front and resumes with `-r`;
prompts use `--prompt-file`, so spaces and long briefs are not shell arguments.

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
not enforce a network ban for Codex or Claude. Pass `--web` when the research brief
requires web access; a catalog preference alone does not grant it.

## Usage and selection

Codex reads only `rollout-*.jsonl` under `~/.codex/sessions`, newest modified
files first, lines from the end in 64 KiB chunks. It skips malformed/truncated and
oversized lines (over 4 MiB), symlinks, unrelated limits, and files/directories
whose names suggest secret storage. It extracts the most recent `rate_limits`
event in the first file containing one. Window duration determines the label,
so primary/secondary can swap. Credits and plan are preserved. `readAt` is the
scan time, `observedAt` the event timestamp (file mtime when absent).
`CODEX_HOME` overrides `~/.codex`; unrelated log lines are skipped before parsing.

If the file reading is missing or older than `usage.sourceMaxAgeMinutes`, the
same Codex adapter starts a temporary `codex app-server --stdio`, initializes
the connection, calls only `account/rateLimits/read`, then stops that server.
Its camelCase window, plan, and credit fields are normalized. If this fallback
fails, the stale file evidence is retained and labeled. Some plans have only a
weekly window (verified on this PC); others have both 5-hour and weekly windows.
See the [OpenAI app-server protocol](https://developers.openai.com/codex/app-server).

Antigravity runs `agy --print /usage --output-format json`, a built-in command
with no model turn. It converts **remaining** fractions into percentages used:
`usedPercent = (1 - remaining_fraction) * 100`. The binary is spawned directly
with an argument array, avoiding Git Bash/MSYS conversion of `/usage` into a path.
This call never passes `--disable-slash-commands`; ordinary worker turns still do.
Worker briefs use the documented NDJSON stdin transport (`--input-format stream-json`
and `--output-format stream-json`), avoiding Windows command-line length limits.
The raw stream is saved; the terminal `result` event supplies the envelope.
See [Antigravity headless mode](https://antigravity.google/docs/cli/headless/).

Allowance JSON is `provider -> groups[] -> windows[]`:

| Provider | Group ID | Matching model prefixes |
| --- | --- | --- |
| codex | `default` | All Codex models |
| agy | `gemini` | `gemini-*` (Gemini Models) |
| agy | `third-party` | `claude-*`, `gpt-*` (Claude and GPT models) |
| claude | `default` | All native Claude models; manually supplied model windows can narrow this |

An unmapped Antigravity model has unknown allowance; it never borrows a different
group's reading. Catalog allocations can include Claude models through
Antigravity as separate candidates. Group allowances, limits, and local token
gauges stay separate. Native Claude allowance is not Antigravity Claude allowance.

Claude reads only `~/.roster/claude-usage.json`, written by the optional script
below. Its documented status-line input has `rate_limits.five_hour` and
`rate_limits.seven_day` for subscriptions, after the first response; each window
can be absent. Per-model weekly limits are not available there. The tool does
**not** use the undocumented OAuth usage endpoint, provider credential stores,
or browser cookie stores. See [Claude's status-line documentation](https://code.claude.com/docs/en/statusline).

All providers accept `usage set`. Windows merge individually: a newer automatic
observation replaces the same label, while a supplied `weekly:opus` window remains
alongside automatic general windows. Model labels constrain only matching models
(including tier aliases such as `opus` / `claude-opus-*`). Supplied windows retain
their own timestamps and become stale after 30 minutes by default. Expired windows
stay visible but are excluded from comparisons; no zero-percent reset is invented.
Stale non-expired readings remain conservative inputs. Unknown stays explicit.

Every source, supplied reading and cache must validate completely: nonempty string
labels unique within each group, finite percentages from 0 to 100, positive window
durations when present, and reset instants in 2000–2099. Unix reset values must be
seconds, not milliseconds. A malformed reading makes that provider unknown with
a reason; valid buckets cannot conceal an invalid one. Corrupt session files are
reported individually by status and skipped by local token/cost gauges.

Failed Antigravity turns with exit 3 and `AGY_ERROR` JSON are parsed for 429 /
`RESOURCE_EXHAUSTED`, short message, and optional `Resets in 1h1m35s` text. Missing
reset text remains unknown. Learned limits affect only the turn's model group.
They clear after a reported reset, a later successful turn in that group, or a
newer supplied reading below the ceiling with a future reset. Legacy receipts
without model/group information conservatively apply to the whole provider.
Local token gauges exclude work outside roster and are **not** subscription
percentages or interchangeable billing units. `--refresh` bypasses the source
cache and can perform the quota commands above, but never starts an inference turn.

`pick` follows a project rule when present, otherwise the catalog allocation.
For a kind absent from both, it selects the signed-in eligible provider with the
most known allowance left. No per-kind provider order is hard-coded. It drops missing
providers, group limits, any applicable non-expired window **at or above 90%**, and
the excluded provider/underlying family. Claude through Antigravity is in the
Claude family; GPT through Antigravity is in the Codex/OpenAI family. The first eligible choice wins unless its tightest percentage
is more than 25 points above the least-full known candidate. An unknown catalog
leader yields to a known candidate with room; a project rule retains its unknown
leader and the explanation says so. Unknown values never masquerade as 0%.
Models missing from a successful live model list are excluded. JSON includes
candidates, per-window numbers and rejection reasons.

Every adapter also implements `authState()` without inference. Codex uses
`login status`, Claude uses `auth status --json`, Antigravity uses its successful
built-in `/usage` response, and Grok parses the signed-in/signed-out banner from
`models`. Roster returns only the state and sign-in command, never raw sign-in
diagnostics or identity fields. `providers` shows authentication separately from
installation. `pick` requires **signed in**; signed-out and unknown-auth candidates
are excluded. No credential or cookie files are opened by these readers.

Grok has no headless subscription-allowance command. **Never send `grok -p /usage`:**
it is an inference prompt. `grok usage` concerns persisted session spend, not
remaining plan allowance. Roster instead sums reported turn tokens and
`total_cost_usd` in 5-hour/7-day gauges and learns quota errors. Missing or partial
cost is unknown, not zero; JSON reports counted and unreported turns separately.
Max-turn failures remain failed and preserve any reported spend, but are not
misclassified as quota exhaustion. No Grok cost is inferred from token prices.

### Portable model catalog and freshness

The source of truth is
`skills/multi-agent-dispatch/references/model-catalog.json`. SKILL.md prominently
states its last verification date/by and next-check date, followed by generated
model/allowance tables and the first two choices for each work kind. The original
provisional inventory is preserved in history. The current catalog applies the
supplied research's allocation-relevant fact-check corrections and records local
ID acceptance. Null tier/release and context size 0 mean unconfirmed. `costBasis`
distinguishes API-price proxies from actual subscription burn; 1 can be a neutral
placeholder. Effort variants share one generated model row and an ID pattern.

Before dispatch, the skill tells the agent to compare today's date, research
first when older than 15 days or when asked, and follow
`references/model-check-brief.md`. It routes research to the eligible provider
with most allowance, requires exact ID verification and opening sources behind
allocation changes, includes the previous catalog, and reports changes. If the
check cannot run, it instructs the agent to disclose the reason and catalog age
before continuing. Rejected model IDs and newly listed IDs make the catalog stale.

The skill alone contains everything needed for direct CLI dispatch and manual
catalog/table/date updates. With roster, `catalog set` handles validation, dated
history in `references/catalog-history/`, table/date generation, and full-folder
sync. Both trees are validated and staged before directory swaps; ordinary errors
roll both back, including history. A crash between swaps is not a filesystem-wide
transaction. If rollback itself fails, the error identifies retained backups for
recovery; do not discard those directories without inspecting them.
The skill is kept under 160 lines; research detail stays in the reference brief.
`references/direct-cli-guide.md` supplies launch/resume templates and allowance
reading instructions when this folder is installed without the program.

`pick` uses explicit project `kinds`, then catalog `allocation`, then available
allowance, and warns on a stale/missing catalog. `init` leaves `kinds` absent so
future catalog updates can take effect; existing explicit kinds continue to win.
A project list replaces the whole catalog list for that kind, including an empty
list. If no listed candidate is eligible, pick exits nonzero with a `project rule`
explanation and never escapes to another provider. Project policy belongs only in
the consuming project's config or instructions, never in the generic skill.
Kinds are open strings, including `hardest`, `ui`, `server`, `tests`, `review`,
`security`, `research`, and `bulk`; `mechanical` aliases `tests`. Catalog allocation
remains a preference and allowance comparison can rebalance the choice.

`providers`, `usage`, and `pick` warn when a successful signed-in model listing
has added or omitted catalog IDs. An unavailable model-list command is not proof
of retirement: native Claude/Codex IDs in the initial inventory include the
owner-supplied CLI inventory and cannot be independently checked by their simple
help/model-list interface. The JSON records these limits under `notConfirmed`.
`catalog status` reports date freshness; live model drift is reported separately.
Repository configuration never rewrites the installed skill automatically.

### Optional Claude status-line cache

Manually add this one line to Claude Code's settings, substituting the clone path:

```json
"statusLine": { "type": "command", "command": "node \"/path/to/roster/scripts/claude-statusline-cache.mjs\"" }
```

On Windows use an absolute path with forward slashes, for example
`C:/tools/roster/scripts/claude-statusline-cache.mjs`. Roster never edits Claude
settings and does not install this hook. The script writes only the documented
two rate-limit windows and a timestamp, atomically; it never saves the full stdin
payload. Before a response supplies limits, the previous cache is left intact,
with its original age. Without a usable cache or manual reading, usage is unknown.

To keep an existing status line, append its executable and arguments after `--`:

```json
"statusLine": { "type": "command", "command": "node \"/path/to/roster/scripts/claude-statusline-cache.mjs\" -- node \"/path/to/existing-status.mjs\"" }
```

The existing command receives identical stdin and supplies the displayed output.
Arguments are spawned directly, without a shell; shell expressions require an
explicit shell executable chosen by the user. Generic usage appears when there
is no pass-through command. Record per-model weekly limits with, for example,
`roster usage set claude --window weekly:opus --used 85 --resets 2026-11-14T14:00:00Z`.

### Optional external source

`usage.externalCommand` is an opt-in executable/argument array, default `null`.
If configured, roster runs it once per source-cache interval, directly without
a shell, and maps its JSON allowance rows. An example external tool is
[Win-CodexBar](https://github.com/nesszer/Win-CodexBar); it is **not bundled or
recommended**, and roster does not invoke it by default:

```json
"usage": { "externalCommand": ["codexbar-cli", "usage", "-p", "all", "-f", "json"] }
```

External programs choose their own data-access methods, possibly including
credential/cookie stores or undocumented endpoints. This is an explicit user
choice, separate from roster's built-in readers. Do not configure an external
program whose behavior you have not accepted. No external usage command was
installed or run on this PC for verification.

Supported JSON is an array (or `{ "providers": [...] }`) of provider rows with
either roster-style `groups[].windows[]`, or CodexBar-style
`usage.primary/secondary/tertiary` containing `usedPercent`, `windowMinutes`, and
`resetsAt`. Win-CodexBar's `used_percent`, `window_minutes`, `resets_at`,
`updated_at`, and `login_method` are also mapped; informational windows are ignored.
The fixture follows its [window serialization](https://github.com/nesszer/Win-CodexBar/blob/main/rust/src/core/rate_window.rs)
and [usage serialization](https://github.com/nesszer/Win-CodexBar/blob/main/rust/src/core/usage_snapshot.rs).
Provider `antigravity` maps to `agy`. Only normalized allowance fields
are cached; opaque identities and other fields are discarded. A flat Antigravity
row applies to Gemini only; use explicit groups for its third-party allowance.
Multiple rows for one provider are ambiguous and rejected, so select one account
in the external command. Failed/missing external readings fall back to the built-in
reader. Timeout is controlled by `usage.externalTimeoutMs` (15000 by default).

## Configuration

`roster init` writes defaults as editable JSON; every field is optional.
`~/.roster/config.json` supplies personal settings below the nearest project
configuration (`ROSTER_HOME` can override that home directory). Nested objects
merge; arrays replace. Relative binary paths resolve from the config file's
directory, and `~` expands to the home folder.

| Field | Default / meaning |
| --- | --- |
| `providers.<codex\|agy\|claude\|grok>.path` | Personal or project executable path; `binary` remains a supported alias. Configured paths win, then PATH, then documented user install locations. Use a native executable or .js/.mjs/.cjs entry point. |
| `providers.<p>.model`, `.effort` | codex: `gpt-6.1-sol`, low; agy: `gemini-3.8-flash-low`, low; claude: `claude-sonnet-5-5`, medium; grok: `grok-4.7-build-fast`, low. Used when start flags are absent. |
| `access` | `safe`; session metadata preserves this choice for follow-ups. |
| `guards.blockPush` | `true`; child environment override for origin pushes. |
| `guards.env` | Map of environment names to replacement strings. Set to `false` to disable overrides; set an entry to `null` to remove that variable from the child. Use dummy values, never secrets in shared config. |
| `guards.antigravityDeny` | `true`; false disables the entire extra deny list, including web denies. |
| `briefHeader` | Executor rules: assigned directory/branch only; never push, deploy or publish; run type check/tests until green; never weaken tests. Replace with text as needed. |
| `kinds.<kind>` | Optional project rule: ordered `{provider, model, effort, web?}` entries replacing catalog choices for that kind. No per-kind order is shipped in code or example config. |
| `usage.ceiling` | 90; at-or-above excludes a provider. |
| `usage.balancePoints` | 25; strictly greater gap allows rebalancing. |
| `usage.suppliedMaxAgeMinutes` | 30; age limit for dashboard/planner readings. |
| `usage.sourceMaxAgeMinutes` | 30; age limit for automatic observations. |
| `usage.cacheSeconds` | 30; cached automatic source lifetime. `--refresh` bypasses it. |
| `usage.externalCommand` | `null`; optional executable/argument array providing external allowance JSON. |
| `usage.externalTimeoutMs` | 15000; external-command time limit. |
| `catalog.path` | `null`; use the installed repository's skill. Override with an external skill folder or its `references/model-catalog.json`. Relative paths resolve from the controlling repository (cwd outside Git for catalog commands). |
| `catalog.maxAgeDays` | 15; status exits 3 when age is strictly greater. The skill's normal next-check cadence remains verified date + 15 days. |

Discovery walks upward from cwd to the Git repository root and uses the nearest
`roster.config.json`. `--config <path>` before or after the command overrides
discovery. Unknown top-level metadata such as `_comment` is tolerated. This is
only a commented example for a consuming project's own config:

```jsonc
// Example local rule; never copy it into the generic skill.
{ "kinds": { "ui": [{ "provider": "claude", "model": "claude-opus-5-5", "effort": "high" }] } }
```

Antigravity discovery checks `%LOCALAPPDATA%/agy/bin/agy.exe` on Windows and
`~/.local/bin/agy` on macOS/Linux after PATH. Grok checks `~/.grok/bin/grok.exe`
on Windows or `~/.grok/bin/grok` on macOS/Linux. Missing installations report the
paths searched. See the vendors' [Antigravity installation guide](https://antigravity.google/docs/getting-started?tab=cli)
and [Grok installer](https://x.ai/cli/install.sh).

Model and effort are normalized before launch. A suffixed Antigravity ID such as
`gemini-4-carbon-high` supplies `high` when `--effort` is absent; explicit conflicting
effort fails immediately. A base family plus `--effort high` resolves to the offered
suffixed ID. Known catalog effort restrictions also apply to Codex, Claude
(including tier aliases), and Grok. `pick` emits the same normalized pair accepted
by `start`, rather than mixing a requested model with a provider's default effort.

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
    child.json  control.jsonl
    settings.json  stop.json
```

The last two files are created only when needed. JSON providers store their
raw envelope in `events.jsonl`; Codex and Antigravity store event streams. Keep `.roster`
private: prompts, outputs and errors can contain sensitive work. Config is meant
to be shareable; session state is ignored. No inherited environment dump is saved.

A detached Node supervisor owns each child and emits heartbeat/result files.
Provider processes are detached on Windows too, isolating their consoles from the
supervisor. Atomic JSON replacement prevents partial reads. Per-session locks
reject concurrent mutations. Complete ownership records (PID, creation time,
nonce) are published with exclusive hard links; recovery claims are immutable
per generation so an old recovery cannot remove a newer lock. This requires a
filesystem with hard-link support; unsupported filesystems fail closed. Old
directory locks and abandoned private temporary files do not block new locks.
State defaults to `<repo>/.roster`; `ROSTER_STATE_DIR`
overrides the entire state directory. No heartbeat-age threshold kills a worker.
When a heartbeat is stale, status verifies the supervisor PID and creation time
before declaring it interrupted. Dead ownership/reboots can yield `failed:
interrupted`; a delayed heartbeat with a live matching identity remains running.
Control-file I/O errors are audited and retried, not converted into a stop.

Stop requests carry the turn nonce and requester/time. The supervisor signals only
its live ChildProcess registered at spawn, after verifying PID plus OS creation
time. Neither stop nor recovery signals a PID merely read from disk. `child.json`
records ownership and `control.jsonl` distinguishes explicit stops, signals and I/O
errors. Unsolicited console SIGINT is recorded and ignored; SIGTERM is classified
as interruption, not an explicit stop. Old records without identity proof cannot
be signalled by stop. Supervisor death can still leave descendants behind.
On Unix stop signals the owned provider group; on Windows it uses
`taskkill /PID <verified-live-child> /T /F`.
Processes that deliberately detach from that tree/group can escape termination.

`done` means the CLI reported a successful turn, not that its answer is correct,
its tests passed, or it committed. Verify the answer, HEAD, and diff. Roster never
promotes a refusal or an unsupported claim into task completion evidence.

## Development and adding a provider

Run `node --test` (or `npm test`). Tests use fake Node executables and fixture
logs, temporary Git repositories and a temporary home; they never call a real
provider or the network. Helpers are inert if discovered directly by Node's test
runner. Windows is verified locally; macOS/Linux require independent execution.
Every test bootstraps a temporary `ROSTER_STATE_DIR`, `ROSTER_HOME`, provider home
and app-data folders, also propagated to its Node children. A filesystem guard
fails any attempt to access real `.roster` state; a provider guard refuses real
CLI executables. Nested suite runs create independent isolation roots. Tests use
authenticated test-only abort requests rather than signalling PIDs from fixtures.
A managed fake worker runs the stop/recovery subset of this suite in the actual
source repository, proving that its child tests do not stop their parent session.

Add one adapter in `src/adapters/` with `build`, `parse`, and `readUsage`. `build`
returns an argument array and whether the prompt goes on stdin. `parse` returns
conversation ID, answer, normalized usage, `ok`, and optional error/details.
`readUsage` returns `{groups: [{id, name, windows}], plan, credits?, source, readAt}` or
`{unknown: true, reason}`; a new quota source is a replacement for that function.
Optional `modelsArgs`/`parseModels` expose model discovery. Register it in the
adapter index and provider/config lists, add fake-binary lifecycle/error tests,
and document its access policy. No launcher rewrite should be needed.

The reusable planning workflow is [skills/multi-agent-dispatch/SKILL.md](skills/multi-agent-dispatch/SKILL.md).

## Agent skill and plugin packaging

The canonical Agent Skills directory is `skills/multi-agent-dispatch/`.
`npm run sync-skill` copies its entire folder, including references and catalog
history, to `.agents/skills/multi-agent-dispatch/` for Codex and Antigravity repository
discovery, without a Windows symlink. A test fails if these files differ. Edit the
canonical folder, then sync; the copy is committed for fresh clones. Agent skills
do not install the CLI: use `npm link`, or `node <path>/bin/roster.mjs`.

Claude Code has `.claude-plugin/plugin.json` and a one-plugin marketplace at
`.claude-plugin/marketplace.json`. Use the local clone without a remote URL:

```text
claude plugin marketplace add /path/to/roster
claude plugin install roster@roster-plugins
```

After the owner publishes a repository, a user could instead use
`/plugin install roster --marketplace <owner>/<repo>` in Claude Code. No remote
URL is embedded or assumed, and this work does not publish anything. Antigravity's
root `plugin.json` declares `skills: "./skills"`; after a repository exists its
documented install form is `agy plugin install <repo url>`. Its installed CLI
validated this manifest and discovered one skill. The local Claude CLI validated
both manifests in strict mode with zero errors or warnings. Only confirmed fields
are included; no optional unconfirmed manifest fields were added.

### Not verified

No plugin was installed in a user's profile and no remote installation was tried.
Codex/Antigravity automatic discovery and Claude's runtime skill activation have
not been exercised in a fresh agent session; packaging copies and local manifest
validation are verified. The Claude status-line hook was **not installed on this
PC**: cache writes, absent windows, stale age, and pass-through were tested only
with fixtures in temporary homes. An actual Claude callback is unverified.
Win-CodexBar integration is tested against mapped fixtures and its public Rust
serialization, not a live installation. macOS/Linux, live reboot, and real-provider
full access remain unverified.

The current catalog records which research claims were fact-checked, which IDs
were accepted locally, and what remains open. Native Claude calls were skipped;
Fable's documented minimum CLI version exceeds the installed version. Hydrogen's
overall tier and subscription allowance multiplier remain unconfirmed. API-price
ratios are not measured subscription burn, and user reports are labeled anecdotal.

## Real smoke evidence

The usage follow-up on Windows verified live Antigravity `/usage` group readings,
fresh Codex session-file readings, and a separate app-server quota probe that
completed and stopped cleanly. The requested human `providers`, `usage`, and
server/ui/cross-review picks were run with Antigravity's installed bin directory
added to that shell's PATH. Shared configuration contains no machine-specific
binary paths. Claude remained unknown because no hook or manual reading was
installed on this PC.

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

Grok Build 1.0.41 was smoke-tested separately with `grok-4.7-build-fast`, safe
access, and a chosen session UUID. A preflight with effort `none` failed before
inference: `unknown effort level 'none'; use one of: xhigh, high, medium, low`.
The default and seed catalog now use the measured minimum, `low`. With low effort,
the initial turn and resumed follow-up both ended `cancelled` (empty stderr).
No `hello.txt` or task commit was created. Initial answer:
`I'll create hello.txt with the word roster, commit it on main, and run the project's type check and tests until they pass.`
The follow-up stated that the previous command was cancelled before any file was
written and it would check the directory. The session IDs matched; reported costs
were USD 0.03112088 and 0.00909024. Roster correctly marked both turns failed.
The reason for cancellation was not confirmed; safe access was not escalated.

The next repair verified the permission cause with three Grok calls at low effort:
one full-access hello task, one guarded hello task with explicit file/git/check
allows, and one guarded resume. Both tasks created and committed `hello.txt` and
passed the scratch project's checks; the guarded resume answered `hello.txt`.
Cancelled envelopes now report `failed: cancelled (permission?)`, including when
the CLI exits nonzero. The guarded mode retains push/deploy denies and environment
guards; Windows kernel sandbox enforcement is still not claimed.

The live Antigravity model list also added `gemini-4-hydrogen-*` variants after the
initial inventory was seeded. The new drift checks reported these uncatalogued
IDs in providers, usage and picks. A current verification date does not resolve
that warning; the instructed online model check must confirm their capabilities
before changing the catalog/allocation.

## Licence

Copyright (c) 2026 Louis Hsu. roster is available under the GNU Affero General
Public License v3.0 only, or under a separate commercial licence. See
[LICENSING.md](LICENSING.md).
