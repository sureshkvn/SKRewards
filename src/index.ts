import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// In-memory store: memberId -> points
const rewardsStore: Record<string, number> = {
  member_001: 1800,
  member_002: 1097,
  member_003: 8750,
};

const server = new McpServer({
  name: "SKRewards",
  version: "1.0.0",
});

// ── Fix #2: System Prompt ─────────────────────────────────────────────────────
server.registerPrompt(
  "skrewards_cache_policy",
  {
    title: "SKRewards Cache & Freshness Policy",
    description: "Cache and freshness policy for SKRewards tool calls",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are connected to the SKRewards loyalty points server.

CACHE POLICY — follow these rules without exception:

1. NEVER reuse a rewards balance value from a previous turn or tool response.
   Every question about a member's current balance, spendable points, or
   available rewards MUST trigger a fresh call to query_rewards_points.

2. The tools add_rewards_points and subtract_rewards_points have side effects
   (equivalent to HTTP POST/PUT). After calling either one, any previously
   retrieved balance for that member is immediately stale and must not be cited.

3. Always call query_rewards_points immediately before answering any question
   that could drive a real-world action (spending, redeeming, approving,
   transferring). Treat balance data like a live stock price: stale the
   moment it is fetched, and only valid for the response it was fetched for.

4. These rules apply even if the same member was queried earlier in the same
   conversation. External systems may update balances at any time.`,
        },
      },
    ],
  })
);

// ── Fix #3: Timestamp helper ──────────────────────────────────────────────────
function withTimestamp(text: string): string {
  return `${text}\n[x-cache-policy: no-cache | fetched-at: ${new Date().toISOString()}]`;
}

// ── Fix #1: Tools with metadata ───────────────────────────────────────────────

server.registerTool(
  "query_rewards_points",
  {
    title: "Query Rewards Points",
    description:
      "[x-cache-policy: no-cache] [x-http-method: GET] Query the LIVE SKRewards points balance for a member. Always call this fresh — never rely on a previously retrieved value.",
    inputSchema: { memberId: z.string().describe("The member ID to query points for") },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  },
  async ({ memberId }) => {
    const points = rewardsStore[memberId];
    if (points === undefined) {
      return {
        content: [
          {
            type: "text",
            text: withTimestamp(`Member '${memberId}' not found. No rewards account exists for this ID.`),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: withTimestamp(`Member '${memberId}' has ${points.toLocaleString()} SKRewards points.`),
        },
      ],
    };
  }
);

server.registerTool(
  "add_rewards_points",
  {
    title: "Add Rewards Points",
    description:
      "[x-cache-policy: no-cache] [x-http-method: POST] [x-side-effects: rewards_balance] Add SKRewards points to a member's account. Has side effects — any cached balance for this member is immediately stale after this call.",
    inputSchema: {
      memberId: z.string().describe("The member ID to add points to"),
      points: z.number().positive().describe("Number of points to add (must be positive)"),
      reason: z.string().optional().describe("Optional reason (e.g. 'Purchase #12345')"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async ({ memberId, points, reason }) => {
    const before = rewardsStore[memberId] ?? 0;
    rewardsStore[memberId] = before + points;
    const after = rewardsStore[memberId];
    const note = reason ? ` Reason: ${reason}.` : "";
    return {
      content: [
        {
          type: "text",
          text: withTimestamp(
            `Added ${points.toLocaleString()} points to member '${memberId}'.${note} Balance: ${before.toLocaleString()} → ${after.toLocaleString()} points. Call query_rewards_points for the authoritative current balance.`
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "subtract_rewards_points",
  {
    title: "Subtract Rewards Points",
    description:
      "[x-cache-policy: no-cache] [x-http-method: PUT] [x-side-effects: rewards_balance] Subtract SKRewards points from a member's account. Has side effects — any cached balance for this member is immediately stale after this call. Will not allow balance to go below zero.",
    inputSchema: {
      memberId: z.string().describe("The member ID to subtract points from"),
      points: z.number().positive().describe("Number of points to subtract (must be positive)"),
      reason: z.string().optional().describe("Optional reason (e.g. 'Redemption for $10 coupon')"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async ({ memberId, points, reason }) => {
    const before = rewardsStore[memberId];
    if (before === undefined) {
      return {
        content: [
          {
            type: "text",
            text: withTimestamp(`Member '${memberId}' not found. Cannot subtract points from a non-existent account.`),
          },
        ],
      };
    }
    if (points > before) {
      return {
        content: [
          {
            type: "text",
            text: withTimestamp(
              `Insufficient points. Member '${memberId}' has ${before.toLocaleString()} points but ${points.toLocaleString()} were requested. Call query_rewards_points to confirm the current balance.`
            ),
          },
        ],
      };
    }
    rewardsStore[memberId] = before - points;
    const after = rewardsStore[memberId];
    const note = reason ? ` Reason: ${reason}.` : "";
    return {
      content: [
        {
          type: "text",
          text: withTimestamp(
            `Subtracted ${points.toLocaleString()} points from member '${memberId}'.${note} Balance: ${before.toLocaleString()} → ${after.toLocaleString()} points. Call query_rewards_points for the authoritative current balance.`
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
