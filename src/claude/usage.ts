import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Token + cost usage for a single Claude run (one `query()` invocation), captured from that
 * invocation's terminal `result` message. The figures are scoped to THAT invocation — a resumed
 * turn re-reads the prior conversation as cache-read input (real billed cost for that turn), so
 * summing per-turn `SessionUsage` across a multi-turn session yields the session's true total
 * billing without double-counting.
 *
 * This is a core type. It is deliberately distinct from the plugin SDK's narrower
 * `AskClaudeResult.usage` ({ inputTokens, outputTokens }) — core must not depend on plugin
 * types, and this is a superset.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/** A zero aggregate — every component 0. */
export const ZERO_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Map a `result` message's cumulative `usage` + `total_cost_usd` to `SessionUsage`.
 * Returns `undefined` when the message is not a `result` or carries no usage at all, so
 * callers can leave the field absent rather than persisting a spurious zero record.
 */
export function readResultUsage(message: SDKMessage): SessionUsage | undefined {
  if (message.type !== "result") return undefined;
  const usage = message.usage;
  const costUsd = asNumber(message.total_cost_usd);
  const inputTokens = asNumber(usage?.input_tokens);
  const outputTokens = asNumber(usage?.output_tokens);
  const cacheReadTokens = asNumber(usage?.cache_read_input_tokens);
  const cacheCreationTokens = asNumber(usage?.cache_creation_input_tokens);
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheCreationTokens === 0 &&
    costUsd === 0
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd };
}

/**
 * Component-wise sum of two usage records, treating a missing (`undefined`) operand on either
 * side as zero. Used both to fold an auto-executed worker run's usage onto its originating
 * session and to accumulate a session's per-turn usage.
 */
export function addUsage(a: SessionUsage | undefined, b: SessionUsage | undefined): SessionUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    cacheReadTokens: (a?.cacheReadTokens ?? 0) + (b?.cacheReadTokens ?? 0),
    cacheCreationTokens: (a?.cacheCreationTokens ?? 0) + (b?.cacheCreationTokens ?? 0),
    costUsd: (a?.costUsd ?? 0) + (b?.costUsd ?? 0),
  };
}
