import { randomBytes } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { Action, DeliverFn, ResponseSnapshot, SubmitResponsePayload } from "../types.js";
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
  /** When true, the disengage parameter is available in the schema. */
  allowDisengage?: boolean;
  /**
   * When true, the `post_top_level` parameter is available in the schema. Claude can set it
   * per-response to route the reply as a top-level channel message instead of a thread reply.
   */
  allowPostTopLevel?: boolean;
  /**
   * Fully-qualified MCP tool names that must appear in the recorder's history before delivery
   * is accepted. Enforced by a gate at the top of the handler.
   */
  requiredTools?: string[];
  getStructuredResponseBlocks?: typeof _getStructuredResponseBlocks;
  validateBlocks?: typeof _validateBlocks;
  validateTable?: typeof _validateTable;
  validateActionButtonLabels?: typeof _validateActionButtonLabels;
  getResponseActionBlocks?: typeof _getResponseActionBlocks;
}

/**
 * Walks every action in the response — both top-level entries and entries
 * nested inside `post_to.actions` — yielding each with a path label like
 * `"actions[0]"` or `"actions[0].actions[1]"`. Used by validators that should
 * treat nested actions identically to top-level ones.
 */
interface FlatAction {
  action: Action;
  path: string;
  parentIsPostTo: boolean;
}

function flattenActions(actions: z.infer<typeof actionSchema>[]): FlatAction[] {
  const flat: FlatAction[] = [];
  actions.forEach((action, i) => {
    const path = `actions[${i}]`;
    flat.push({ action, path, parentIsPostTo: false });
    if (action.type === "post_to" && action.actions) {
      action.actions.forEach((nested, j) => {
        flat.push({
          action: nested,
          path: `${path}.actions[${j}]`,
          parentIsPostTo: true,
        });
      });
    }
  });
  return flat;
}

function validateRefActions(
  actions: z.infer<typeof actionSchema>[],
  intentStore: IntentStore,
): string | null {
  for (const { action, path } of flattenActions(actions)) {
    if (!REF_ACTION_TYPES.has(action.type) || !("ref" in action)) continue;
    const intent = intentStore.resolve(action.ref);
    if (!intent) {
      return `${path}: Action type "${action.type}" references unknown ref "${action.ref}". Call the corresponding action tool first (e.g., propose_change, request_merge).`;
    }
    if (intent.type !== action.type) {
      return `${path}: Ref "${action.ref}" is a "${intent.type}" intent but action type is "${action.type}".`;
    }
  }
  return null;
}

function validatePostToActions(
  actions: z.infer<typeof actionSchema>[],
  topLevelDeliveryChannel?: string,
): string | null {
  for (const { action, path, parentIsPostTo } of flattenActions(actions)) {
    if (action.type !== "post_to") continue;
    // Nested post_to is rejected — the recursion has no useful semantics
    // (cross-posted message that itself triggers another cross-post) and would
    // complicate auto-delivery and snapshot persistence.
    if (parentIsPostTo) {
      return `${path}: Nested post_to is not supported. Use a separate top-level post_to action instead.`;
    }
    if (action.auto && !action.channel) {
      return `${path}: post_to with auto: true requires an explicit channel ID. Provide the target channel (e.g., "C0APQ9JU865"). Use list_repositories or check the conversation context for channel IDs.`;
    }
    if (action.blocks.length === 0) {
      return `${path}: post_to action has empty blocks. Provide at least one block to post.`;
    }
    // In scheduled mode, submit_response already delivers top-level to the target channel.
    // A post_to targeting the same channel without a thread would duplicate the message.
    if (
      topLevelDeliveryChannel &&
      action.channel === topLevelDeliveryChannel &&
      !action.thread_ts
    ) {
      return `${path}: submit_response already posts top-level to channel ${topLevelDeliveryChannel}. Remove this post_to action — it would duplicate the message. Use post_to only for a DIFFERENT channel or a specific thread.`;
    }
  }
  return null;
}

function validateStagedIntentsCoverage(
  actions: z.infer<typeof actionSchema>[],
  intentStore: IntentStore,
): string | null {
  const allIntents = intentStore.getAll();
  if (allIntents.size === 0) return null;

  const actionRefs = new Set<string>();
  for (const { action } of flattenActions(actions)) {
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
}

function recordSuccess<TArgs extends object>(
  recorder: ToolCallRecorder,
  args: TArgs,
  result: SubmitResponseSuccessResult,
): void {
  recorder.record("submit_response", args, result);
}

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
};

// Schema with skip_response only (no disengage) — used by scheduled runs that opted in via
// `skipConditions`. Disengage is meaningless for scheduled triggers because there is no
// tracked conversation to deactivate.
const skipOnlyResponseSchema = {
  ...normalResponseSchema,
  skip_response: skipResponseField,
  blocks: skipOptionalBlocks,
  actions: skipOptionalActions,
};

// Schema variants with post_top_level added. We build them as distinct objects rather than
// dynamic merges so zod's type inference stays precise at the tool boundary.
const normalResponseSchemaWithPostTopLevel = {
  ...normalResponseSchema,
  post_top_level: postTopLevelField,
};

const disengageEnabledResponseSchemaWithPostTopLevel = {
  ...disengageEnabledResponseSchema,
  post_top_level: postTopLevelField,
};

const skipEnabledResponseSchemaWithPostTopLevel = {
  ...skipEnabledResponseSchema,
  post_top_level: postTopLevelField,
};

const skipOnlyResponseSchemaWithPostTopLevel = {
  ...skipOnlyResponseSchema,
  post_top_level: postTopLevelField,
};

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
    allowSkip,
    allowDisengage,
    allowPostTopLevel,
    requiredTools,
    getStructuredResponseBlocks = _getStructuredResponseBlocks,
    validateBlocks = _validateBlocks,
    validateTable = _validateTable,
    validateActionButtonLabels = _validateActionButtonLabels,
    getResponseActionBlocks = _getResponseActionBlocks,
  } = deps;

  const schema = allowSkip
    ? allowDisengage
      ? allowPostTopLevel
        ? skipEnabledResponseSchemaWithPostTopLevel
        : skipEnabledResponseSchema
      : allowPostTopLevel
        ? skipOnlyResponseSchemaWithPostTopLevel
        : skipOnlyResponseSchema
    : allowDisengage
      ? allowPostTopLevel
        ? disengageEnabledResponseSchemaWithPostTopLevel
        : disengageEnabledResponseSchema
      : allowPostTopLevel
        ? normalResponseSchemaWithPostTopLevel
        : normalResponseSchema;

  return tool(
    "submit_response",
    "Submit the final response to the user. IMPORTANT: calling this tool ENDS the conversation — you cannot take any further actions afterward. If your response mentions doing something (e.g., 'Let me set that up', 'I'll create a PR'), you MUST have already called the relevant tools BEFORE calling submit_response. Never promise future actions in your response text — either do them first or don't mention them. This defines what the user sees: text sections and interactive buttons. Always call this tool to deliver your response.",
    schema,
    async (args) => {
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
        const message = "message" in args ? args.message : undefined;
        if (message !== SKIP_ACKNOWLEDGMENT) {
          return recordError(recorder, args, {
            error: `To skip a response, the message field must be exactly: "${SKIP_ACKNOWLEDGMENT}"`,
          });
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

      // Validate the source blocks (friendly error with field path, current length, limit).
      const blockErrors = validateBlocks(blocks);
      if (blockErrors.length > 0) {
        return recordError(recorder, args, {
          error: "invalid_blocks",
          details: blockErrors.map((e) => `${e.field}: ${e.message}`),
        });
      }

      // Validate the optional top-level `table` parameter.
      const table: AuthoredTableBlock | undefined =
        "table" in args && args.table ? (args.table as AuthoredTableBlock) : undefined;
      if (table) {
        const tableErrors = validateTable(table, "table");
        if (tableErrors.length > 0) {
          return recordError(recorder, args, {
            error: "invalid_blocks",
            details: tableErrors.map((e) => `${e.field}: ${e.message}`),
          });
        }
      }

      // Validate the blocks (and optional table) attached to each post_to action.
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.type !== "post_to") continue;
        const postToErrors = validateBlocks(action.blocks);
        if (postToErrors.length > 0) {
          return recordError(recorder, args, {
            error: "invalid_blocks",
            details: postToErrors.map((e) => `actions[${i}].${e.field}: ${e.message}`),
          });
        }
        if (action.table) {
          const postToTableErrors = validateTable(
            action.table as AuthoredTableBlock,
            `actions[${i}].table`,
          );
          if (postToTableErrors.length > 0) {
            return recordError(recorder, args, {
              error: "invalid_blocks",
              details: postToTableErrors.map((e) => `${e.field}: ${e.message}`),
            });
          }
        }
      }

      const wantsPostTopLevel = "post_top_level" in args && args.post_top_level === true;

      // When the response itself is posted top-level to the session's channel, guard against
      // a duplicate `post_to` action targeting that same channel.
      const effectiveTopLevelChannel =
        topLevelDeliveryChannel ?? (wantsPostTopLevel ? sessionChannelId : undefined);

      const refError = validateRefActions(actions, intentStore);
      if (refError) {
        return recordError(recorder, args, { error: refError });
      }

      const postToError = validatePostToActions(actions, effectiveTopLevelChannel);
      if (postToError) {
        return recordError(recorder, args, { error: postToError });
      }

      const intentCoverageError = validateStagedIntentsCoverage(actions, intentStore);
      if (intentCoverageError) {
        return recordError(recorder, args, { error: intentCoverageError });
      }

      const message = "message" in args ? args.message : undefined;
      const payload: SubmitResponsePayload = {
        ...(message && { message }),
        blocks,
        ...(table && { table }),
        actions,
      };

      const { displayText } = buildTexts(blocks, message);

      const SLACK_MESSAGE_TEXT_LIMIT = 10000;
      if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
        return recordError(recorder, args, {
          error: "response_too_long",
          details: `Total response text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char limit. Significantly shorten your answer — summarize key points and offer followup actions to expand on specific areas.`,
        });
      }

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

      if (deliver) {
        const deliveryResult = await deliver({
          blocks: renderedBlocks,
          ...(reactions?.length && { reactions }),
          ...(wantsPostTopLevel && { postTopLevel: true }),
        });

        if (!deliveryResult.ok) {
          return recordError(recorder, args, {
            error: "delivery_failed",
            details: deliveryResult.error,
          });
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
        ...(wantsDisengage && { disengaged: true as const }),
        ...(wantsPostTopLevel && { postedTopLevel: true as const }),
      };
      recordSuccess(recorder, args, result);

      return textResult(result);
    },
  );
}
