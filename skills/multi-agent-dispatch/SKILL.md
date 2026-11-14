---
name: multi-agent-dispatch
description: Dispatch coding work across provider CLIs using a portable model catalog, allowance-aware selection, resumable workers, and independent final gate reviews; works with or without roster installed.
---

# Multi-agent dispatch

**Catalog: last verified 2026-11-14 by Claude Opus 5.5 (planner session), partial re-check of the Antigravity lineup on the owner's request; other providers carried over from 2026-11-12**
Next check: 2026-11-29 (verified + 15 days).

Before you dispatch anything, compare today's date with the date above. If the catalog is more than 15 days old, or the user asks you to re-check, do the model check first: follow [references/model-check-brief.md](references/model-check-brief.md), handing web research to the eligible provider with the most allowance left.
Verify every model ID against an installed CLI list or an opened vendor page; open the pages behind any claim that changes allocation. Include the previous catalog and report what changed.
Update [references/model-catalog.json](references/model-catalog.json), then run `roster catalog set <file.json>`. Without roster, edit the JSON and marked tables by hand, including the date/by line and next-check date (verified + 15 days). Tell the user in a few lines what changed.
If you cannot check now (no web access or allowance), say so and continue with the old catalog, stating its age. If a CLI rejects a model ID or lists an ID absent here, treat the catalog as stale immediately.
Unknown tiers are null, context size 0 and release null mean unconfirmed. Read each costBasis: relativeAllowanceCost can be an API-price proxy or a neutral placeholder, not a measured subscription multiplier. Consult the JSON's evidence and notConfirmed fields; native Claude calls were intentionally not probed.

<!-- catalog:start -->
| Provider | Model / callable ID pattern | Efforts | Tier | Best for | Allowance group |
| --- | --- | --- | --- | --- | --- |
| claude | `claude-fable-5-2` | low / medium / high / xhigh / max | frontier | Hard design and long-horizon reasoning; Highest observed WebDev rank; reserve weekly Fable capacity | provider pool |
| claude | `claude-opus-5-5` | low / medium / high / xhigh / max | frontier | Second observed WebDev rank; lower list price than Fable; Cross-layer implementation and review | provider pool |
| claude | `claude-sonnet-5-5` | low / medium / high / xhigh / max | strong | Everyday implementation; Lower-cost UI and terminal work | provider pool |
| claude | `claude-haiku-5-5` | low / medium / high / xhigh / max | fast | cheap bulk edits; high-volume classification and subagent routing | provider pool |
| codex | `gpt-6-astra` | low / medium / high / xhigh / max | frontier | ambiguous multi-file backend architecture; high-end full-stack synthesis | provider pool |
| codex | `gpt-6.1-sol` | low / medium / high / xhigh / max | strong | server and backend implementation to a written spec; independent review and reproduction tests | provider pool |
| codex | `gpt-6.1-terra` | low / medium / high / xhigh / max | fast | routine test additions; mechanical refactors | provider pool |
| codex | `gpt-6-luna` | low / medium / high | fast | cheap bulk transforms; linting, string extraction, mechanical cleanup | provider pool |
| agy | `gemini-4-carbon-<effort>` | low / medium / high | frontier | Independent code/security review; Deep reasoning and grounded research | Gemini Models |
| agy | `gemini-4-argon-<effort>` | low / medium / high | strong | bounded backend and CLI implementation; secondary security/patch checks | Gemini Models |
| agy | `gemini-3.8-flash-<effort>` | low / medium / high | fast | Fast lookups and bounded edits; Low-latency mechanical work | Gemini Models |
| agy | `claude-opus-5-5-<effort>` | low / medium / high | frontier | Overflow implementation/review in separate third-party pool | Claude and GPT models |
| agy | `claude-sonnet-5-5-<effort>` | low / medium / high | strong | Overflow implementation/review in separate third-party pool | Claude and GPT models |
| agy | `gemini-4-hydrogen-<effort>` | low / medium / high / xhigh | fast / strong | Bounded implementation and test/fix loops at near Sonnet 5.5 / GPT-6.1 Sol level, faster and cheaper (Artificial Analysis Intelligence Index v5: 54 at xhigh, 51 at high, 41 medium, 27 low; Sol and Sonnet 55; Opus 5.5 59; Carbon 60; Fable 65); Executor half of the Orchestrator | Gemini Models |
| agy | `gemini-pro-orchestrator` | default | frontier | Long multi-step agent tasks: Carbon plans, Hydrogen executes | Gemini Models |
| agy | `gemini-pro-orchestrator-argon` | default | strong | Same as the Carbon orchestrator at lower cost: Argon plans, Hydrogen executes | Gemini Models |
| agy | `gpt-oss-120b-<effort>` | medium | unknown | Not confirmed | Claude and GPT models |
| grok | `grok-4.7` | low / medium / high / xhigh | frontier | Live web/X research; Cross-family review and implementation | provider pool |
| grok | `grok-4.7-build-fast` | low / medium / high / xhigh | frontier | Low-latency Grok coding on paid Build access | provider pool |
| grok | `grok-4.6` | low / medium / high / xhigh | strong | Legacy/secondary tasks when locally offered | provider pool |
| grok | `grok-4.5` | low / medium / high | strong | Legacy/secondary tasks when locally offered | provider pool |

**How to read what is left**
| Provider | Command or source | Windows |
| --- | --- | --- |
| claude | Status-line rate_limits cache, or supplied dashboard reading (per-model weekly: manual) | 5-hour / weekly / weekly:Fable |
| codex | Session-log rate_limits; stale/missing: app-server account/rateLimits/read | 5-hour / weekly |
| agy | agy --print /usage --output-format json (direct spawn; no model call) | weekly / 5-hour |
| grok | Unknown; local token/cost gauge | weekly |

| Work | First choice | Second choice |
| --- | --- | --- |
| hardest | `claude/claude-fable-5-2` (high) | `agy/gemini-4-carbon-high` (high) |
| ui | `claude/claude-fable-5-2` (high) | `claude/claude-opus-5-5` (high) |
| server | `codex/gpt-6.1-sol` (high) | `agy/gemini-4-hydrogen-xhigh` (xhigh) |
| tests | `codex/gpt-6.1-terra` (medium) | `agy/gemini-4-hydrogen-high` (high) |
| review | `agy/gemini-4-carbon-high` (high) | `codex/gpt-6.1-sol` (xhigh) |
| security | `agy/gemini-4-carbon-high` (high) | `codex/gpt-6.1-sol` (xhigh) |
| research | `agy/gemini-4-carbon-high` (high) | `grok/grok-4.7` (high) |
| bulk | `codex/gpt-6-luna` (low) | `claude/claude-haiku-5-5` (low) |
<!-- catalog:end -->

## Run with or without roster

For direct launch/resume templates, guarded modes and quota reading without the program, use [references/direct-cli-guide.md](references/direct-cli-guide.md); it travels with this folder.
With the program: `npm link` puts `roster` on PATH, or replace every invocation with `node <path>/bin/roster.mjs`. Run `roster catalog status`, `roster providers`, `roster usage --refresh`, then `roster pick --kind <kind> --json`. Unknown allowance is not unused allowance; check sign-in before dispatch.
With ONLY this folder: use the catalog's CLI, sign-in, model and allowance instructions directly. Probe `<cli> --help` before claiming a capability is unavailable. Start/resume using that CLI's documented flags; save conversation IDs and answers yourself. Use a native argument array for Antigravity `/usage`, without `--disable-slash-commands`; never send `grok -p /usage`. No roster installation is required to read, research or update this catalog.
Kinds are open strings: hardest, ui, server, tests (mechanical is an alias), review, security, research, bulk. User preferences override catalog allocation. Respect user authorization and budgets; do not silently expand access or paid work.

## Plan, brief and integrate

Use one planner to own acceptance and integration. Split independent work by files/modules with explicit ownership; keep shared-file integration with the planner. Assign one worker session per branch/worktree.
Project rules come from the project's own configuration or instructions and always win over the catalog. Never copy a project's rule into this skill.
Each brief states the goal, owned files, directory/branch, acceptance checks and forbidden mechanisms (for example no dependencies, schema changes, network, deployment, publication or test weakening). Environment guards are accident guards, not full enforcement.
Workers run the type check and relevant tests, fix failures until green, commit only on their branch, and report the commit plus exact checks. Never push, deploy or publish without the user's corresponding authorization.
With roster: `roster start worker-a --provider codex --brief brief.txt --worktree ../worker-a --branch worker/a --base HEAD`; inspect `status`, `wait`, `answer`, HEAD and diff. Resume via `roster send worker-a --message <text>` or `--message-file <path>`, after the prior turn ends. Turns default to a 60-minute limit; use `--timeout` to change it and inspect status output age for stalls.
Without roster, use separate worktrees and the provider CLI directly, with the same ownership and acceptance rules. Preserve IDs for resume. Verify actual results: background launch or a successful provider turn does not prove task completion, a commit, or passing tests.
Read every answer and diff before merging accepted commits. Do not run review rounds per branch. When an answer comes back complicated, simplify the requirement and remove unnecessary mechanisms before adding instructions or workers.

## One final gate, two independent providers at once

Freeze the integrated candidate commit and run one gate review concurrently with two different eligible model families in separate worktrees. Choose by current allowance and the catalog; if two eligible families are unavailable, state the limitation.
Use `roster pick --kind review --not-family <author>` for cross-review. Claude through Antigravity is still Claude, and GPT through Antigravity is still the Codex/OpenAI family; a different CLI alone is not independent review.
`roster review <author-session> --by <provider>` targets that session's branch. For an integrated candidate, start review sessions at the frozen commit with explicit review briefs, or launch the CLIs directly if roster is absent.
Require severity, file:line, concrete impact, and a test the reviewer writes and runs to prove each finding. Forbid implementation edits, author-file edits and commits; temporary reproduction tests belong only in the reviewer's worktree. Identify the exact reviewed commit.
Read both reports, reproduce actionable findings, fix confirmed defects, and rerun final acceptance checks. Report completed work, uncertain claims, limits and evidence accurately. Stop only owned worker processes; never kill by provider image name.
