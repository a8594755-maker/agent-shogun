---
name: multi-agent-dispatch
description: Dispatch coding work across provider CLIs using a portable model catalog, allowance-aware selection, resumable workers, and independent final gate reviews; works with or without roster installed.
---

# Multi-agent dispatch

**Catalog: last verified 2026-11-12 by initial, from the CLIs' own model lists; capability and allocation not yet verified online**
Next check: 2026-11-27 (verified + 15 days).

Before you dispatch anything, compare today's date with the date above. If the catalog is more than 15 days old, or the user asks you to re-check, do the model check first: follow [references/model-check-brief.md](references/model-check-brief.md), handing web research to the eligible provider with the most allowance left.
Verify every model ID against an installed CLI list or an opened vendor page; open the pages behind any claim that changes allocation. Include the previous catalog and report what changed.
Update [references/model-catalog.json](references/model-catalog.json), then run `roster catalog set <file.json>`. Without roster, edit the JSON and marked tables by hand, including the date/by line and next-check date (verified + 15 days). Tell the user in a few lines what changed.
If you cannot check now (no web access or allowance), say so and continue with the old catalog, stating its age. If a CLI rejects a model ID or lists an ID absent here, treat the catalog as stale immediately.
Initial `?` tiers, best-for suggestions and allocation are provisional. Context size 0, release null and allowance cost 1 mean not confirmed; they are not measured capacity or cost claims. Consult the JSON's evidence and notConfirmed fields.

<!-- catalog:start -->
| Provider | Callable model ID | Tier | Best for |
| --- | --- | --- | --- |
| claude | `claude-fable-5-2` | strong? | Provisional: general coding |
| claude | `claude-opus-5-5` | frontier? | Provisional: hard design/review |
| claude | `claude-sonnet-5-5` | strong? | Provisional: UI/implementation |
| claude | `claude-haiku-5-5` | fast? | Provisional: cheap bulk/tests |
| codex | `gpt-6.1-sol` | strong? | Provisional: server/tests |
| codex | `gpt-6-astra` | frontier? | Provisional: design/debugging |
| agy | `gemini-4-carbon-low` | strong? | Provisional: research/implementation |
| agy | `gemini-4-carbon-medium` | strong? | Provisional: research/implementation |
| agy | `gemini-4-carbon-high` | strong? | Provisional: research/implementation |
| agy | `gemini-4-argon-low` | strong? | Provisional: research/implementation |
| agy | `gemini-4-argon-medium` | strong? | Provisional: research/implementation |
| agy | `gemini-4-argon-high` | strong? | Provisional: research/implementation |
| agy | `gemini-3.8-flash-low` | fast? | Provisional: research/implementation |
| agy | `gemini-3.8-flash-medium` | fast? | Provisional: research/implementation |
| agy | `gemini-3.8-flash-high` | fast? | Provisional: research/implementation |
| agy | `claude-opus-5-5-low` | frontier? | Provisional: review/UI |
| agy | `claude-opus-5-5-medium` | frontier? | Provisional: review/UI |
| agy | `claude-opus-5-5-high` | frontier? | Provisional: review/UI |
| agy | `claude-sonnet-5-5-low` | strong? | Provisional: review/UI |
| agy | `claude-sonnet-5-5-medium` | strong? | Provisional: review/UI |
| agy | `claude-sonnet-5-5-high` | strong? | Provisional: review/UI |
| agy | `gpt-oss-120b-medium` | strong? | Provisional: general coding |
| agy | `gemini-pro-orchestrator` | strong? | Provisional: research/planning |
| grok | `grok-4.7` | frontier? | Provisional: general coding |
| grok | `grok-4.7-build-fast` | fast? | Provisional: cheap coding/tests |
| grok | `grok-4.6` | strong? | Provisional: general coding |
| grok | `grok-4.5` | strong? | Provisional: general coding |

| Provider | Remaining allowance |
| --- | --- |
| claude | roster usage; without roster: optional status-line cache or manual dashboard reading |
| codex | roster usage; without roster: session-log rate_limits, or app-server account/rateLimits/read |
| agy | agy --print /usage --output-format json (direct binary; remaining fractions, two separate groups) |
| grok | Unknown; local turn token/cost gauge only |

| Work | First choice | Second choice |
| --- | --- | --- |
| hardest | `codex/gpt-6-astra` (high) | `claude/claude-opus-5-5` (high) |
| ui | `claude/claude-sonnet-5-5` (medium) | `agy/claude-sonnet-5-5-low` (low) |
| server | `codex/gpt-6.1-sol` (medium) | `grok/grok-4.7-build-fast` (low) |
| tests | `codex/gpt-6.1-sol` (low) | `grok/grok-4.7-build-fast` (low) |
| review | `agy/gemini-4-carbon-high` (high) | `codex/gpt-6-astra` (high) |
| security | `codex/gpt-6-astra` (high) | `claude/claude-opus-5-5` (high) |
| research | `agy/gemini-3.8-flash-low` (low) | `grok/grok-4.7-build-fast` (low) |
| bulk | `grok/grok-4.7-build-fast` (low) | `claude/claude-haiku-5-5` (low) |
<!-- catalog:end -->

## Run with or without roster

With the program: `npm link` puts `roster` on PATH, or replace every invocation with `node <path>/bin/roster.mjs`. Run `roster catalog status`, `roster providers`, `roster usage --refresh`, then `roster pick --kind <kind> --json`. Unknown allowance is not unused allowance; check sign-in before dispatch.
With ONLY this folder: use the catalog's CLI, sign-in, model and allowance instructions directly. Probe `<cli> --help` before claiming a capability is unavailable. Start/resume using that CLI's documented flags; save conversation IDs and answers yourself. Use a native argument array for Antigravity `/usage`, without `--disable-slash-commands`; never send `grok -p /usage`. No roster installation is required to read, research or update this catalog.
Kinds are open strings: hardest, ui, server, tests (mechanical is an alias), review, security, research, bulk. User preferences override catalog allocation. Respect user authorization and budgets; do not silently expand access or paid work.

## Plan, brief and integrate

Use one planner to own acceptance and integration. Split independent work by files/modules with explicit ownership; keep shared-file integration with the planner. Assign one worker session per branch/worktree.
Each brief states the goal, owned files, directory/branch, acceptance checks and forbidden mechanisms (for example no dependencies, schema changes, network, deployment, publication or test weakening). Environment guards are accident guards, not full enforcement.
Workers run the type check and relevant tests, fix failures until green, commit only on their branch, and report the commit plus exact checks. Never push, deploy or publish without the user's corresponding authorization.
With roster: `roster start worker-a --provider codex --brief brief.txt --worktree ../worker-a --branch worker/a --base main`; inspect `status`, `wait`, `answer`, HEAD and diff. Resume via `roster send worker-a --message <file or text>`, after the prior turn ends.
Without roster, use separate worktrees and the provider CLI directly, with the same ownership and acceptance rules. Preserve IDs for resume. Verify actual results: background launch or a successful provider turn does not prove task completion, a commit, or passing tests.
Read every answer and diff before merging accepted commits. Do not run review rounds per branch. When an answer comes back complicated, simplify the requirement and remove unnecessary mechanisms before adding instructions or workers.

## One final gate, two independent providers at once

Freeze the integrated candidate commit and run one gate review concurrently with two different eligible model families in separate worktrees. Choose by current allowance and the catalog; if two eligible families are unavailable, state the limitation.
Use `roster pick --kind review --not-family <author>` for cross-review. Claude through Antigravity is still Claude, and GPT through Antigravity is still the Codex/OpenAI family; a different CLI alone is not independent review.
`roster review <author-session> --by <provider>` targets that session's branch. For an integrated candidate, start review sessions at the frozen commit with explicit review briefs, or launch the CLIs directly if roster is absent.
Require severity, file:line, concrete impact, and a test the reviewer writes and runs to prove each finding. Forbid implementation edits, author-file edits and commits; temporary reproduction tests belong only in the reviewer's worktree. Identify the exact reviewed commit.
Read both reports, reproduce actionable findings, fix confirmed defects, and rerun final acceptance checks. Report completed work, uncertain claims, limits and evidence accurately. Stop only owned worker processes; never kill by provider image name.
