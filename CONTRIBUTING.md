# Contributing to agent-shogun

Thank you for helping. A few rules keep the project's licensing workable.

## Licence of contributions

agent-shogun is dual-licensed under the AGPL-3.0-only and a commercial licence (see
[LICENSING.md](LICENSING.md)). To make that possible, contributions are accepted
only under the [Contributor Licence Agreement](CLA.md).

In each pull request:

1. Add this sentence to the description:
   > I have read and agree to the agent-shogun Contributor Licence Agreement, version 1.0.
2. Sign off every commit with `git commit -s`.
3. Name any third-party code or data you include, with its licence. Do not
   include code whose licence does not allow redistribution under the AGPL-3.0
   and a commercial licence.

## Before you open a pull request

- Run `npm test` and `npm run check`.
- Keep runtime dependencies at zero.
- Never commit tokens, API keys, account details or personal paths.
- Catalog changes need an independent benchmark source.
