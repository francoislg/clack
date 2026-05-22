import { randomBytes } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type {
  Action,
  DeliverFn,
  MessagePayload,
  ResponseSnapshot,
  StagedIntent,
  SubmitResponsePayload,
} from "../types.js";
import { DEFAULT_MAX_ADDITIONAL_MESSAGES } from "../../config.js";
import { appendStagedIntents as _appendStagedIntents } from "../../sessions.js";
import { textResult } from "../helpers.js";
import { DISMISSAL_PHRASES_INLINE } from "../../claude/dismissalPhrases.js";
import {
  getStructuredResponseBlocks as _getStructuredResponseBlocks,
  getResponseActionBlocks as _getResponseActionBlocks,
  validateActionButtonLabels as _validateActionButtonLabels,
} from "../../slack/blocks.js";
import {
  BlockSchema,
  tableBlockSchema,
  type AuthoredTableBlock,
  type Block,
} from "../../slack/blockSchema.js";
import {
  validateBlocks as _validateBlocks,
  validateTable as _validateTable,
} from "../../slack/blockValidate.js";
import { extractDisplayText } from "../../slack/blockText.js";

// Caps for multi-message batches — declared at module top because they're referenced by
// `postToActionSchema` (immediate `.max(...)` calls evaluated at module load).
// - POST_TO_ADDITIONAL_MESSAGES_MAX is the schema-level absolute upper bound on
//   `additional_messages.length` inside a post_to. The configured per-installation cap
//   (from `submitResponse.maxAdditionalMessages`) is tighter and is enforced at runtime
//   so the error can name the config path. Top-level `additional_messages` uses the
//   configured value directly as its schema cap (it's known at tool-build time).
// - THREAD_REPLIES_MAX is the fixed sanity ceiling for `thread_replies`; not configurable.
const POST_TO_ADDITIONAL_MESSAGES_MAX = 10;
const THREAD_REPLIES_MAX = 20;

// Action schemas for submit_response
const followupActionSchema = z.object({
  type: z.literal("followup"),
  label: z.string().describe("Button label"),
  prompt: z.string().describe("The prompt to inject when this button is clicked"),
});

const choiceActionSchema = z.object({
  type: z.literal("choice"),
  label: z.string().describe("Button label"),
  value: z.string().describe("The value to inject as the user's choice"),
  description: z.string().optional().describe("Optional description shown as subtitle"),
  workMode: z
    .boolean()
    .optional()
    .describe(
      "If true, enables work mode when clicked (use for choices that request code changes)",
    ),
});

// Shared message-content fields used by both `submit_response` (top-level) and
// the `post_to` action. Spreading the fragment into both schemas keeps the
// content surfaces in lockstep — adding a new field here updates both at once.
//
// `actions` is NOT in this fragment because:
//   - It has different optionality on each surface (required top-level, optional in post_to).
//   - `postToActionSchema` is declared before `actionSchema`, so its `actions` field
//     needs `z.lazy(...)` to break the cycle, while top-level `actions` (declared
//     after `actionSchema`) can reference it directly. Sharing one declaration would
//     force both to use lazy and lose type inference for the top-level path.
const messageContentFields = {
  blocks: z
    .array(BlockSchema)
    .min(1)
    .describe(
      "Slack Block Kit blocks (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel) shown to the user. Default to a single section block with mrkdwn text; add structure only when the content genuinely has structure.",
    ),
  table: tableBlockSchema
    .optional()
    .describe(
      "Optional Slack table block. Sibling of `blocks`, NOT a member of it: Slack always renders tables at the bottom of the message regardless of position, and rejects payloads with more than one. Use this when column alignment, wrap control, or rich-text cells matter; for inline tabular data prefer a markdown table inside a `markdown` block.",
    ),
  reactions: z
    .array(z.string())
    .optional()
    .describe(
      "Emoji reactions to add to the posted message (e.g., ['white_check_mark', 'thumbsup']). " +
        "Names without colons. Invalid emojis are silently ignored.",
    ),
};

const postToActionSchema = z.object({
  type: z.literal("post_to"),
  label: z.string().optional().describe("Custom button label (default: 'Post to thread')"),
  auto: z
    .boolean()
    .optional()
    .describe(
      "If true, post the content immediately without waiting for button click. Use when the user explicitly asks to post somewhere (e.g., 'post that in the channel').",
    ),
  channel: z
    .string()
    .optional()
    .describe(
      "Explicit target channel ID. Use when posting to a different channel than the default (e.g., a thread the user shared via URL).",
    ),
  thread_ts: z
    .string()
    .optional()
    .describe(
      "Explicit target thread timestamp. Omit for a top-level channel post (e.g., 'in the channel').",
    ),
  suppress_unfurls: z
    .boolean()
    .optional()
    .describe(
      "Set to true to disable Slack link/image previews on the cross-posted message. Independent of the top-level submit_response.suppress_unfurls — each post_to controls its own message. " +
        'Honor the same explicit triggers as the top-level field: "don\'t expand links", "don\'t unfurl URLs", "don\'t expand URLs", "no link previews", or any clear paraphrase.',
    ),
  ...messageContentFields,
  // Override the fragment's `blocks` description for post_to context.
  blocks: z
    .array(BlockSchema)
    .min(1)
    .describe(
      "The exact Block Kit payload to post. Each post_to action posts only its own blocks. When presenting multiple options, each action's blocks hold only that option's content.",
    ),
  // Optional interactive buttons rendered on the cross-posted message.
  // `z.lazy` breaks the recursion cycle (actionSchema → postToActionSchema → actionSchema).
  actions: z
    .array(z.lazy((): z.ZodType<Action> => actionSchema))
    .optional()
    .describe(
      "Optional interactive buttons rendered on the cross-posted message. Same action types as top-level (followup, choice, change, config_update, update). Nested `post_to` is rejected. Click handlers route back to the original session, so ref-based actions resolve against the original intentStore.",
    ),
  // Multi-message support for post_to publishing. `z.lazy` because `messagePayloadSchema`
  // is declared after this object (it depends on `actionSchema`, which depends on this).
  // Schema cap is the absolute upper bound (POST_TO_ADDITIONAL_MESSAGES_MAX); the actual
  // per-installation cap from config.submitResponse.maxAdditionalMessages is enforced at
  // runtime so the error can name the config path.
  additional_messages: z
    .array(z.lazy((): z.ZodType<MessagePayload> => messagePayloadSchema))
    .max(POST_TO_ADDITIONAL_MESSAGES_MAX)
    .optional()
    .describe(
      "Additional top-level channel messages posted to this post_to's target channel (separate Slack messages, no thread_ts). ONLY use when the user explicitly asks for multiple cross-posted messages (e.g. 'post each item separately to #channel'). Default to a single cross-post in `blocks`. Capped per-installation via `submitResponse.maxAdditionalMessages` (default 5).",
    ),
  thread_replies: z
    .array(z.lazy((): z.ZodType<MessagePayload> => messagePayloadSchema))
    .max(THREAD_REPLIES_MAX)
    .optional()
    .describe(
      "Reply messages threaded under this post_to's own cross-posted message (delivered with the cross-post's returned ts as their thread_ts). ONLY use when the user explicitly asks for an 'announcement at top of channel with details in the thread' pattern for the cross-post. Default to a single cross-post in `blocks`. Capped at 20.",
    ),
});

const changeActionSchema = z.object({
  type: z.literal("change"),
  ref: z.string().describe("Ref ID from propose_change"),
  label: z.string().optional().describe("Custom button label (default: 'Start Change')"),
  auto: z
    .boolean()
    .optional()
    .describe("If true, execute immediately without waiting for button click"),
});

const configUpdateActionSchema = z.object({
  type: z.literal("config_update"),
  ref: z.string().describe("Ref ID from propose_config_update"),
  label: z.string().optional().describe("Custom button label (default: 'Apply Update')"),
  auto: z
    .boolean()
    .optional()
    .describe("If true, execute immediately without waiting for button click"),
});

const updateActionSchema = z.object({
  type: z.literal("update"),
  ref: z.string().describe("Ref ID from request_update"),
  label: z.string().optional().describe("Custom button label (default: 'Update')"),
  auto: z
    .boolean()
    .optional()
    .describe("If true, execute immediately without waiting for button click"),
});

const ALLOWED_ACTION_TYPES = [
  "followup",
  "choice",
  "post_to",
  "change",
  "config_update",
  "update",
] as const;

type ActionInput =
  | string
  | number
  | boolean
  | null
  | ActionInput[]
  | { [key: string]: ActionInput };

interface MaybeTaggedActionInput {
  type?: ActionInput;
}

function readActionType(input: ActionInput | undefined): ActionInput | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return (input as MaybeTaggedActionInput).type;
  }
  return undefined;
}

// Custom error for unknown action types — same rationale as BlockSchema:
// produce an actionable message at the Zod boundary so the model gets a
// clear "Action type X is not supported" instead of generic "Invalid input".
const actionSchema = z.discriminatedUnion(
  "type",
  [
    followupActionSchema,
    choiceActionSchema,
    postToActionSchema,
    changeActionSchema,
    configUpdateActionSchema,
    updateActionSchema,
  ],
  {
    error: (issue) => {
      if (issue.code === "invalid_union") {
        const actualType = readActionType(issue.input as ActionInput | undefined);
        return `Action type ${JSON.stringify(actualType)} is not supported. Allowed action types: ${ALLOWED_ACTION_TYPES.join(", ")}.`;
      }
      return undefined;
    },
  },
);

// Ref-based action types that need validation
const REF_ACTION_TYPES = new Set(["change", "config_update", "update"]);

// Per-message follow-up payload used by `additional_messages` / `thread_replies` at
// every layer (top-level and inside a post_to). Strict-mode: every primary-only signal
// — `message`, `post_top_level`, `disengage`, `skip_response`, `suppress_unfurls`, plus
// recursive `additional_messages`/`thread_replies` — triggers an "unrecognized key"
// error at the schema boundary.
const messagePayloadSchema: z.ZodType<MessagePayload> = z
  .object({
    blocks: z
      .array(BlockSchema)
      .min(1)
      .describe(
        "Slack Block Kit blocks (Clack's curated subset) for this follow-up message. Same rules as the primary blocks field.",
      ),
    table: tableBlockSchema
      .optional()
      .describe("Optional Slack table block, appended at the bottom of this follow-up message."),
    actions: z
      .array(z.lazy((): z.ZodType<Action> => actionSchema))
      .optional()
      .describe(
        "Optional interactive buttons rendered on this follow-up message. Same action types as the primary actions field. Nested `post_to` inside this follow-up's actions is NOT allowed when this follow-up is itself inside a `post_to` (the existing nested-post_to rule extends to walk through followers).",
      ),
    reactions: z
      .array(z.string())
      .optional()
      .describe(
        "Emoji reactions to add to this follow-up message after delivery. Same semantics as the primary reactions field.",
      ),
  })
  .strict();

/**
 * Builder for the top-level `additional_messages` schema field — each entry is delivered as
 * a separate **top-level channel message** (no `thread_ts`). The cap is sourced from
 * `SubmitResponseDeps.maxAdditionalMessages` (default 5) so it's known at tool-build time.
 */
function buildAdditionalMessagesField(cap: number) {
  return z
    .array(messagePayloadSchema)
    .max(cap)
    .optional()
    .describe(
      `Additional top-level channel messages, posted as separate Slack messages alongside the primary IN THE SAME CHANNEL AS THIS SESSION'S TRIGGER. ONLY use when the user explicitly asks for multiple messages in the current channel (e.g. "send each as its own message", "split into ${cap} posts" — when posted by a scheduled cron job whose target IS the current channel). To send multiple messages to a DIFFERENT channel, use one or more \`post_to\` actions with an explicit \`channel\` argument instead — \`additional_messages\` cannot route elsewhere. Default to a single response in \`blocks\`. Maximum ${cap} entries.`,
    );
}

/**
 * Builder for the top-level `thread_replies` schema field — each entry is delivered as a
 * **thread reply** under the primary (when the primary is top-level) or in the existing
 * thread context. Fixed cap of THREAD_REPLIES_MAX.
 */
function buildThreadRepliesField() {
  return z
    .array(messagePayloadSchema)
    .max(THREAD_REPLIES_MAX)
    .optional()
    .describe(
      `Additional thread-reply messages, posted under the primary's thread context IN THE SAME CHANNEL AS THIS SESSION'S TRIGGER (under the primary's ts when \`post_top_level: true\`, otherwise in the existing thread). ONLY use when the user explicitly asks for threaded follow-ups in the current channel (e.g. "post the summary in the channel and put details in the thread"). To thread replies under a message in a DIFFERENT channel, use a \`post_to\` action with \`thread_replies\` instead. Default to a single response in \`blocks\`. Maximum ${THREAD_REPLIES_MAX} entries.`,
    );
}

const SKIP_ACKNOWLEDGMENT =
  "I acknowledge that responding to this would serve no purpose, so I am skipping it.";

export interface SubmitResponseDeps {
  intentStore: IntentStore;
  responseCapture: ResponseCapture;
  recorder: ToolCallRecorder;
  sessionId: string;
  deliver?: DeliverFn;
  persistSnapshot?: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
  /** When set, submit_response already delivers top-level to this channel — post_to targeting it is rejected. */
  topLevelDeliveryChannel?: string;
  /**
   * The session's channel ID. When `allowPostTopLevel` is enabled and Claude sets
   * `post_top_level: true`, this is the channel the response is posted to (no `thread_ts`),
   * and any `post_to` action targeting it without a `thread_ts` is rejected as a duplicate.
   */
  sessionChannelId?: string;
  /** When true, the skip_response parameter is available in the schema. */
  allowSkip?: boolean;
  /**
   * Declarative override of the schema/gating behavior. When `"skipped"`, the entire schema
   * is replaced by `{ skip_response: z.literal(true) }`. Other values are honored by
   * `computeAllowSkip` (which has already run by the time this is passed). See the
   * `submit-response-mode` capability for the full contract.
   */
  submitResponseMode?: "always" | "optional" | "skipped";
  /** When true, the disengage parameter is available in the schema. */
  allowDisengage?: boolean;
  /**
   * When true, the `post_top_level` parameter is available in the schema. Claude can set it
   * per-response to route the reply as a top-level channel message instead of a thread reply.
   */
  allowPostTopLevel?: boolean;
  /**
   * When true, the top-level `additional_messages` and `thread_replies` fields are
   * exposed on the schema. Only the scheduled (cron) trigger handler sets this. In DM,
   * @mention, reaction, auto-respond, thread-reply, and worker contexts the trigger
   * channel is the user's conversation space — posting additional top-level messages
   * there is almost never what they want (they'd ask for a `post_to` with an explicit
   * `channel` instead). The `post_to` action's OWN `additional_messages` /
   * `thread_replies` fields are NOT gated by this flag — `post_to` carries an explicit
   * `channel`, so the destination is unambiguous.
   */
  allowMultiMessage?: boolean;
  /**
   * Inclusive cap on `additional_messages.length` at every layer. Sourced from
   * `config.submitResponse.maxAdditionalMessages` (default 5). Applied at the top level
   * (when `allowMultiMessage: true`) and inside every `post_to` action.
   */
  maxAdditionalMessages?: number;
  /**
   * The session's existing thread timestamp. Used as the `thread_ts` on `additional_messages`
   * sibling delivery so follow-ups land in the same thread as the primary. When unset and
   * additional_messages is invoked, the batch loop falls back to whatever thread context
   * the primary delivery established (i.e. the streamer's thread).
   */
  sessionThreadTs?: string;
  /**
   * Fully-qualified MCP tool names that must appear in the recorder's history before delivery
   * is accepted. Enforced by a gate at the top of the handler.
   */
  requiredTools?: string[];
  /**
   * Returns true when `sendUpdate` has pushed user input Claude hasn't yet observed. When
   * set, the handler refuses to finalize while pending input exists — the error result
   * inlines the queued texts (see `consumePendingPushedTexts`) so Claude can address them
   * in the current turn, then retry `submit_response`. Wired from
   * `ClaudeRunHandle.hasPendingInput`.
   */
  hasPendingInput?: () => boolean;
  /**
   * Returns AND clears the texts of every unobserved `sendUpdate` push. The gate calls
   * this exactly once when it fires, embedding the texts in the error result so Claude
   * sees them. After draining, `hasPendingInput()` returns false for those messages.
   * Wired from `ClaudeRunHandle.consumePendingPushedTexts`.
   */
  consumePendingPushedTexts?: () => string[];
  getStructuredResponseBlocks?: typeof _getStructuredResponseBlocks;
  validateBlocks?: typeof _validateBlocks;
  validateTable?: typeof _validateTable;
  validateActionButtonLabels?: typeof _validateActionButtonLabels;
  getResponseActionBlocks?: typeof _getResponseActionBlocks;
  /**
   * Persists referenced staged intents to the session BEFORE the message is
   * delivered, so a fast button click can't outrun the writeback. Default
   * impl writes through `sessions.appendStagedIntents` (merge semantics).
   */
  appendStagedIntents?: (sessionId: string, intents: Record<string, StagedIntent>) => Promise<void>;
}

/**
 * Walks every action in the response, including those reachable through `post_to`
 * subtrees AND multi-message followers (additional_messages / thread_replies, both
 * at the top level and inside a `post_to`). Yields each with a path label like
 * `"actions[0]"`, `"actions[0].actions[1]"`, or
 * `"additional_messages[2].actions[0].thread_replies[1].actions[0]"`.
 *
 * The `parentIsPostTo` flag is STICKY — once any ancestor in the walk is a `post_to`,
 * all descendants carry `parentIsPostTo: true`. That makes the "nested post_to" check
 * trivial (any flat action with parentIsPostTo === true that is itself a post_to is
 * rejected) regardless of how deep through follower-message subtrees the nesting goes.
 */
interface FlatAction {
  action: Action;
  path: string;
  parentIsPostTo: boolean;
}

/**
 * Internal recursive walker. Descends into:
 *  - the action's own nested `actions` (if it's a `post_to`)
 *  - the action's `additional_messages[*].actions` (if it's a `post_to`)
 *  - the action's `thread_replies[*].actions` (if it's a `post_to`)
 *
 * Each descent flips `parentIsPostTo` to true (sticky), so the nested-post_to check
 * catches everything underneath, including post_to-inside-post_to-follower.
 */
function flattenActionsRecursive(
  actions: Action[],
  pathPrefix: string,
  parentIsPostTo: boolean,
  out: FlatAction[],
): void {
  actions.forEach((action, i) => {
    const path = `${pathPrefix}[${i}]`;
    out.push({ action, path, parentIsPostTo });
    if (action.type !== "post_to") return;
    // Inside a post_to subtree, every descendant has parentIsPostTo=true (sticky).
    if (action.actions && action.actions.length > 0) {
      flattenActionsRecursive(action.actions, `${path}.actions`, true, out);
    }
    if (action.additional_messages) {
      action.additional_messages.forEach((msg, mi) => {
        if (msg.actions && msg.actions.length > 0) {
          flattenActionsRecursive(
            msg.actions,
            `${path}.additional_messages[${mi}].actions`,
            true,
            out,
          );
        }
      });
    }
    if (action.thread_replies) {
      action.thread_replies.forEach((msg, mi) => {
        if (msg.actions && msg.actions.length > 0) {
          flattenActionsRecursive(msg.actions, `${path}.thread_replies[${mi}].actions`, true, out);
        }
      });
    }
  });
}

function flattenActions(actions: Action[]): FlatAction[] {
  const flat: FlatAction[] = [];
  flattenActionsRecursive(actions, "actions", false, flat);
  return flat;
}

/**
 * Batch-aware walker: yields actions from the top-level primary plus every
 * `additional_messages[*].actions` and `thread_replies[*].actions` at the top level,
 * each routed through `flattenActions` so post_to subtrees are descended too.
 *
 * Used by every validator that needs to see ALL ref-actions / post_to actions / button
 * labels in the batch (ref coverage, intent coverage, duplicate-channel guard, etc.).
 */
function walkBatchActions(args: {
  actions?: Action[];
  additional_messages?: MessagePayload[];
  thread_replies?: MessagePayload[];
}): FlatAction[] {
  const flat: FlatAction[] = [];
  if (args.actions && args.actions.length > 0) {
    flattenActionsRecursive(args.actions, "actions", false, flat);
  }
  if (args.additional_messages) {
    args.additional_messages.forEach((msg, mi) => {
      if (msg.actions && msg.actions.length > 0) {
        flattenActionsRecursive(msg.actions, `additional_messages[${mi}].actions`, false, flat);
      }
    });
  }
  if (args.thread_replies) {
    args.thread_replies.forEach((msg, mi) => {
      if (msg.actions && msg.actions.length > 0) {
        flattenActionsRecursive(msg.actions, `thread_replies[${mi}].actions`, false, flat);
      }
    });
  }
  return flat;
}

/**
 * Walks a pre-flattened action list and collects every ref-action whose `ref` is unknown
 * (or whose stored intent type disagrees with the action type). Returns all errors so
 * the §7 aggregator can surface a complete picture in one round-trip.
 */
function validateRefActions(flat: FlatAction[], intentStore: IntentStore): string[] {
  const errors: string[] = [];
  for (const { action, path } of flat) {
    if (!REF_ACTION_TYPES.has(action.type) || !("ref" in action)) continue;
    const intent = intentStore.resolve(action.ref);
    if (!intent) {
      errors.push(
        `${path}: Action type "${action.type}" references unknown ref "${action.ref}". Call the corresponding action tool first (e.g., propose_change, request_merge).`,
      );
      continue;
    }
    if (intent.type !== action.type) {
      errors.push(
        `${path}: Ref "${action.ref}" is a "${intent.type}" intent but action type is "${action.type}".`,
      );
    }
  }
  return errors;
}

function validatePostToActions(flat: FlatAction[], topLevelDeliveryChannel?: string): string[] {
  const errors: string[] = [];
  for (const { action, path, parentIsPostTo } of flat) {
    if (action.type !== "post_to") continue;
    // Nested post_to is rejected — the recursion has no useful semantics
    // (cross-posted message that itself triggers another cross-post) and would
    // complicate auto-delivery and snapshot persistence. The sticky
    // `parentIsPostTo` flag means this catches post_to nested through follower
    // subtrees too (e.g., `actions[0].additional_messages[1].actions[0]` of type post_to).
    if (parentIsPostTo) {
      errors.push(
        `${path}: Nested post_to is not supported. Use a separate top-level post_to action instead.`,
      );
      continue;
    }
    if (action.auto && !action.channel) {
      errors.push(
        `${path}: post_to with auto: true requires an explicit channel ID. Provide the target channel (e.g., "C0APQ9JU865"). Use list_repositories or check the conversation context for channel IDs.`,
      );
    }
    if (action.blocks.length === 0) {
      errors.push(`${path}: post_to action has empty blocks. Provide at least one block to post.`);
    }
    // In scheduled mode, submit_response already delivers top-level to the target channel.
    // A post_to targeting the same channel without a thread would duplicate the message.
    if (
      topLevelDeliveryChannel &&
      action.channel === topLevelDeliveryChannel &&
      !action.thread_ts
    ) {
      errors.push(
        `${path}: submit_response already posts top-level to channel ${topLevelDeliveryChannel}. Remove this post_to action — it would duplicate the message. Use post_to only for a DIFFERENT channel or a specific thread.`,
      );
    }
  }
  return errors;
}

function validateStagedIntentsCoverage(
  flat: FlatAction[],
  intentStore: IntentStore,
): string | null {
  const allIntents = intentStore.getAll();
  if (allIntents.size === 0) return null;

  const actionRefs = new Set<string>();
  for (const { action } of flat) {
    if ("ref" in action && action.ref) {
      actionRefs.add(action.ref);
    }
  }

  for (const [ref, intent] of allIntents) {
    // Only check intent types that must appear as response actions
    if (!REF_ACTION_TYPES.has(intent.type)) continue;
    if (!actionRefs.has(ref)) {
      return (
        `You staged a "${intent.type}" intent (ref: ${ref}) but didn't include it in the response actions. ` +
        `Either add it as an action button or, if you changed your mind, explain why in your response instead.`
      );
    }
  }
  return null;
}

function buildTexts(blocks: readonly Block[], message?: string) {
  const answerText = extractDisplayText(blocks);
  const displayText = message ? `${message}\n\n${answerText}` : answerText;
  return { answerText, displayText };
}

const SLACK_MESSAGE_TEXT_LIMIT = 10000;

/**
 * A single deliverable message in the batch, paired with the path prefix used in
 * batch-error path labels. Yielded by `enumerateBatchMessages` and consumed by the
 * per-message validation loop in the §7 aggregator.
 */
interface BatchMessage {
  blocks: Block[];
  table?: AuthoredTableBlock;
  message?: string;
  pathPrefix: string;
}

/**
 * Enumerate every message in the batch as `{ blocks, table?, message?, pathPrefix }`:
 *  - primary (pathPrefix: "")
 *  - each `additional_messages[i]` (pathPrefix: "additional_messages[i]")
 *  - each `thread_replies[i]` (pathPrefix: "thread_replies[i]")
 *  - each `post_to` action's own blocks (pathPrefix: "actions[i]")
 *  - each `post_to.additional_messages[j]` (pathPrefix: "actions[i].additional_messages[j]")
 *  - each `post_to.thread_replies[j]` (pathPrefix: "actions[i].thread_replies[j]")
 *
 * The `message` preamble is only carried on the primary — followers don't expose it.
 */
function enumerateBatchMessages(args: SubmitResponseArgs): BatchMessage[] {
  const messages: BatchMessage[] = [];
  if (args.blocks && args.blocks.length > 0) {
    messages.push({
      blocks: args.blocks,
      ...(args.table && { table: args.table }),
      ...(args.message && { message: args.message }),
      pathPrefix: "",
    });
  }
  args.additional_messages?.forEach((msg, i) => {
    messages.push({
      blocks: msg.blocks,
      ...(msg.table && { table: msg.table }),
      pathPrefix: `additional_messages[${i}]`,
    });
  });
  args.thread_replies?.forEach((msg, i) => {
    messages.push({
      blocks: msg.blocks,
      ...(msg.table && { table: msg.table }),
      pathPrefix: `thread_replies[${i}]`,
    });
  });
  args.actions?.forEach((action, i) => {
    if (action.type !== "post_to") return;
    messages.push({
      blocks: action.blocks,
      ...(action.table && { table: action.table }),
      pathPrefix: `actions[${i}]`,
    });
    action.additional_messages?.forEach((msg, j) => {
      messages.push({
        blocks: msg.blocks,
        ...(msg.table && { table: msg.table }),
        pathPrefix: `actions[${i}].additional_messages[${j}]`,
      });
    });
    action.thread_replies?.forEach((msg, j) => {
      messages.push({
        blocks: msg.blocks,
        ...(msg.table && { table: msg.table }),
        pathPrefix: `actions[${i}].thread_replies[${j}]`,
      });
    });
  });
  return messages;
}

/**
 * Per-message validation: block schema + table schema + length budget. Each Slack message
 * gets its own 10,000-char budget (the Slack `chat.postMessage` text limit) — no aggregate
 * sum across the batch. Returns a flat list of error strings, each path-prefixed.
 *
 * Used by the §7 aggregator to validate the primary AND each follower (`additional_messages[i]`,
 * `thread_replies[i]`, and the analogous fields inside every `post_to` action).
 *
 * Exported for direct unit testing.
 */
export function validateSingleMessage(args: {
  blocks: Block[];
  table?: AuthoredTableBlock;
  /** Optional preamble — counted toward this message's length budget. */
  message?: string;
  pathPrefix: string;
  validateBlocks: typeof _validateBlocks;
  validateTable: typeof _validateTable;
}): string[] {
  const errors: string[] = [];
  const blockErrors = args.validateBlocks(args.blocks);
  for (const e of blockErrors) {
    errors.push(`${args.pathPrefix}${args.pathPrefix ? "." : ""}${e.field}: ${e.message}`);
  }
  if (args.table) {
    const tableField = args.pathPrefix ? `${args.pathPrefix}.table` : "table";
    const tableErrors = args.validateTable(args.table, tableField);
    for (const e of tableErrors) {
      errors.push(`${e.field}: ${e.message}`);
    }
  }
  const { displayText } = buildTexts(args.blocks, args.message);
  if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
    const where = args.pathPrefix || "primary";
    errors.push(
      `${where}: response_too_long — text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char per-message limit. Shorten this message; each message in a multi-message batch has its own budget.`,
    );
  }
  return errors;
}

function recordError(recorder: ToolCallRecorder, args: unknown, errData: Record<string, unknown>) {
  recorder.record("submit_response", args as Record<string, unknown>, errData);
  return { ...textResult(errData), isError: true as const };
}

interface SubmitResponseSuccessResult {
  success: true;
  skipped?: true;
  disengaged?: true;
  postedTopLevel?: true;
  delivered?: boolean;
  blocksCount?: number;
  actionsCount?: number;
  /**
   * Total messages posted to Slack (primary + every follower delivered before any failure).
   * Omitted on skip path and when no `deliver` callback is configured (test contexts).
   * Helps Claude confirm a multi-message batch landed as expected.
   */
  messagesDelivered?: number;
}

function recordSuccess<TArgs extends object>(
  recorder: ToolCallRecorder,
  args: TArgs,
  result: SubmitResponseSuccessResult,
): void {
  recorder.record("submit_response", args, result);
}

const suppressUnfurlsField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to disable Slack's link and image previews on this message. Default behavior " +
      "previews links — useful for PR URLs, dashboards, etc. " +
      'EXPLICIT TRIGGERS: when the user (or a scheduled prompt) says any of "don\'t expand links", ' +
      '"don\'t unfurl URLs", "don\'t expand URLs", "no link previews", "no unfurls", or any clear ' +
      "paraphrase of the same intent, set this to true. Honor the directive in both query mode " +
      "(DM / mention / thread conversations where the user is designing the message) and " +
      "scheduled mode (cron job prompts that include the directive). " +
      "Also set this on your own judgment when the response includes a URL whose preview would " +
      "add noise or spoil the answer (e.g., quoting a JIRA ticket URL the user shared, or any " +
      "answer where the link's title gives away what you'd say next).",
  );

// Schema for the normal response path
const normalResponseSchema = {
  message: z
    .string()
    .optional()
    .describe(
      "Short conversational preamble shown to the user but NOT included when sharing via post_to. " +
        "Use for meta-commentary like 'Here is the updated version:' or 'I adjusted the tone:'. " +
        "Put the actual shareable content in blocks.",
    ),
  ...messageContentFields,
  actions: z
    .array(actionSchema)
    .describe(
      "Interactive buttons for the user to click. Use an empty array for casual/conversational responses that don't need actions.",
    ),
  suppress_unfurls: suppressUnfurlsField,
};

const disengageField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to permanently stop tracking this thread after this turn. " +
      "Canonical triggers: a conversation-ending acknowledgement or dismissal from the user — " +
      `short sign-offs (${DISMISSAL_PHRASES_INLINE}) ` +
      "or cases where the conversation has clearly moved on from the original topic. " +
      "Err on the side of disengaging: a false positive just costs one @mention to re-engage, " +
      "while a false negative means the bot keeps auto-replying to a thread where nobody wants it. " +
      "When setting disengage: true with a normal response, keep the reply short and avoid phrases " +
      'like "just holler!" or "let me know anytime" — those contradict the disengage signal. ' +
      "May be combined with a normal response (reply and disengage in the same turn) " +
      "OR with skip_response: true (decline to answer and disengage). " +
      "Clack will stop evaluating future messages in this thread until someone @mentions the bot again.",
  );

const postTopLevelField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to deliver this response as a top-level channel message instead of a thread reply. " +
      "Use when the response should go directly into the channel (e.g., when an auto-respond rule's " +
      "extra context says to post directly to the channel, or when the answer is an announcement-style " +
      "summary meant to be seen by channel members browsing the channel). " +
      "When set, the thinking indicator in the thread is removed and the final message is posted " +
      "to the channel with no thread_ts. Ignored when skip_response is true (nothing to post). " +
      "Do NOT combine with a `post_to` action targeting the same channel without a thread_ts — " +
      "that would duplicate the message and will be rejected.",
  );

// Schema with disengage-only support (no skip_response)
const disengageEnabledResponseSchema = {
  ...normalResponseSchema,
  disengage: disengageField,
};

const skipResponseField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to decline answering. Use when the conversation doesn't need a Clack response " +
      "(e.g., users talking to each other, question already answered). When true, blocks and actions are not required.",
  );

const skipOptionalBlocks = z
  .array(BlockSchema)
  .min(1)
  .optional()
  .describe("Slack Block Kit blocks shown to the user (not required when skip_response is true)");

const skipOptionalActions = z
  .array(actionSchema)
  .optional()
  .describe("Interactive buttons for the user to click (not required when skip_response is true)");

// Schema with skip_response AND disengage — used by autoRespond / threadReply triggers where
// both signals are meaningful (tracked conversations).
const skipEnabledResponseSchema = {
  ...normalResponseSchema,
  skip_response: skipResponseField,
  disengage: disengageField,
  blocks: skipOptionalBlocks,
  actions: skipOptionalActions,
  suppress_unfurls: suppressUnfurlsField,
};

// Schema with skip_response only (no disengage) — used by scheduled runs that opted in via
// `skipConditions`. Disengage is meaningless for scheduled triggers because there is no
// tracked conversation to deactivate.
const skipOnlyResponseSchema = {
  ...normalResponseSchema,
  skip_response: skipResponseField,
  blocks: skipOptionalBlocks,
  actions: skipOptionalActions,
  suppress_unfurls: suppressUnfurlsField,
};

// Schema for runs declared `submitResponseMode: "skipped"`. The ONLY accepted field is
// `skip_response: true` — `blocks`, `actions`, `table`, `reactions`, `message`,
// `post_top_level`, and `disengage` are all absent. Use when the run's actual deliverable
// is produced by another required tool and `submit_response` is purely a run terminator.
const skippedOnlyResponseSchema = {
  skip_response: z
    .literal(true)
    .describe(
      'REQUIRED to be `true`. This run\'s `submitResponseMode` is `"skipped"` — the actual deliverable ' +
        "was produced by another required tool, and `submit_response` is purely the run terminator. " +
        "The schema accepts ONLY `{ skip_response: true }` and nothing else. Do NOT include `blocks`, " +
        "`actions`, `table`, `reactions`, `message`, `post_top_level`, or `disengage`.",
    ),
};

/**
 * Permissive union over every possible field the dynamically-composed `submit_response`
 * schema can carry. The handler runtime-narrows via `"x" in args` everywhere, so the
 * type only needs to expose the union of valid fields — zod's runtime parse is the
 * source of truth for which are actually present in a given call.
 *
 * Used as a cast at the handler entry to recover field types after `buildSubmitResponseSchema`
 * returns `Record<string, z.ZodTypeAny>` (which loses per-variant inference).
 */
interface SubmitResponseArgs {
  message?: string;
  blocks?: Block[];
  table?: AuthoredTableBlock;
  reactions?: string[];
  actions?: Action[];
  suppress_unfurls?: boolean;
  skip_response?: boolean;
  disengage?: boolean;
  post_top_level?: boolean;
  additional_messages?: MessagePayload[];
  thread_replies?: MessagePayload[];
}

/**
 * Compose the input schema from the orthogonal flags on `deps`:
 *   - allowSkip, allowDisengage, allowPostTopLevel, allowMultiMessage
 *   - submitResponseMode === "skipped" short-circuits everything else.
 *
 * Top-level `additional_messages` and `thread_replies` are gated on `allowMultiMessage`.
 * Only the scheduled (cron) trigger sets it. In DM, @mention, reaction, auto-respond,
 * thread-reply, and worker contexts the fields are hidden from Claude entirely — the
 * trigger channel is the user's conversation space and multi-message there is almost
 * never what they want. The `post_to.additional_messages` / `post_to.thread_replies`
 * fields stay available everywhere because `post_to` carries an explicit `channel`.
 */
function buildSubmitResponseSchema(
  deps: Pick<
    SubmitResponseDeps,
    | "submitResponseMode"
    | "allowSkip"
    | "allowDisengage"
    | "allowPostTopLevel"
    | "allowMultiMessage"
    | "maxAdditionalMessages"
  >,
): Record<string, z.ZodTypeAny> {
  if (deps.submitResponseMode === "skipped") {
    return skippedOnlyResponseSchema;
  }

  let base: Record<string, z.ZodTypeAny>;
  if (deps.allowSkip && deps.allowDisengage) {
    base = { ...skipEnabledResponseSchema };
  } else if (deps.allowSkip) {
    base = { ...skipOnlyResponseSchema };
  } else if (deps.allowDisengage) {
    base = { ...disengageEnabledResponseSchema };
  } else {
    base = { ...normalResponseSchema };
  }

  if (deps.allowPostTopLevel) {
    base.post_top_level = postTopLevelField;
  }

  if (deps.allowMultiMessage) {
    const cap = deps.maxAdditionalMessages ?? DEFAULT_MAX_ADDITIONAL_MESSAGES;
    base.additional_messages = buildAdditionalMessagesField(cap);
    base.thread_replies = buildThreadRepliesField();
  }

  return base;
}

export function createSubmitResponseTool(deps: SubmitResponseDeps) {
  const {
    intentStore,
    responseCapture,
    recorder,
    sessionId,
    deliver,
    persistSnapshot,
    topLevelDeliveryChannel,
    sessionChannelId,
    sessionThreadTs,
    submitResponseMode,
    requiredTools,
    hasPendingInput,
    consumePendingPushedTexts,
    getStructuredResponseBlocks = _getStructuredResponseBlocks,
    validateBlocks = _validateBlocks,
    validateTable = _validateTable,
    validateActionButtonLabels = _validateActionButtonLabels,
    getResponseActionBlocks = _getResponseActionBlocks,
    appendStagedIntents = _appendStagedIntents,
  } = deps;

  const isSkippedMode = submitResponseMode === "skipped";

  const schema = buildSubmitResponseSchema({
    submitResponseMode: deps.submitResponseMode,
    allowSkip: deps.allowSkip,
    allowDisengage: deps.allowDisengage,
    allowPostTopLevel: deps.allowPostTopLevel,
    allowMultiMessage: deps.allowMultiMessage,
    maxAdditionalMessages: deps.maxAdditionalMessages,
  });

  // Safety net: if the pending-input gate fires this many times in one run, bypass it on
  // the next attempt. Prevents a permanent loop if the consume callback is missing/buggy
  // and the message texts never become visible to Claude. Reset per `createSubmitResponseTool`
  // invocation, so each run starts fresh.
  let gateRejectionCount = 0;
  const MAX_GATE_REJECTIONS = 5;

  return tool(
    "submit_response",
    "Submit the final response to the user. IMPORTANT: calling this tool ENDS the conversation — you cannot take any further actions afterward. If your response mentions doing something (e.g., 'Let me set that up', 'I'll create a PR'), you MUST have already called the relevant tools BEFORE calling submit_response. Never promise future actions in your response text — either do them first or don't mention them. This defines what the user sees: text sections and interactive buttons. Always call this tool to deliver your response.",
    schema,
    async (rawArgs) => {
      // Cast: `buildSubmitResponseSchema` returns `Record<string, z.ZodTypeAny>`, which loses
      // per-variant field inference. The runtime checks below (`"x" in args` + ad-hoc Array.isArray)
      // narrow before each use; the cast just restores the field types after the runtime parse.
      const args = rawArgs as SubmitResponseArgs;
      // --- Pending-input gate: refuse delivery while `sendUpdate` has queued user input
      // Claude hasn't observed yet. The error result inlines the queued texts so Claude
      // can address them in the current turn (the SDK only surfaces queued messages at
      // turn boundaries, which never arrive while submit_response keeps the assistant in
      // `tool_use`). After MAX_GATE_REJECTIONS attempts in this run, bypass the gate so a
      // bug in the consume path can't deadlock the conversation.
      if (hasPendingInput?.() && gateRejectionCount < MAX_GATE_REJECTIONS) {
        gateRejectionCount++;
        const queuedMessages = consumePendingPushedTexts?.() ?? [];
        return recordError(recorder, args, {
          error:
            queuedMessages.length > 0
              ? "New user message(s) arrived while you were responding. They are listed in `new_user_messages` below — address them in your response, then call submit_response again."
              : "A new user message arrived while you were responding. Address it and call submit_response again.",
          new_user_messages: queuedMessages,
        });
      }

      // --- Required tools gate: refuse delivery until every required tool has been recorded ---
      if (requiredTools && requiredTools.length > 0) {
        const history = recorder.getHistory();
        const called = new Set(history.map((e) => e.tool));
        const missing = requiredTools.filter((name) => !called.has(name));
        if (missing.length > 0) {
          return recordError(recorder, args, {
            error:
              `Cannot submit response yet. The following required tool(s) have not been called during this run: ${missing.join(", ")}. ` +
              `Call them before submitting.`,
          });
        }
      }

      // --- Skip path ---
      if ("skip_response" in args && args.skip_response) {
        // Cannot skip after a response was already delivered
        if (responseCapture.get()) {
          return recordError(recorder, args, {
            error: "Response already delivered — cannot skip after delivery.",
          });
        }
        // In "skipped" mode the schema accepts only `{ skip_response: true }` — there's no
        // `message` field for Claude to mismatch on, and the safeguard is moot because the
        // mode itself forces skipping. Skip the acknowledgment check entirely in that mode.
        if (!isSkippedMode) {
          const message = "message" in args ? args.message : undefined;
          if (message !== SKIP_ACKNOWLEDGMENT) {
            return recordError(recorder, args, {
              error: `To skip a response, the message field must be exactly: "${SKIP_ACKNOWLEDGMENT}"`,
            });
          }
        }
        const wantsDisengage = "disengage" in args && args.disengage === true;
        responseCapture.setSkipped();
        if (wantsDisengage) {
          responseCapture.setDisengaged();
        }
        const result: SubmitResponseSuccessResult = wantsDisengage
          ? { success: true, skipped: true, disengaged: true }
          : { success: true, skipped: true };
        recordSuccess(recorder, args, result);
        return textResult(result);
      }

      // --- Normal response path ---
      const blocks: Block[] | undefined =
        "blocks" in args && Array.isArray(args.blocks) ? (args.blocks as Block[]) : undefined;
      const actions = "actions" in args ? args.actions : undefined;
      if (!blocks || blocks.length === 0) {
        return recordError(recorder, args, {
          error: "blocks is required with at least 1 item when not skipping.",
        });
      }
      if (!actions) {
        return recordError(recorder, args, {
          error: "actions is required when not skipping.",
        });
      }

      const table: AuthoredTableBlock | undefined =
        "table" in args && args.table ? (args.table as AuthoredTableBlock) : undefined;
      const wantsPostTopLevel = "post_top_level" in args && args.post_top_level === true;

      // When the response itself is posted top-level to the session's channel, guard against
      // a duplicate `post_to` action targeting that same channel.
      const effectiveTopLevelChannel =
        topLevelDeliveryChannel ?? (wantsPostTopLevel ? sessionChannelId : undefined);

      // --- §7 collect-all aggregator: every validation error in the batch goes into one
      // `details: string[]` so Claude can fix everything in a single retry instead of
      // per-error round-trips. The earlier early-return gates (pending-input, required-tools,
      // skip path) are NOT part of this — they're pre-validation handler-level gates.

      const errors: string[] = [];

      // Per-message validation: blocks, table, length budget. Each message gets its own
      // 10,000-char budget — no aggregate sum across the batch.
      const batchMessages = enumerateBatchMessages(args);
      for (const m of batchMessages) {
        errors.push(
          ...validateSingleMessage({
            blocks: m.blocks,
            ...(m.table && { table: m.table }),
            ...(m.message && { message: m.message }),
            pathPrefix: m.pathPrefix,
            validateBlocks,
            validateTable,
          }),
        );
      }

      // Walk the full batch once — primary actions plus every follower's actions, descending
      // into post_to subtrees. The same FlatAction[] feeds every batch-wide validator.
      const flatActions = walkBatchActions(args);
      errors.push(...validateRefActions(flatActions, intentStore));
      errors.push(...validatePostToActions(flatActions, effectiveTopLevelChannel));
      const intentCoverageError = validateStagedIntentsCoverage(flatActions, intentStore);
      if (intentCoverageError) errors.push(intentCoverageError);

      if (errors.length > 0) {
        // Preserve backward-compatible error shape when there's a single error: surface it
        // directly in `error` (matches today's "error contains the human-readable message"
        // contract). For multi-error batches, use `error: "invalid_batch"` and put every
        // path-prefixed error in `details`. Documented in design.md decision 5 / task 7.2.
        return recordError(
          recorder,
          args,
          errors.length === 1 ? { error: errors[0] } : { error: "invalid_batch", details: errors },
        );
      }

      const message = "message" in args ? args.message : undefined;
      const payload: SubmitResponsePayload = {
        ...(message && { message }),
        blocks,
        ...(table && { table }),
        actions,
        ...(args.additional_messages && { additionalMessages: args.additional_messages }),
        ...(args.thread_replies && { threadReplies: args.thread_replies }),
      };

      // Persist per-button blocks (and any table/actions/reactions) for each post_to action
      // so the deferred button-click delivery can replay them after an arbitrary delay.
      if (persistSnapshot) {
        for (const action of payload.actions) {
          if (action.type === "post_to") {
            const snapshotId = randomBytes(6).toString("hex");
            const snapshotText = extractDisplayText(action.blocks);
            await persistSnapshot(snapshotId, {
              text: snapshotText,
              blocks: action.blocks,
              ...(action.table && { table: action.table }),
              ...(action.actions && action.actions.length > 0 && { actions: action.actions }),
              ...(action.reactions &&
                action.reactions.length > 0 && { reactions: action.reactions }),
              ...(action.suppress_unfurls === true && { suppressUnfurls: true }),
              ...(action.additional_messages &&
                action.additional_messages.length > 0 && {
                  additional_messages: action.additional_messages,
                }),
              ...(action.thread_replies &&
                action.thread_replies.length > 0 && {
                  thread_replies: action.thread_replies,
                }),
            });
            action._snapshotId = snapshotId;
          }
        }
      }

      const renderedBlocks = getStructuredResponseBlocks(payload, sessionId);

      // Validate action-button labels (Slack's 75-char limit) on the rendered buttons.
      const actionBlocksForValidation = getResponseActionBlocks(payload.actions, sessionId);
      const buttonLabelErrors = validateActionButtonLabels(actionBlocksForValidation);
      if (buttonLabelErrors.length > 0) {
        return recordError(recorder, args, {
          error: "invalid_blocks",
          details: buttonLabelErrors.map((e) => `${e.field}: ${e.message}`),
        });
      }

      // Same validation for buttons rendered on cross-posted (post_to) messages.
      for (let i = 0; i < payload.actions.length; i++) {
        const action = payload.actions[i];
        if (action.type !== "post_to" || !action.actions || action.actions.length === 0) continue;
        const nestedBlocks = getResponseActionBlocks(action.actions, sessionId);
        const nestedErrors = validateActionButtonLabels(nestedBlocks);
        if (nestedErrors.length > 0) {
          return recordError(recorder, args, {
            error: "invalid_blocks",
            details: nestedErrors.map((e) => `actions[${i}].${e.field}: ${e.message}`),
          });
        }
      }

      const reactions =
        "reactions" in args && Array.isArray(args.reactions) ? args.reactions : undefined;

      // Persist every staged intent referenced by an action (top-level or nested
      // inside post_to) BEFORE delivery. Otherwise a fast button click can land
      // before persistResponseState runs at turn end, and the click handler — which
      // reads from session.stagedIntents on disk — sees no intent for the ref and
      // returns the misleading "expired" error.
      const referencedIntents: Record<string, StagedIntent> = {};
      for (const { action } of flattenActions(actions)) {
        if (!("ref" in action) || !action.ref) continue;
        const intent = intentStore.resolve(action.ref);
        if (intent) referencedIntents[action.ref] = intent;
      }
      if (Object.keys(referencedIntents).length > 0) {
        await appendStagedIntents(sessionId, referencedIntents);
      }

      const wantsSuppressUnfurls = "suppress_unfurls" in args && args.suppress_unfurls === true;

      // --- Sequential delivery: primary first (consumes the streamer), then every follower
      // via plain chat.postMessage:
      //   - additional_messages: each as a separate TOP-LEVEL channel message (no thread_ts).
      //   - thread_replies: threaded replies — under primary.ts when primary is top-level,
      //     otherwise in the session's existing thread.
      // Followers bypass the `alreadyDelivered` guard inside `DeliverFn` so the primary's
      // streamer consumption doesn't block them.
      let messagesDelivered = 0;
      let primaryTs: string | undefined;

      if (deliver) {
        const deliveryResult = await deliver({
          blocks: renderedBlocks,
          ...(reactions?.length && { reactions }),
          ...(wantsPostTopLevel && { postTopLevel: true }),
          ...(wantsSuppressUnfurls && { suppressUnfurls: true }),
        });

        if (!deliveryResult.ok) {
          return recordError(recorder, args, {
            error: "delivery_failed",
            details: `primary: ${deliveryResult.error}`,
          });
        }
        messagesDelivered = 1;
        primaryTs = deliveryResult.ts;

        // Follower delivery mode: top-level (no thread_ts) for additional_messages,
        // threaded (thread_ts set) for thread_replies.
        type FollowerEntry =
          | { msg: MessagePayload; mode: "topLevel"; path: string }
          | { msg: MessagePayload; mode: "thread"; threadTs: string; path: string };
        const followers: FollowerEntry[] = [];

        if (args.additional_messages) {
          args.additional_messages.forEach((msg, i) => {
            followers.push({ msg, mode: "topLevel", path: `additional_messages[${i}]` });
          });
        }
        if (args.thread_replies) {
          // Thread context: primary's ts when posted top-level; otherwise the session's
          // existing thread. If neither, fall back to primaryTs (still puts them in a thread).
          const replyThreadTs = wantsPostTopLevel ? primaryTs : (sessionThreadTs ?? primaryTs);
          if (replyThreadTs) {
            args.thread_replies.forEach((msg, i) => {
              followers.push({
                msg,
                mode: "thread",
                threadTs: replyThreadTs,
                path: `thread_replies[${i}]`,
              });
            });
          }
        }

        for (const follower of followers) {
          // Render this follower's blocks + actions through the same renderer as the
          // primary. The renderer accepts a SubmitResponsePayload shape — followers
          // have no `message` preamble and may have no actions.
          const followerPayload: SubmitResponsePayload = {
            blocks: follower.msg.blocks,
            ...(follower.msg.table && { table: follower.msg.table }),
            actions: follower.msg.actions ?? [],
          };
          const followerRendered = getStructuredResponseBlocks(followerPayload, sessionId);
          const followerResult = await deliver({
            blocks: followerRendered,
            ...(follower.msg.reactions?.length && { reactions: follower.msg.reactions }),
            ...(follower.mode === "thread"
              ? { threadTs: follower.threadTs }
              : { postTopLevel: true }),
            ...(wantsSuppressUnfurls && { suppressUnfurls: true }),
          });
          if (!followerResult.ok) {
            // Validation-atomic, not delivery-atomic: stop the batch and report which message
            // failed. Already-posted messages stay — Claude can recover on the next turn.
            return recordError(recorder, args, {
              error: "delivery_failed",
              details: `${follower.path}: ${followerResult.error}`,
              messagesDelivered,
            });
          }
          messagesDelivered++;
        }
      }

      responseCapture.set(payload, renderedBlocks);

      const wantsDisengage = "disengage" in args && args.disengage === true;
      if (wantsDisengage) {
        responseCapture.setDisengaged();
      }
      if (wantsPostTopLevel) {
        responseCapture.setPostedTopLevel();
      }

      const result: SubmitResponseSuccessResult = {
        success: true,
        delivered: !!deliver,
        blocksCount: blocks.length,
        actionsCount: actions.length,
        ...(messagesDelivered > 0 && { messagesDelivered }),
        ...(wantsDisengage && { disengaged: true as const }),
        ...(wantsPostTopLevel && { postedTopLevel: true as const }),
      };
      recordSuccess(recorder, args, result);

      return textResult(result);
    },
  );
}
