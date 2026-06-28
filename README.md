# SKRewards MCP Server

A test MCP (Model Context Protocol) server that simulates a loyalty rewards points system. Built with the Anthropic MCP SDK and TypeScript, this project is used to explore and validate how AI agents behave when interacting with tools that have real-world side effects and data freshness requirements.

## Purpose

SKRewards is a controlled testing environment for evaluating three key behaviors in AI agent/tool interactions:

1. **Cache Control** — ensuring agents always fetch fresh data rather than reusing stale values
2. **System Prompts** — using registered prompts to enforce policy-level constraints on agent behavior
3. **Side Effects Management** — correctly modeling and communicating which tool calls mutate state

## What It Does

The server exposes three tools over stdio:

| Tool | Method analog | Side effects |
|---|---|---|
| `query_rewards_points` | GET | None — read only |
| `add_rewards_points` | POST | Mutates member balance |
| `subtract_rewards_points` | PUT | Mutates member balance |

An in-memory store seeds three members (`member_001`, `member_002`, `member_003`) with starting balances. All mutations are in-process and reset on server restart.

## Testing Areas

### 1. Cache Control

The central question: **will an agent reuse a previously retrieved balance, or call the tool again?**

Every tool response includes a `no-cache` header-style annotation and a `fetched-at` ISO timestamp in the response body:

```
[x-cache-policy: no-cache | fetched-at: 2026-06-28T10:23:45.123Z]
```

Tool descriptions are also prefixed with `[x-cache-policy: no-cache]` so the intent is visible to the model at tool-selection time. The goal is to test whether these signals are sufficient to prevent an agent from citing a stale balance from an earlier turn.

### 2. System Prompts

A registered MCP prompt (`skrewards_cache_policy`) encodes the freshness policy as an explicit system-level instruction:

- Never reuse a balance from a previous turn
- Treat mutating tools (`add`/`subtract`) as immediately invalidating any cached balance for that member
- Always call `query_rewards_points` before any action that drives a real-world outcome (spending, redemption, approval)
- These rules apply even within the same conversation — external systems may update balances at any time

This tests how effectively a system prompt can enforce behavioral constraints on top of what tool descriptions alone convey.

### 3. Side Effects Management

`add_rewards_points` and `subtract_rewards_points` are annotated with:

- `readOnlyHint: false` and `destructiveHint: true` — signaling to the agent that these calls change state
- `[x-side-effects: rewards_balance]` in the description — explicitly naming what is affected
- `[x-http-method: POST/PUT]` — using familiar HTTP semantics to communicate non-idempotency

After a mutating call, the response body explicitly tells the agent that any previously retrieved balance is now stale and instructs it to call `query_rewards_points` for the authoritative value. This tests whether agents correctly invalidate their internal state after a side-effecting tool call.

## Running the Server

```bash
npm install
npm run dev        # run with tsx (development)
npm run build      # compile TypeScript
npm start          # run compiled output
```

## MCP Configuration

Add this to your Claude Desktop or MCP client config to connect:

```json
{
  "mcpServers": {
    "SKRewards": {
      "command": "node",
      "args": ["/path/to/SKRewards/dist/index.js"]
    }
  }
}
```

For development with `tsx`:

```json
{
  "mcpServers": {
    "SKRewards": {
      "command": "npx",
      "args": ["tsx", "/path/to/SKRewards/src/index.ts"]
    }
  }
}
```

## Tech Stack

- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — `@modelcontextprotocol/sdk`
- [Zod](https://zod.dev) — input schema validation
- TypeScript / Node.js
