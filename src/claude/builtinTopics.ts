import type { TriggerType } from "../changes/types.js";

/** Name of the built-in topic holding Slack rendering guidance (Block Kit formatting,
 * delivery-context actions, post_to composition). Shipped at
 * `data/default_configuration/user/topics/response-rendering/`. */
export const RESPONSE_RENDERING_TOPIC = "response-rendering";

/**
 * Interactive triggers deliver a visible Slack response, so they always need the
 * rendering guidance. `scheduled` is deliberately absent: a cron fire attaches only
 * what its job's `attachedTopics` declares (lean skip_response fires pay nothing;
 * posting jobs opt in).
 */
const INTERACTIVE_TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>([
  "directMessages",
  "mentions",
  "reactions",
  "autoRespond",
  "threadReply",
  "channelReply",
]);

/** Built-in topics for a trigger type: `["response-rendering"]` for interactive triggers,
 * `[]` for `scheduled`. */
export function builtinTopicsForTrigger(triggerType: TriggerType): string[] {
  return INTERACTIVE_TRIGGERS.has(triggerType) ? [RESPONSE_RENDERING_TOPIC] : [];
}

/**
 * Merge the built-in topics for a trigger with caller-supplied pre-attached topics,
 * deduplicated, preserving built-in-first order. Returns `undefined` when the result
 * is empty so callers keep the existing "no topics" shape.
 */
export function mergeBuiltinTopics(
  triggerType: TriggerType,
  callerTopics?: string[],
): string[] | undefined {
  const merged = [...new Set([...builtinTopicsForTrigger(triggerType), ...(callerTopics ?? [])])];
  return merged.length > 0 ? merged : undefined;
}
