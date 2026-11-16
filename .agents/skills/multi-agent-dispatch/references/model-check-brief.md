# Re-verify the coding model catalog

Act as a researcher for a planning agent. Include the previous
`model-catalog.json` in your input and report what changed. Do not treat its
initial tiers, costs, or allocation as measured evidence. Use current web access;
do not read credentials, cookies, provider sign-in files, or undocumented OAuth
usage endpoints. Never publish, deploy, place orders, or change account settings.

Cover Codex/OpenAI, Claude Code/Anthropic, Antigravity's separate Gemini and
Claude/GPT groups, and Grok/xAI. Distinguish the CLI host, underlying model
family, and the subscription bucket charged for a call.

For each provider, report:

- The currently callable model lineup with exact IDs, release dates, context
  windows, supported effort levels, new releases in the last 30 days, and models
  retired or announced for retirement. Confirm IDs with an installed CLI's model
  list or an opened vendor page. Explain aliases and effort-specific model IDs.
- Measured capability at software work: benchmark name, numerical score, test
  date, model/effort used, source URL, evaluation setup, and important limitations.
  Compare vendor model cards with independent benchmarks. Report weaknesses and
  disagreements; do not turn marketing labels into measured rankings.
- Subscription plans, allowance windows/resets, shared and separate model groups,
  relative allowance cost by model/effort, and how remaining allowance can be read
  without inference. Separate observed facts, official claims, inference, and
  unknowns. Dollar/token usage is not remaining subscription allowance.
- CLI changes affecting unattended work: resume/session flags, output schemas,
  reasoning settings, approval behavior, sandbox enforcement by OS, quota errors,
  and safe sign-in status/model discovery commands. Never probe an unverified
  slash command with a model prompt to guess whether it is a built-in command.

Produce an allocation table with first, second, and third choice and a reason
for: hardest design/debugging, user interface, server implementation, tests and
mechanical changes, code review, security review, web research, and cheap bulk
work. Consider capability, subscription allowance cost, tool support, and
cross-family independence. Record uncertainty instead of inventing a winner.

Return the updated JSON with this schema (retain all four providers):

```json
{
  "verifiedAt": "YYYY-MM-DD",
  "verifiedBy": "agent/model that performed this check",
  "providers": {
    "provider": {
      "cli": "command", "signIn": "command", "usageCommand": null,
      "plans": [{"name": "plan", "windows": [], "notes": "sources and limits"}],
      "models": [{
        "id": "exact-callable-id", "group": null, "released": null,
        "tier": "strong", "contextWindow": 0, "efforts": [],
        "relativeAllowanceCost": 1, "bestFor": [], "weakAt": [], "evidence": []
      }]
    }
  },
  "allocation": {
    "server": [{"provider": "provider", "model": "exact-callable-id", "effort": "low", "why": "evidence-backed reason"}]
  },
  "changesSinceLastCheck": [], "notConfirmed": []
}
```

Use provider keys `codex`, `claude`, `agy`, `grok`; tiers `frontier`, `strong`,
`fast` or null when unconfirmed; and work keys `hardest`, `ui`, `server`, `tests`, `review`, `security`,
`research`, `bulk`. Antigravity group names are `Gemini Models` and `Claude and
GPT models`. Unknown release is null; context size 0 means not confirmed; cost 1
is only a neutral placeholder until verified. Evidence should include URLs,
observation dates, and the precise claims supported. Never insert personal data.

Each provider may also have `excludedModels: [{"id":"exact-id","reason":"why excluded"}]`
for listed retirement candidates or routing helpers that should not be dispatched.
These records suppress false inventory-drift warnings; they are not active models
and must not appear in allocation choices. Keep reasons dated and sourced.

The planner must open pages behind any claim that changes allocation and verify
every proposed model ID. Hand the web research to an eligible provider with the
most remaining allowance, then independently check the result. If there is no web
access or allowance, report the limitation and catalog age; do not stamp an
unperformed check as current. Use `agent-shogun catalog set <file.json>` to apply a
verified result, or update the JSON, generated tables, verification line and
next-check date manually when only this skill folder is available.
