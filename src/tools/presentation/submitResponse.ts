import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type {
  Action,
  DeliverFn,
  DeliverToChannelFn,
  DeliverToEntry,
  MessagePayload,
  ResponseSnapshot,
  StagedIntent,
  SubmitResponsePayload,
} from "../types.js";
import { DEFAULT_MAX_ADDITIONAL_MESSAGES } from "../../config.js";
import { logger } from "../../logger.js";
import { appendStagedIntents as _appendStagedIntents } from "../../sessions.js";
import type { AttentionLevel, DeliveryMode } from "../../sessions.js";
import type { EphemeralAttentionLevel } from "../../ephemeralRules.js";
import { readInstructionFile as _readInstructionFile } from "../../configurationFiles.js";
import { textResult } from "../helpers.js";
import { DISMISSAL_PHRASES_INLINE } from "../../claude/dismissalPhrases.js";
import {
  getStructuredResponseBlocks as _getStructuredResponseBlocks,
  getResponseActionBlocks as _getResponseActionBlocks,
  validateActionButtonLabels as _validateActionButtonLabels,
  SLACK_BUTTON_LABEL_MAX,
} from "../../slack/blocks.js";
import {
  BlockSchema,
  tableBlockSchema,
  chartBlockSchema,
  type AuthoredChartBlock,
  type AuthoredTableBlock,
  type Block,
} from "../../slack/blockSchema.js";
import {
  validateBlocks as _validateBlocks,
  validateTable as _validateTable,
  validateChart as _validateChart,
} from "../../slack/blockValidate.js";
import {
  collectActionErrors,
  persistPostToSnapshots,
  persistReferencedIntents,
  stampConfigUpdateLabels,
  validateNestedPostToButtonLabels,
} from "./submitResponse/actions.js";
import { validateSingleMessage, type BatchMessage } from "./submitResponse/messageValidation.js";
import { persistDeliverToIntents, validateDeliverToEntries } from "./submitResponse/deliverTo.js";

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

// Shared schema for every action's `label` field. Slack visually truncates button text past
// ~40 chars, so we hard-reject longer labels at parse time — Claude sees the Zod error inside
// the tool-call loop and can retry with a shorter label in the same turn.
export const buttonLabelSchema = z
  .string()
  .max(SLACK_BUTTON_LABEL_MAX)
  .describe(
    `Button label. MAX ${SLACK_BUTTON_LABEL_MAX} characters — Slack truncates longer labels in the UI, hiding the meaningful part from users.`,
  );

// Action schemas for submit_response
const followupActionSchema = z.object({
  type: z.literal("followup"),
  label: buttonLabelSchema,
  prompt: z.string().describe("The prompt to inject when this button is clicked"),
});

const choiceActionSchema = z.object({
  type: z.literal("choice"),
  label: buttonLabelSchema,
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
// Tool Search defers MCP tool schemas, so Claude can compose this call schema-blind — the
// characteristic mistake is passing structured params as JSON-encoded strings. The default
// invalid_type message names the wrong shape but not the fix, inviting retries that mutate
// content instead of encoding; this error map hands Claude the exact corrective action.
const stringifiedParamHint = (
  field: string,
): { error: (issue: z.core.$ZodRawIssue) => string | undefined } => ({
  error: (issue) =>
    issue.code === "invalid_type" && typeof issue.input === "string"
      ? [
          `\`${field}\` arrived as a JSON-encoded STRING; it must be actual JSON, not a string containing JSON.`,
          "If this tool's full schema is not loaded in your context, load it first with ToolSearch",
          '(query: "select:mcp__clack__submit_response").',
          "Then re-send the IDENTICAL content with the string unwrapped into real JSON —",
          "fix only the encoding; do NOT change any content (text, emoji, table cells, labels).",
        ].join(" ")
      : undefined,
});

const messageContentFields = {
  blocks: z
    .array(BlockSchema, stringifiedParamHint("blocks"))
    .min(1)
    .describe(
      "Slack Block Kit blocks (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel) shown to the user. Default to a single section block with mrkdwn text; add structure only when the content genuinely has structure.",
    ),
  table: tableBlockSchema
    .optional()
    .describe(
      'Optional Slack table. Sibling of `blocks`, NOT a member of it: Slack always renders tables at the bottom of the message regardless of position, and rejects payloads with more than one. Set `variant: "data_table"` for an INTERACTIVE table (pagination + sortable columns, up to 200 rows) — best for large result sets; it takes an optional `caption` but ignores `column_settings` (no per-column alignment). Omit `variant` (or `variant: "table"`) for the default static table when column alignment/wrap or rich-text cells matter (e.g. leaderboards). For inline tabular data prefer a markdown table inside a `markdown` block.',
    ),
  chart: chartBlockSchema
    .optional()
    .describe(
      'Optional chart, rendered as a Slack data_visualization block below the content (and above the table if both are present). Sibling of `blocks`, NOT a member of it; at most one per message. `chart_type: "pie"` takes `segments: [{ label, value }]` (1–12). `chart_type: "bar" | "area" | "line"` takes `series: [{ name, data: [{ label, value }] }]` (1–12 series, 1–20 points each) plus optional `axis_config: { categories?, x_label?, y_label? }` (categories are auto-derived from the data-point labels when omitted). Optional `title` (≤50 chars); labels/series names ≤20 chars. Use for genuinely quantitative comparisons; prefer a table or text for everything else.',
    ),
  reactions: z
    .array(z.string())
    .optional()
    .describe(
      "Emoji reactions to add to the posted message (e.g., ['white_check_mark', 'thumbsup']). " +
        "Names without colons. Invalid emojis are silently ignored.",
    ),
};

// Per-destination thread-engagement fields, shared by `post_to` and each `deliver_to` entry.
// Defined here (above `postToActionSchema`) so both schemas can reference them at module load.
const threadEngagementAttentionField = z
  .enum(["always", "high", "medium", "low", "off"])
  .optional()
  .describe(
    "Optional. Seed an attention level on the DESTINATION thread so human replies there engage " +
      'Clack (it follows up). Omit or "off" = fire-and-forget (no engagement seeded). "high"/"always" ' +
      'keep the thread responsive; "medium"/"low" are more selective. Distinct from the top-level ' +
      "`attention_level`, which governs the current session rather than this destination.",
  );

const creationContextField = z
  .string()
  .min(1)
  .describe(
    "REQUIRED. The hidden context this message is posted with — never shown to users. Record WHY " +
      "you're posting it, any facts to remember for later, and how to handle replies. It is stored " +
      "on the destination conversation and surfaced to BOTH the auto-respond judge (which decides " +
      "whether to reply) and your own later answer turns there — so a conversation you start retains " +
      "why it exists. Only takes effect on replies when paired with a non-`off` `attention_level` / " +
      "`channel_attention_level`, but supply it regardless.",
  );

const threadEngagementDeliveryModeField = z
  .enum(["streamer", "invisible"])
  .optional()
  .describe(
    "Optional. Seed the DESTINATION thread's delivery mode. `streamer` (default) shows the live " +
      "thinking card on future replies; `invisible` suppresses it so replies just appear, which feels " +
      "natural for casual chatter. Only meaningful alongside a non-`off` `attention_level`.",
  );

const channelAttentionLevelSeedField = z
  .enum(["high", "medium", "low"])
  .optional()
  .describe(
    "Optional. Only meaningful for a TOP-LEVEL destination post (no thread_ts): temporarily follow " +
      "the DESTINATION CHANNEL's conversation — top-level replies in the channel are judged for " +
      "relatedness to this post and answered while the window lasts. Unrelated channel traffic decays " +
      "the level one rung at a time; the window expires ~60 minutes after the last exchange (a late " +
      "genuine reply can still revive it). Distinct from `attention_level`, which follows the " +
      "destination THREAD; `always` is not seedable for a channel. Omit for fire-and-forget.",
  );

const postToActionSchema = z.object({
  type: z.literal("post_to"),
  label: buttonLabelSchema
    .optional()
    .describe(
      `Custom button label (default: 'Post to thread'). MAX ${SLACK_BUTTON_LABEL_MAX} characters.`,
    ),
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
  attention_level: threadEngagementAttentionField,
  creation_context: creationContextField,
  default_delivery_mode: threadEngagementDeliveryModeField,
  channel_attention_level: channelAttentionLevelSeedField,
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
    .array(BlockSchema, stringifiedParamHint("blocks"))
    .min(1)
    .describe(
      "The exact Block Kit payload to post. Each post_to action posts only its own blocks. When presenting multiple options, each action's blocks hold only that option's content.",
    ),
  // Optional interactive buttons rendered on the cross-posted message.
  // `z.lazy` breaks the recursion cycle (actionSchema → postToActionSchema → actionSchema).
  actions: z
    .array(
      z.lazy((): z.ZodType<Action> => actionSchema),
      stringifiedParamHint("actions"),
    )
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
  user_requested: z
    .boolean()
    .optional()
    .describe(
      "Set to true ONLY when the requester explicitly asked, in this conversation, to post back to a followed source thread. Followed threads are read-only sources — without this field, a post_to targeting one is rejected.",
    ),
});

/**
 * Factory for the ref-backed action schemas. Every one is `{ type, ref, label?, auto? }` —
 * a button that resolves a previously-staged intent by ref. They differ only in the type
 * literal, the ref/auto wording, and the default button label.
 */
function refActionSchema<T extends string>(opts: {
  type: T;
  refDescription: string;
  defaultLabel: string;
  autoDescription: string;
}) {
  return z.object({
    type: z.literal(opts.type),
    ref: z.string().describe(opts.refDescription),
    label: buttonLabelSchema
      .optional()
      .describe(
        `Custom button label (default: '${opts.defaultLabel}'). MAX ${SLACK_BUTTON_LABEL_MAX} characters.`,
      ),
    auto: z.boolean().optional().describe(opts.autoDescription),
  });
}

const EXECUTE_ON_CLICK = "If true, execute immediately without waiting for button click";

const changeActionSchema = refActionSchema({
  type: "change",
  refDescription: "Ref ID from propose_change",
  defaultLabel: "Start Change",
  autoDescription: EXECUTE_ON_CLICK,
});

const configUpdateActionSchema = refActionSchema({
  type: "config_update",
  refDescription: "Ref ID from propose_config_update",
  defaultLabel: "Apply Update",
  autoDescription: EXECUTE_ON_CLICK,
});

const updateActionSchema = refActionSchema({
  type: "update",
  refDescription: "Ref ID from request_update",
  defaultLabel: "Update",
  autoDescription: EXECUTE_ON_CLICK,
});

const skillCreateActionSchema = refActionSchema({
  type: "skill_create",
  refDescription: "Ref ID from propose_skill_create",
  defaultLabel: "Create skill",
  autoDescription:
    "If true, create the skill immediately without waiting for a confirm click. Recommended for 'create a skill that...' requests where the user clearly asked.",
});

const skillUpdateActionSchema = refActionSchema({
  type: "skill_update",
  refDescription: "Ref ID from propose_skill_update",
  defaultLabel: "Edit skill",
  autoDescription: "If true, apply the update immediately.",
});

const skillDisableActionSchema = refActionSchema({
  type: "skill_disable",
  refDescription: "Ref ID from propose_skill_disable",
  defaultLabel: "Disable",
  autoDescription: "If true, disable immediately.",
});

const skillRestoreActionSchema = refActionSchema({
  type: "skill_restore",
  refDescription: "Ref ID from propose_skill_restore",
  defaultLabel: "Restore",
  autoDescription: "If true, restore immediately.",
});

const skillDeleteActionSchema = refActionSchema({
  type: "skill_delete",
  refDescription: "Ref ID from propose_skill_disable when staging a permanent removal",
  defaultLabel: "Delete",
  autoDescription: "If true, apply immediately. Permanent and irreversible.",
});

const ALLOWED_ACTION_TYPES = [
  "followup",
  "choice",
  "post_to",
  "change",
  "config_update",
  "update",
  "skill_create",
  "skill_update",
  "skill_disable",
  "skill_restore",
  "skill_delete",
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
export const actionSchema = z.discriminatedUnion(
  "type",
  [
    followupActionSchema,
    choiceActionSchema,
    postToActionSchema,
    changeActionSchema,
    configUpdateActionSchema,
    updateActionSchema,
    skillCreateActionSchema,
    skillUpdateActionSchema,
    skillDisableActionSchema,
    skillRestoreActionSchema,
    skillDeleteActionSchema,
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

// Per-message follow-up payload used by `additional_messages` / `thread_replies` at
// every layer (top-level and inside a post_to). Strict-mode: every primary-only signal
// — `message`, `post_top_level`, `attention_level`, `skip_response`, `suppress_unfurls`, plus
// recursive `additional_messages`/`thread_replies` — triggers an "unrecognized key"
// error at the schema boundary.
const messagePayloadSchema: z.ZodType<MessagePayload> = z
  .object({
    blocks: z
      .array(BlockSchema, stringifiedParamHint("blocks"))
      .min(1)
      .describe(
        "Slack Block Kit blocks (Clack's curated subset) for this follow-up message. Same rules as the primary blocks field.",
      ),
    table: tableBlockSchema
      .optional()
      .describe("Optional Slack table block, appended at the bottom of this follow-up message."),
    chart: chartBlockSchema
      .optional()
      .describe(
        "Optional chart (data_visualization block), rendered above the table in this follow-up message. Same shape as the primary `chart` field.",
      ),
    actions: z
      .array(
        z.lazy((): z.ZodType<Action> => actionSchema),
        stringifiedParamHint("actions"),
      )
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
  /**
   * Delivers one `deliver_to` entry's payload to an explicit `(channel, thread_ts?)` via the
   * shared per-channel routine (`postAnswerToChannel`). Only the `"optional-post-to"` (channelless)
   * path uses it. Absent in test/verify contexts and any context without a Slack client.
   */
  deliverToChannel?: DeliverToChannelFn;
  /**
   * Persists the run's `responseTs` (the first `deliver_to` entry's posted ts) so the cron
   * status reporter can read it back. Mirrors how the direct-deliver primary writes `responseTs`.
   */
  recordResponseTs?: (ts: string) => Promise<void>;
  persistSnapshot?: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
  /** When set, submit_response already delivers top-level to this channel — post_to targeting it is rejected. */
  topLevelDeliveryChannel?: string;
  /**
   * The session's channel ID. When `allowPostTopLevel` is enabled and Claude sets
   * `post_top_level: true`, this is the channel the response is posted to (no `thread_ts`),
   * and any `post_to` action targeting it without a `thread_ts` is rejected as a duplicate.
   */
  sessionChannelId?: string;
  /**
   * Live reader of the session's followed threads (investigation sources). Any `post_to`
   * targeting one of these `(channel, threadTs)` pairs is rejected unless the action
   * carries `user_requested: true`. A getter (not a snapshot) so threads followed
   * mid-session are covered.
   */
  getBlockedFollowedThreads?: () => Promise<Array<{ channel: string; threadTs: string }>>;

  /** When true, the skip_response parameter is available in the schema. */
  allowSkip?: boolean;
  /**
   * Returns true when the `response-rendering` topic is loaded (pre-attached at session
   * start or attached mid-session). When absent or false, formatting-class validation
   * failures append a hint to attach the topic before retrying.
   */
  isResponseRenderingAttached?: () => boolean;
  /**
   * Declarative override of the schema/gating behavior. When `"skipped"`, the entire schema
   * is replaced by `{ skip_response: z.literal(true) }`. Other values are honored by
   * `computeAllowSkip` (which has already run by the time this is passed). See the
   * `submit-response-mode` capability for the full contract.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /** When true, the `attention_level` dial (incl. `"off"` to disengage) is available in the schema. */
  allowAttentionLevel?: boolean;
  /** When true (channelReply turns only), the `channel_attention_level` reframe dial is exposed. */
  allowChannelAttentionLevel?: boolean;
  /** Applies Claude's `channel_attention_level` to the channel's ephemeral rule (`"off"` deletes). */
  setChannelAttentionLevel?: (level: EphemeralAttentionLevel | "off") => Promise<void>;
  /**
   * When true, the `post_top_level` parameter is available in the schema. Claude can set it
   * per-response to route the reply as a top-level channel message instead of a thread reply.
   */
  allowPostTopLevel?: boolean;
  /**
   * When true (direct-message trigger only), the `thread_title` field is exposed — a short
   * Claude-authored label used to name the DM thread. Consumed by the agent DM turn-end hook.
   */
  allowThreadTitle?: boolean;
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
  validateChart?: typeof _validateChart;
  validateActionButtonLabels?: typeof _validateActionButtonLabels;
  getResponseActionBlocks?: typeof _getResponseActionBlocks;
  /**
   * Persists referenced staged intents to the session BEFORE the message is
   * delivered, so a fast button click can't outrun the writeback. Default
   * impl writes through `sessions.appendStagedIntents` (merge semantics).
   */
  appendStagedIntents?: (sessionId: string, intents: Record<string, StagedIntent>) => Promise<void>;
  /**
   * Reads an instruction file's default + custom content. Used to pick an
   * operation-aware label for `config_update` actions that stage a delete intent
   * (revert-to-default if a shipped default exists, otherwise delete-file).
   */
  readInstructionFile?: typeof _readInstructionFile;
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
      ...(args.chart && { chart: args.chart }),
      ...(args.message && { message: args.message }),
      pathPrefix: "",
    });
  }
  args.additional_messages?.forEach((msg, i) => {
    messages.push({
      blocks: msg.blocks,
      ...(msg.table && { table: msg.table }),
      ...(msg.chart && { chart: msg.chart }),
      pathPrefix: `additional_messages[${i}]`,
    });
  });
  args.thread_replies?.forEach((msg, i) => {
    messages.push({
      blocks: msg.blocks,
      ...(msg.table && { table: msg.table }),
      ...(msg.chart && { chart: msg.chart }),
      pathPrefix: `thread_replies[${i}]`,
    });
  });
  args.actions?.forEach((action, i) => {
    if (action.type !== "post_to") return;
    messages.push({
      blocks: action.blocks,
      ...(action.table && { table: action.table }),
      ...(action.chart && { chart: action.chart }),
      pathPrefix: `actions[${i}]`,
    });
    action.additional_messages?.forEach((msg, j) => {
      messages.push({
        blocks: msg.blocks,
        ...(msg.table && { table: msg.table }),
        ...(msg.chart && { chart: msg.chart }),
        pathPrefix: `actions[${i}].additional_messages[${j}]`,
      });
    });
    action.thread_replies?.forEach((msg, j) => {
      messages.push({
        blocks: msg.blocks,
        ...(msg.table && { table: msg.table }),
        ...(msg.chart && { chart: msg.chart }),
        pathPrefix: `actions[${i}].thread_replies[${j}]`,
      });
    });
  });
  return messages;
}

/**
 * Stated on every error because a run that has already failed twice has demonstrably stopped
 * weighing the tool description, which says the same thing. One incident ended with a
 * `{ type: "section", text: "test" }` probe sent to discover the argument format: it validated,
 * delivered to a public channel, and consumed the only delivery slot the run had.
 */
export const ONE_SHOT_REMINDER =
  "submit_response is one-shot: the next call that validates is what the user sees, and it " +
  "cannot be replaced or followed up. Never send a probe, test, or placeholder payload to " +
  "discover the format — correct the arguments and resend your complete response.";

function recordError(recorder: ToolCallRecorder, args: unknown, errData: Record<string, unknown>) {
  recorder.record("submit_response", args as Record<string, unknown>, errData);
  // The reminder rides the result Claude sees but stays out of the recorded history above,
  // which keeps session traces byte-identical to the raw failure.
  return { ...textResult({ ...errData, reminder: ONE_SHOT_REMINDER }), isError: true as const };
}

interface SubmitResponseSuccessResult {
  success: true;
  skipped?: true;
  /** Echoes back the attention level Claude set this turn, when it set one. */
  attentionLevel?: AttentionLevel;
  /** Echoes back the delivery mode Claude set this turn, when it set one. */
  deliveryMode?: DeliveryMode;
  /** True when `attention_level: "off"` disengaged the thread this turn. */
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
  /** Non-fatal per-entry notices (e.g. an ignored `channel_attention_level` on a threaded entry). */
  warnings?: string[];
  /** Echoes back the channel window level Claude set this turn, when it set one. */
  channelAttentionLevel?: EphemeralAttentionLevel | "off";
}

type ChannelAttentionReframe = EphemeralAttentionLevel | "off";

/** Reads `channel_attention_level` off the args and applies it via the injected mutator.
 *  Best-effort: a mutation failure is logged, never turned into a delivery error.
 *  `args` stays `object` because the field only exists on the channelReply schema variant;
 *  the zod layer has already validated it, so the narrowing cast is safe. */
async function applyChannelAttentionLevel(
  args: object,
  setChannelAttentionLevel?: (level: ChannelAttentionReframe) => Promise<void>,
): Promise<ChannelAttentionReframe | undefined> {
  const level =
    "channel_attention_level" in args
      ? (args.channel_attention_level as ChannelAttentionReframe | undefined)
      : undefined;
  if (!level || !setChannelAttentionLevel) return undefined;
  try {
    await setChannelAttentionLevel(level);
    return level;
  } catch (err) {
    logger.warn(`submit_response: failed to apply channel_attention_level: ${err}`);
    return undefined;
  }
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

const escalateToOwnerField = z
  .string()
  .optional()
  .describe(
    "Operator-facing diagnostic for an INTERNAL/SYSTEM failure the user cannot act on — an " +
      "unrecoverable tool error, a misconfiguration, a missing credential/permission, an unexpected " +
      "crash. When set, this text is DM'd to the workspace owner ONLY (never shown to the user) and " +
      "recorded as an error report. Put the full technical detail here (what failed, the exact error, " +
      "what you were attempting), and keep your `blocks` to a short acknowledgement that the owner was " +
      "notified. Do NOT use for normal outcomes the user should see (e.g. 'no results found', 'I can't " +
      "do that here') — report those in `blocks` as usual.",
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
    .array(actionSchema, stringifiedParamHint("actions"))
    .describe(
      "Interactive buttons for the user to click. Use an empty array for casual/conversational responses that don't need actions.",
    ),
  suppress_unfurls: suppressUnfurlsField,
  escalate_to_owner: escalateToOwnerField,
};

const attentionLevelField = z
  .enum(["always", "high", "medium", "low", "off"])
  .optional()
  .describe(
    "Adjust how closely Clack follows this thread on future messages. The current level is " +
      "stated in your delivery context — raise it, lower it, or omit to keep it. " +
      '"always" = reply to every message (no relevance check); "high" = reply to nearly anything; ' +
      '"medium" = reply when plausibly relevant; "low" = reply only to direct address or clear ' +
      'follow-ups; "off" = disengage, permanently stop tracking this thread. ' +
      `Set "off" on a conversation-ending dismissal (${DISMISSAL_PHRASES_INLINE}) or when the ` +
      "conversation has clearly moved on — err toward it, since a user can @mention to re-engage. " +
      'When setting "off" with a normal response, keep the reply short and avoid phrases like ' +
      '"just holler!" — those contradict the disengage signal. May accompany a normal response ' +
      "(reply and adjust in the same turn) OR skip_response: true (decline and adjust).",
  );

const deliveryModeField = z
  .enum(["streamer", "invisible"])
  .optional()
  .describe(
    "Set how THIS thread delivers Clack's future replies. `streamer` (default) shows the live " +
      "thinking / tool-progress card; `invisible` suppresses it so replies just appear, which feels " +
      "natural for casual chatter. Takes effect on the NEXT reply — the current turn's visibility is " +
      "already fixed. Switch to `streamer` when a casual thread turns into real work, or back to " +
      "`invisible` when it returns to banter. Omit to keep the current mode.",
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

const threadTitleField = z
  .string()
  .max(60)
  .optional()
  .describe(
    "Optional short label naming this DM conversation — a few descriptive words in the user's " +
      'language (e.g. "Bolt 5 upgrade questions"), NOT the user\'s message verbatim. Used as the ' +
      "thread title, set once on the opening turn. Omit to default to the opening message text.",
  );

const channelAttentionLevelReframeField = z
  .enum(["high", "medium", "low", "off"])
  .optional()
  .describe(
    "Adjust how eagerly Clack keeps following THIS CHANNEL's top-level conversation (the " +
      'ephemeral window that triggered this turn). Raise to "high" when the channel is actively ' +
      'talking with you, lower to "low" as it winds down, or "off" to stop following the channel ' +
      "entirely. Independent of `attention_level`, which governs the THREAD dial — both can be " +
      "set on the same turn. Omit to leave the window's current level unchanged.",
  );

// Schema with attention-level tuning but no skip_response (e.g. mentions)
const attentionLevelEnabledResponseSchema = {
  ...normalResponseSchema,
  attention_level: attentionLevelField,
  default_delivery_mode: deliveryModeField,
};

const skipResponseField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to decline answering. Use when the conversation doesn't need a Clack response " +
      "(e.g., users talking to each other, question already answered). When true, blocks and actions are not required.",
  );

const skipOptionalBlocks = z
  .array(BlockSchema, stringifiedParamHint("blocks"))
  .min(1)
  .optional()
  .describe("Slack Block Kit blocks shown to the user (not required when skip_response is true)");

const skipOptionalActions = z
  .array(actionSchema, stringifiedParamHint("actions"))
  .optional()
  .describe("Interactive buttons for the user to click (not required when skip_response is true)");

// Schema with skip_response AND disengage — used by autoRespond / threadReply triggers where
// both signals are meaningful (tracked conversations).
const skipEnabledResponseSchema = {
  ...normalResponseSchema,
  skip_response: skipResponseField,
  attention_level: attentionLevelField,
  default_delivery_mode: deliveryModeField,
  blocks: skipOptionalBlocks,
  actions: skipOptionalActions,
  suppress_unfurls: suppressUnfurlsField,
};

// Schema with skip_response only (no attention_level) — used by scheduled runs that opted in
// via `skipConditions`. Attention tuning is meaningless for scheduled triggers because there
// is no tracked conversation to adjust.
const skipOnlyResponseSchema = {
  ...normalResponseSchema,
  skip_response: skipResponseField,
  blocks: skipOptionalBlocks,
  actions: skipOptionalActions,
  suppress_unfurls: suppressUnfurlsField,
};

// Schema for runs declared `submitResponseMode: "skipped"`. The ONLY accepted field is
// `skip_response: true` — `blocks`, `actions`, `table`, `reactions`, `message`,
// `post_top_level`, and `attention_level` are all absent. Use when the run's actual deliverable
// is produced by another required tool and `submit_response` is purely a run terminator.
const skippedOnlyResponseSchema = {
  skip_response: z
    .literal(true)
    .describe(
      'REQUIRED to be `true`. This run\'s `submitResponseMode` is `"skipped"` — the actual deliverable ' +
        "was produced by another required tool, and `submit_response` is purely the run terminator. " +
        "The schema accepts ONLY `{ skip_response: true }` (optionally with `escalate_to_owner`) and " +
        "nothing else. Do NOT include `blocks`, `actions`, `table`, `reactions`, `message`, " +
        "`post_top_level`, or `attention_level`.",
    ),
  escalate_to_owner: escalateToOwnerField,
};

// Shared message-payload entity carried by each `deliver_to` entry's `response`. Builds on
// `messageContentFields` (blocks/table/reactions) and adds the per-message `actions`,
// `suppress_unfurls`, and `thread_replies`. It is routing-free: no `channel`, `thread_ts`,
// `skip_response`, `deliver_to`, or `additional_messages` — those belong to the entry/call that
// wraps it. A `post_to` action is NOT allowed in `actions` (validated in the handler).
const deliverToResponseSchema = z
  .object({
    ...messageContentFields,
    actions: z
      .array(
        z.lazy((): z.ZodType<Action> => actionSchema),
        stringifiedParamHint("actions"),
      )
      .optional()
      .describe(
        "Optional interactive buttons rendered on this delivered message. Same action types as a " +
          "normal response (followup, choice, change, …). A `post_to` action is NOT allowed here.",
      ),
    suppress_unfurls: suppressUnfurlsField,
    thread_replies: z
      .array(z.lazy((): z.ZodType<MessagePayload> => messagePayloadSchema))
      .max(THREAD_REPLIES_MAX)
      .optional()
      .describe(
        `Reply messages threaded under this delivered message (posted after it lands, using its ts as their thread_ts). Capped at ${THREAD_REPLIES_MAX}.`,
      ),
  })
  .strict();

const deliverToEntrySchema = z
  .object({
    channel: z
      .string()
      .describe(
        'REQUIRED explicit destination channel ID (e.g. "C0APQ9JU865"). This run has no bound ' +
          "channel, so every entry must name its own destination.",
      ),
    thread_ts: z
      .string()
      .optional()
      .describe(
        "Optional target thread timestamp. Set it to reply into an existing thread; omit to post " +
          "as a top-level message in `channel`.",
      ),
    attention_level: threadEngagementAttentionField,
    creation_context: creationContextField,
    default_delivery_mode: threadEngagementDeliveryModeField,
    channel_attention_level: channelAttentionLevelSeedField,
    response: deliverToResponseSchema,
  })
  .strict();

// Schema for runs declared `submitResponseMode: "optional-post-to"` (and every channelless
// run). There is no bound primary channel, so the primary delivery fields AND a top-level
// `actions`/`post_to` path are absent. The run delivers via one or more `deliver_to` entries
// (each naming an explicit `channel`) OR terminates with `skip_response: true`. The
// middleground between `"optional"` (full primary schema, may skip) and `"skipped"`
// (terminator only).
const optionalPostToResponseSchema = {
  skip_response: z
    .literal(true)
    .optional()
    .describe(
      "Set to `true` to decline posting this run (no `deliver_to`). This run has no bound primary " +
        "channel: deliver by emitting one or more `deliver_to` entries (each naming an explicit " +
        "`channel`), OR call `submit_response({ skip_response: true })` to decline. Do NOT include " +
        "`blocks`, `message`, `table`, `reactions`, `actions`, `post_top_level`, or `attention_level` " +
        "— they are rejected.",
    ),
  deliver_to: z
    .array(deliverToEntrySchema)
    .optional()
    .describe(
      "One or more destinations to deliver to. Each entry is `{ channel, thread_ts?, response }` " +
        "where `response` is the message payload (`blocks` plus optional `table`/`actions`/" +
        "`reactions`/`suppress_unfurls`/`thread_replies`). Send the same content to several channels " +
        "with repeated entries; post several separate messages to one channel with multiple entries " +
        "sharing a `channel`; reply into a thread by setting `thread_ts`.",
    ),
  escalate_to_owner: escalateToOwnerField,
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
  chart?: AuthoredChartBlock;
  reactions?: string[];
  actions?: Action[];
  suppress_unfurls?: boolean;
  skip_response?: boolean;
  attention_level?: AttentionLevel;
  default_delivery_mode?: DeliveryMode;
  post_top_level?: boolean;
  thread_title?: string;
  additional_messages?: MessagePayload[];
  thread_replies?: MessagePayload[];
  deliver_to?: DeliverToEntry[];
  escalate_to_owner?: string;
}

/**
 * Compose the input schema from the orthogonal flags on `deps`:
 *   - allowSkip, allowAttentionLevel, allowPostTopLevel, allowMultiMessage
 *   - submitResponseMode === "skipped" short-circuits everything else.
 *
 * Top-level `additional_messages` and `thread_replies` are gated on `allowMultiMessage`.
 * Only the scheduled (cron) trigger sets it. In DM, @mention, reaction, auto-respond,
 * thread-reply, and worker contexts the fields are hidden from Claude entirely — the
 * trigger channel is the user's conversation space and multi-message there is almost
 * never what they want. The `post_to.additional_messages` / `post_to.thread_replies`
 * fields stay available everywhere because `post_to` carries an explicit `channel`.
 */
export function buildSubmitResponseSchema(
  deps: Pick<
    SubmitResponseDeps,
    | "submitResponseMode"
    | "allowSkip"
    | "allowAttentionLevel"
    | "allowChannelAttentionLevel"
    | "allowPostTopLevel"
    | "allowThreadTitle"
    | "allowMultiMessage"
    | "maxAdditionalMessages"
  >,
): Record<string, z.ZodTypeAny> {
  if (deps.submitResponseMode === "skipped") {
    return skippedOnlyResponseSchema;
  }

  if (deps.submitResponseMode === "optional-post-to") {
    return optionalPostToResponseSchema;
  }

  let base: Record<string, z.ZodTypeAny>;
  if (deps.allowSkip && deps.allowAttentionLevel) {
    base = { ...skipEnabledResponseSchema };
  } else if (deps.allowSkip) {
    base = { ...skipOnlyResponseSchema };
  } else if (deps.allowAttentionLevel) {
    base = { ...attentionLevelEnabledResponseSchema };
  } else {
    base = { ...normalResponseSchema };
  }

  if (deps.allowPostTopLevel) {
    base.post_top_level = postTopLevelField;
  }

  if (deps.allowThreadTitle) {
    base.thread_title = threadTitleField;
  }

  if (deps.allowChannelAttentionLevel) {
    base.channel_attention_level = channelAttentionLevelReframeField;
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
    deliverToChannel,
    recordResponseTs,
    persistSnapshot,
    topLevelDeliveryChannel,
    sessionChannelId,
    sessionThreadTs,
    submitResponseMode,
    setChannelAttentionLevel,
    requiredTools,
    hasPendingInput,
    consumePendingPushedTexts,
    getBlockedFollowedThreads,
    getStructuredResponseBlocks = _getStructuredResponseBlocks,
    validateBlocks = _validateBlocks,
    validateTable = _validateTable,
    validateChart = _validateChart,
    validateActionButtonLabels = _validateActionButtonLabels,
    getResponseActionBlocks = _getResponseActionBlocks,
    appendStagedIntents = _appendStagedIntents,
    readInstructionFile = _readInstructionFile,
  } = deps;

  // Both "skipped" and "optional-post-to" omit the `message` field from the schema, so a bare
  // `skip_response: true` must bypass the SKIP_ACKNOWLEDGMENT check (there's no message to set).
  const skipBypassesAck =
    submitResponseMode === "skipped" || submitResponseMode === "optional-post-to";

  const schema = buildSubmitResponseSchema({
    submitResponseMode: deps.submitResponseMode,
    allowSkip: deps.allowSkip,
    allowAttentionLevel: deps.allowAttentionLevel,
    allowChannelAttentionLevel: deps.allowChannelAttentionLevel,
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

      // Capture an owner escalation (if any) FIRST — ahead of every gate and all validation.
      // A diagnostic is the operator's only signal that something broke, so it must survive a
      // call that is subsequently rejected; capturing it later loses it on exactly the failing
      // calls that most need reporting. Empty/whitespace counts as absent. Last non-empty wins
      // and it is never cleared, so a retry can revise it but omitting it cannot erase it.
      const escalateToOwner =
        "escalate_to_owner" in args && typeof args.escalate_to_owner === "string"
          ? args.escalate_to_owner.trim()
          : "";
      if (escalateToOwner) responseCapture.setEscalateToOwner(escalateToOwner);

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

      // --- deliver_to path (optional-post-to / channelless) ---
      // This mode has no bound primary channel. The run resolves to exactly one of three
      // outcomes (deliver-or-skip-or-error — see the `submit-response-deliver-to` capability):
      //   - non-empty `deliver_to`  → deliver each entry via the shared per-channel routine.
      //   - bare `skip_response`     → record a skip.
      //   - neither (or empty array) → a hard error returned to Claude (never a silent no-op).
      // A present `deliver_to` always wins over `skip_response` if Claude sets both.
      if (submitResponseMode === "optional-post-to") {
        const deliverTo =
          "deliver_to" in args && Array.isArray(args.deliver_to) ? args.deliver_to : undefined;

        if (!deliverTo || deliverTo.length === 0) {
          if ("skip_response" in args && args.skip_response) {
            responseCapture.setSkipped();
            const skipResult: SubmitResponseSuccessResult = { success: true, skipped: true };
            recordSuccess(recorder, args, skipResult);
            return textResult(skipResult);
          }
          return recordError(recorder, args, {
            error:
              "This run has no bound channel — a bare submit_response delivers nothing. Provide " +
              "`deliver_to` (one or more `{ channel, response }` entries) to post, or " +
              "`skip_response: true` to decline.",
          });
        }

        const deliverToErrors = validateDeliverToEntries(deliverTo, {
          intentStore,
          sessionId,
          validateBlocks,
          validateTable,
          validateChart,
          validateActionButtonLabels,
          getResponseActionBlocks,
        });
        if (deliverToErrors.length > 0) {
          return recordError(
            recorder,
            args,
            deliverToErrors.length === 1
              ? { error: deliverToErrors[0] }
              : { error: "invalid_batch", details: deliverToErrors },
          );
        }

        // Persist referenced staged intents before delivery, so a fast button click on a
        // delivered message can't outrun the writeback.
        await persistDeliverToIntents(deliverTo, intentStore, sessionId, appendStagedIntents);

        // Deliver each entry in array order via the shared per-channel routine. The first
        // entry's posted ts becomes the run's responseTs (the anchor cron status reads).
        let messagesDelivered = 0;
        let firstTs: string | undefined;
        const deliveryWarnings: string[] = [];
        if (deliverToChannel) {
          for (let i = 0; i < deliverTo.length; i++) {
            const entry = deliverTo[i];
            const res = await deliverToChannel({
              channel: entry.channel,
              ...(entry.thread_ts && { threadTs: entry.thread_ts }),
              payload: entry.response,
              ...(entry.attention_level && { attentionLevel: entry.attention_level }),
              ...(entry.creation_context && { creationContext: entry.creation_context }),
              ...(entry.default_delivery_mode && { deliveryMode: entry.default_delivery_mode }),
              ...(entry.channel_attention_level && {
                channelAttentionLevel: entry.channel_attention_level,
              }),
            });
            if (!res.ok) {
              const prior =
                messagesDelivered > 0
                  ? ` (${messagesDelivered} earlier ${messagesDelivered === 1 ? "entry" : "entries"} already posted to their channel(s); only retry the remaining entries to avoid duplicates)`
                  : "";
              return recordError(recorder, args, {
                error: "delivery_failed",
                details: `deliver_to[${i}]: ${res.error}${prior}`,
                messagesDelivered,
              });
            }
            messagesDelivered++;
            if (firstTs === undefined) firstTs = res.ts;
            if (res.warning) deliveryWarnings.push(`deliver_to[${i}]: ${res.warning}`);
          }
          // The messages have already landed — a failure to persist the anchor responseTs must
          // NOT turn a successful delivery into a tool error (which would make Claude retry and
          // double-post). Log and continue; cron status simply records success without the ts.
          if (firstTs && recordResponseTs) {
            try {
              await recordResponseTs(firstTs);
            } catch (err) {
              logger.warn(`deliver_to: failed to persist responseTs (delivery succeeded): ${err}`);
            }
          }
        }

        // Mark the run as delivered (not skipped) so it records as a success. The captured
        // payload is intentionally content-free — the real messages already landed in their
        // explicit channels above.
        responseCapture.set({ blocks: [], actions: [] }, []);
        const result: SubmitResponseSuccessResult = {
          success: true,
          delivered: !!deliverToChannel,
          ...(messagesDelivered > 0 && { messagesDelivered }),
          ...(deliveryWarnings.length > 0 && { warnings: deliveryWarnings }),
        };
        recordSuccess(recorder, args, result);
        return textResult(result);
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
        if (!skipBypassesAck) {
          const message = "message" in args ? args.message : undefined;
          if (message !== SKIP_ACKNOWLEDGMENT) {
            return recordError(recorder, args, {
              error: `To skip a response, the message field must be exactly: "${SKIP_ACKNOWLEDGMENT}"`,
            });
          }
        }
        const newLevel = "attention_level" in args ? args.attention_level : undefined;
        const newMode = "default_delivery_mode" in args ? args.default_delivery_mode : undefined;
        responseCapture.setSkipped();
        if (newLevel) {
          responseCapture.setAttentionLevel(newLevel);
        }
        if (newMode) {
          responseCapture.setDeliveryMode(newMode);
        }
        const newChannelLevel = await applyChannelAttentionLevel(args, setChannelAttentionLevel);
        const result: SubmitResponseSuccessResult = {
          success: true,
          skipped: true,
          ...(newLevel && { attentionLevel: newLevel }),
          ...(newLevel === "off" && { disengaged: true as const }),
          ...(newMode && { deliveryMode: newMode }),
          ...(newChannelLevel && { channelAttentionLevel: newChannelLevel }),
        };
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
      const chart: AuthoredChartBlock | undefined =
        "chart" in args && args.chart ? (args.chart as AuthoredChartBlock) : undefined;
      const wantsPostTopLevel = "post_top_level" in args && args.post_top_level === true;

      // When the response itself is posted top-level to the session's channel, guard against
      // a duplicate `post_to` action targeting that same channel.
      const effectiveTopLevelChannel =
        topLevelDeliveryChannel ?? (wantsPostTopLevel ? sessionChannelId : undefined);

      // --- §7 collect-all aggregator: every validation error in the batch goes into one
      // `details: string[]` so Claude can fix everything in a single retry instead of
      // per-error round-trips. The earlier early-return gates (pending-input, required-tools,
      // skip path) are NOT part of this — they're pre-validation handler-level gates.

      // Per-message validation: blocks, table, length budget. Each message gets its own
      // 10,000-char budget — no aggregate sum across the batch. Kept separate from
      // action errors: formatting-class failures gate the response-rendering hint below.
      const formattingErrors: string[] = [];
      const batchMessages = enumerateBatchMessages(args);
      for (const m of batchMessages) {
        formattingErrors.push(
          ...validateSingleMessage({
            blocks: m.blocks,
            ...(m.table && { table: m.table }),
            ...(m.chart && { chart: m.chart }),
            ...(m.message && { message: m.message }),
            pathPrefix: m.pathPrefix,
            validateBlocks,
            validateTable,
            validateChart,
          }),
        );
      }

      // Walk the full batch once — primary actions plus every follower's actions, descending
      // into post_to subtrees. The same FlatAction[] feeds every batch-wide validator.
      const blockedFollowedThreads = getBlockedFollowedThreads
        ? await getBlockedFollowedThreads()
        : undefined;
      const { errors: actionErrors, flat: flatActions } = collectActionErrors(
        args,
        intentStore,
        effectiveTopLevelChannel,
        blockedFollowedThreads,
      );
      const errors = [...formattingErrors, ...actionErrors];

      if (errors.length > 0) {
        // Formatting failures without the rendering guidance loaded get a corrective hint —
        // the retry round-trip is already happening, so the hint rides it for free. Action
        // errors alone never hint (the topic wouldn't help there).
        const hint =
          formattingErrors.length > 0 &&
          deps.isResponseRenderingAttached !== undefined &&
          !deps.isResponseRenderingAttached()
            ? {
                hint: 'Formatting rules for blocks and tables are documented in the response-rendering topic — call attach_integration("response-rendering") to load them before retrying.',
              }
            : {};
        // Preserve backward-compatible error shape when there's a single error: surface it
        // directly in `error` (matches today's "error contains the human-readable message"
        // contract). For multi-error batches, use `error: "invalid_batch"` and put every
        // path-prefixed error in `details`. Documented in design.md decision 5 / task 7.2.
        return recordError(
          recorder,
          args,
          errors.length === 1
            ? { error: errors[0], ...hint }
            : { error: "invalid_batch", details: errors, ...hint },
        );
      }

      // Pick operation-aware labels for `config_update` actions backed by a delete intent.
      // Runs after validation (every ref is known to resolve) and before any rendering or
      // persistence (so snapshots and rendered blocks see the final label).
      stampConfigUpdateLabels(flatActions, intentStore, readInstructionFile);

      const message = "message" in args ? args.message : undefined;
      const payload: SubmitResponsePayload = {
        ...(message && { message }),
        blocks,
        ...(table && { table }),
        ...(chart && { chart }),
        actions,
        ...(args.additional_messages && { additionalMessages: args.additional_messages }),
        ...(args.thread_replies && { threadReplies: args.thread_replies }),
        ...(args.thread_title && { thread_title: args.thread_title }),
      };

      // Persist a replayable snapshot for each post_to action (deferred button-click delivery).
      if (persistSnapshot) await persistPostToSnapshots(payload.actions, persistSnapshot);

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
      const nestedLabelErrors = validateNestedPostToButtonLabels(
        payload.actions,
        sessionId,
        getResponseActionBlocks,
        validateActionButtonLabels,
      );
      if (nestedLabelErrors.length > 0) {
        return recordError(recorder, args, { error: "invalid_blocks", details: nestedLabelErrors });
      }

      const reactions =
        "reactions" in args && Array.isArray(args.reactions) ? args.reactions : undefined;

      // Persist every referenced staged intent BEFORE delivery, so a fast button click can't
      // outrun the writeback and hit the misleading "expired" error.
      await persistReferencedIntents(actions, intentStore, sessionId, appendStagedIntents);

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
          // Anchor replies under the primary we just posted. thread_replies is exposed only in
          // the scheduled (cron) trigger, where sessionThreadTs is a synthetic Date.now() sentinel
          // (not a real Slack message) — routing to it makes Slack post replies top-level instead
          // of threading them. sessionThreadTs is a fallback only if the primary returned no ts.
          const replyThreadTs = primaryTs ?? sessionThreadTs;
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

      const newLevel = "attention_level" in args ? args.attention_level : undefined;
      const newMode = "default_delivery_mode" in args ? args.default_delivery_mode : undefined;
      if (newLevel) {
        responseCapture.setAttentionLevel(newLevel);
      }
      if (newMode) {
        responseCapture.setDeliveryMode(newMode);
      }
      if (wantsPostTopLevel) {
        responseCapture.setPostedTopLevel();
      }
      const newChannelLevel = await applyChannelAttentionLevel(args, setChannelAttentionLevel);

      const result: SubmitResponseSuccessResult = {
        success: true,
        delivered: !!deliver,
        blocksCount: blocks.length,
        actionsCount: actions.length,
        ...(messagesDelivered > 0 && { messagesDelivered }),
        ...(newLevel && { attentionLevel: newLevel }),
        ...(newLevel === "off" && { disengaged: true as const }),
        ...(newMode && { deliveryMode: newMode }),
        ...(wantsPostTopLevel && { postedTopLevel: true as const }),
        ...(newChannelLevel && { channelAttentionLevel: newChannelLevel }),
      };
      recordSuccess(recorder, args, result);

      return textResult(result);
    },
  );
}
