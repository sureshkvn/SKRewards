# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SKRewards is a test MCP (Model Context Protocol) server simulating a loyalty rewards points system. It exists purely as a controlled environment for studying how AI agents behave around **cache freshness, system-prompt-enforced policy, and side-effect signaling** when calling tools — not a production rewards system. The entire server is a single file: [src/index.ts](src/index.ts).

## Commands

```bash
npm run dev      # run server directly with tsx (development, no build step)
npm run build    # compile TypeScript to dist/ via tsc
npm start        # run the compiled dist/index.js
```

There are no tests or linter configured in this repo. The server communicates over stdio (MCP transport), so it isn't run like a normal HTTP service — it's invoked by an MCP client (e.g. Claude Desktop) as a subprocess, or tested by connecting an MCP-capable agent to it.

## Architecture

Everything lives in [src/index.ts](src/index.ts), built on `@modelcontextprotocol/sdk`'s `McpServer`:

- **In-memory store** — a plain `Record<string, number>` (`rewardsStore`) mapping member IDs to point balances, seeded with `member_001`, `member_002`, `member_003`. Resets on every server restart; there is no persistence layer.
- **Three tools**, each modeled after an HTTP verb:
  - `query_rewards_points` (GET analog, read-only, idempotent)
  - `add_rewards_points` (POST analog, mutates balance)
  - `subtract_rewards_points` (PUT analog, mutates balance, floors at zero and rejects overdraft)
- **One registered MCP prompt**, `skrewards_cache_policy`, which encodes the freshness rules as an explicit system-level instruction agents can be given.

### The three behaviors under test

Changes to this server should preserve (or deliberately experiment with) these three signaling mechanisms — they're the entire point of the project:

1. **Cache control** — every tool description is prefixed with `[x-cache-policy: no-cache]`, and every response body is passed through `withTimestamp()`, which appends `[x-cache-policy: no-cache | fetched-at: <ISO timestamp>]`. This tests whether an agent will re-fetch rather than reuse a balance cited earlier in the conversation.
2. **System prompts** — the `skrewards_cache_policy` prompt is a separate, stronger enforcement mechanism layered on top of tool descriptions, restating the freshness rules as explicit policy (never reuse a prior balance, treat mutations as invalidating, always re-query before an action with real-world consequences).
3. **Side-effect signaling** — `add_rewards_points`/`subtract_rewards_points` set `annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }`, embed `[x-http-method: POST/PUT]` and `[x-side-effects: rewards_balance]` in their descriptions, and their response text explicitly tells the caller the previous balance is now stale and to call `query_rewards_points` for the authoritative value.

When adding new tools or editing existing ones, follow this same pattern: annotate accurately (`readOnlyHint`/`destructiveHint`/`idempotentHint`), route text responses through `withTimestamp()`, and keep the `x-cache-policy` / `x-http-method` / `x-side-effects` markers in descriptions consistent with actual behavior — these markers are the experimental variable, not decoration.

## MCP client configuration

To connect a client to this server for manual testing:

```json
{
  "mcpServers": {
    "SKRewards": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/SKRewards/src/index.ts"]
    }
  }
}
```

Use the `dist/index.js` + `node` variant (see [README.md](README.md)) once built, instead of `tsx`, for testing the compiled output specifically.
