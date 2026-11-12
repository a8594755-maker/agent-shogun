---
name: multi-agent-dispatch
description: Use roster to dispatch coding work to multiple provider CLIs, balance subscription allowance, resume workers, and arrange a final cross-provider gate review when acting as the single planning agent.
---

# Dispatch with roster

Use one planner to own integration and acceptance. Workers own implementation,
tests, and commits within their assigned branches. Probe a CLI with `--help`,
`roster providers`, or a minimal local experiment before claiming it cannot do
something. Respect the user's permissions and resource budget.

## Choose work and providers

1. Inspect the repository, existing tests, and current changes. Split independent
   work by files or modules with explicit ownership. Avoid simultaneous writers
   to shared files. Give integration work to the planner.
2. Run `roster usage --refresh` and `roster providers`. Select each worker using
   `roster pick --kind <ui|server|review|mechanical|research> --json`.
   Inspect stale or unknown allowance and learned limits instead of assuming
   unknown means unused. Use `usage set` when a visible dashboard supplies a
   reading; include its window and reset time, never guess a percentage.
3. Assign one session to one branch/worktree. Keep all control commands in the
   controlling repository. Use `--web` for research when authorized. Default to
   safe access; use full access only when the user has authorized it.

## Brief and launch

Write a brief file with the goal, owned files, branch, acceptance checks, and
explicit forbidden mechanisms. State restrictions such as no dependency changes,
no network, no schema changes, or no test weakening when they matter. Roster's
environment guards are accident guards, not enforcement of every instruction.

Require the worker to run the type check and relevant tests, fix failures until
green, commit on its branch, and report its commit and exact validation results.
Forbid pushing, deployment, and publication. Include enough context to work
without asking another worker for decisions.

```text
roster start worker-a --provider codex --brief brief.txt --worktree ../worker-a --branch worker/a --base main
roster status worker-a
roster wait worker-a --timeout 30m
roster answer worker-a
```

Background start confirms launch only. Check `wait`, state, answer, HEAD, and
diff before calling the work complete. A successful provider turn can still
contain a refusal. A timeout leaves the worker running. Stop through `roster
stop`, then wait; never kill all processes with the provider's image name.

## Integrate without branch review rounds

Read each answer and diff, verify the test evidence, and merge accepted commits
as the planner. Resolve shared-file conflicts yourself. Do not schedule review
rounds per branch. If a solution returns complicated, simplify the requirement
and remove unnecessary mechanisms before adding more instructions or workers.
Resume with `roster send <name> --message <file or text>` to clarify or correct a
task in the same conversation. Wait before sending another turn.

## One final gate, two providers at once

Once the integrated candidate and tests are ready, freeze the candidate commit.
Run one gate review with two different provider families concurrently, in
separate review worktrees. Use `roster pick --kind review --not-family <author>`
and current usage to choose eligible reviewers. For cross-review, each reviewer
must differ from the author's family; do not relabel the same family as different.

`roster review <author-session> --by <provider>` reviews that session's branch,
not an arbitrary integrated tree. To review an integrated candidate, launch two
review sessions in worktrees at the frozen candidate with explicit review briefs.
If quota prevents two eligible families, report that limitation rather than
silently replacing independent review with the author.

Require each reviewer to report severity, file:line, concrete impact, and prove
every finding with a test they write and run. Forbid implementation edits, author
file edits, and commits. They may put temporary reproduction tests in their own
review worktrees. Reviewers must identify the exact candidate commit.

Read both reports, reproduce actionable findings, fix confirmed defects, and
run the acceptance checks on the final integrated tree. Report completed work,
remaining limits, and evidence accurately. Do not push, deploy, publish, or send
messages without the user's corresponding authorization.
