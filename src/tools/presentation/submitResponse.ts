import { randomBytes } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { DeliverFn, ResponseSnapshot, PostToAction } from "../types.js";
import { textResult } from "../helpers.js";
import {
  getStructuredResponseBlocks,
  getResponseActionBlocks,
  validateSlackBlocks,
  asSlackBlocks,
} from "../../slack/blocks.js";

const sectionSchema = z.object({
  title: z.string().optional().describe("Optional bold section title"),
  body: z.string().describe("Section body text (supports Slack mrkdwn)"),
});

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
  content: z
    .string()
    .describe(
      "The exact text to post. Each post_to action posts only its own content. When presenting multiple options, put each option's text in its own action's content field.",
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

const actionSchema = z.discriminatedUnion("type", [
  followupActionSchema,
  choiceActionSchema,
  postToActionSchema,
  changeActionSchema,
  configUpdateActionSchema,
  updateActionSchema,
]);

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
  /** When true, the skip_response parameter is available in the schema. */
  allowSkip?: boolean;
}

function validateRefActions(
  actions: z.infer<typeof actionSchema>[],
  intentStore: IntentStore,
): string | null {
  for (const action of actions) {
    if (!REF_ACTION_TYPES.has(action.type) || !("ref" in action)) continue;
    const intent = intentStore.resolve(action.ref);
    if (!intent) {
      return `Action type "${action.type}" references unknown ref "${action.ref}". Call the corresponding action tool first (e.g., propose_change, request_merge).`;
    }
    if (intent.type !== action.type) {
      return `Ref "${action.ref}" is a "${intent.type}" intent but action type is "${action.type}".`;
    }
  }
  return null;
}

function validatePostToActions(
  actions: z.infer<typeof actionSchema>[],
  topLevelDeliveryChannel?: string,
): string | null {
  for (const action of actions) {
    if (action.type !== "post_to") continue;
    if (action.auto && !action.channel) {
      return `post_to with auto: true requires an explicit channel ID. Provide the target channel (e.g., "C0APQ9JU865"). Use list_repositories or check the conversation context for channel IDs.`;
    }
    if (!action.content.trim()) {
      return `post_to action has empty content. Provide the text to post.`;
    }
    // In scheduled mode, submit_response already delivers top-level to the target channel.
    // A post_to targeting the same channel without a thread would duplicate the message.
    if (
      topLevelDeliveryChannel &&
      action.channel === topLevelDeliveryChannel &&
      !action.thread_ts
    ) {
      return `submit_response already posts top-level to channel ${topLevelDeliveryChannel}. Remove this post_to action — it would duplicate the message. Use post_to only for a DIFFERENT channel or a specific thread.`;
    }
  }
  return null;
}

function buildTexts(sections: z.infer<typeof sectionSchema>[], message?: string) {
  const answerText = sections
    .map((s) => (s.title ? `**${s.title}**\n${s.body}` : s.body))
    .join("\n\n");
  const displayText = message ? `${message}\n\n${answerText}` : answerText;
  return { answerText, displayText };
}

function recordError(recorder: ToolCallRecorder, args: unknown, errData: Record<string, unknown>) {
  recorder.record("submit_response", args as Record<string, unknown>, errData);
  return { ...textResult(errData), isError: true as const };
}

// Schema for the normal response path
const normalResponseSchema = {
  message: z
    .string()
    .optional()
    .describe(
      "Short conversational preamble shown to the user but NOT included when sharing via post_to. " +
        "Use for meta-commentary like 'Here is the updated version:' or 'I adjusted the tone:'. " +
        "Put the actual shareable content in sections.",
    ),
  sections: z.array(sectionSchema).min(1).describe("Response sections shown to the user"),
  actions: z
    .array(actionSchema)
    .describe(
      "Interactive buttons for the user to click. Use an empty array for casual/conversational responses that don't need actions.",
    ),
};

// Schema with skip_response support
const skipEnabledResponseSchema = {
  ...normalResponseSchema,
  skip_response: z
    .boolean()
    .optional()
    .describe(
      "Set to true to decline answering. Use when the conversation doesn't need a Clack response " +
        "(e.g., users talking to each other, question already answered). When true, sections and actions are not required.",
    ),
  // Override sections and actions to be optional when skip is used
  sections: z
    .array(sectionSchema)
    .min(1)
    .optional()
    .describe("Response sections shown to the user (not required when skip_response is true)"),
  actions: z
    .array(actionSchema)
    .optional()
    .describe(
      "Interactive buttons for the user to click (not required when skip_response is true)",
    ),
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
    allowSkip,
  } = deps;

  const schema = allowSkip ? skipEnabledResponseSchema : normalResponseSchema;

  return tool(
    "submit_response",
    "Submit the final response to the user. This defines what the user sees: text sections and interactive buttons. Always call this tool to deliver your response.",
    schema,
    async (args) => {
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
        responseCapture.setSkipped();
        const result = { success: true, skipped: true };
        recorder.record("submit_response", args as unknown as Record<string, unknown>, result);
        return textResult(result);
      }

      // --- Normal response path ---
      const sections = "sections" in args ? args.sections : undefined;
      const actions = "actions" in args ? args.actions : undefined;
      if (!sections || sections.length === 0) {
        return recordError(recorder, args, {
          error: "sections is required with at least 1 item when not skipping.",
        });
      }
      if (!actions) {
        return recordError(recorder, args, { error: "actions is required when not skipping." });
      }

      const refError = validateRefActions(actions, intentStore);
      if (refError) {
        return recordError(recorder, args, { error: refError });
      }

      const postToError = validatePostToActions(actions, topLevelDeliveryChannel);
      if (postToError) {
        return recordError(recorder, args, { error: postToError });
      }

      const message = "message" in args ? args.message : undefined;
      const payload = {
        ...(message && { message }),
        sections,
        actions,
      };

      const { displayText } = buildTexts(sections, message);

      const SLACK_MESSAGE_TEXT_LIMIT = 10000;
      if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
        return recordError(recorder, args, {
          error: "response_too_long",
          details: `Total response text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char limit. Significantly shorten your answer — summarize key points and offer followup actions to expand on specific areas.`,
        });
      }

      // Persist per-button content for each post_to action
      if (persistSnapshot) {
        for (const action of payload.actions) {
          if (action.type === "post_to") {
            const contentId = randomBytes(6).toString("hex");
            const content = action.content;
            await persistSnapshot(contentId, { text: content, sections: [{ body: content }] });
            (action as PostToAction)._snapshotId = contentId;
          }
        }
      }

      const renderedBlocks = getStructuredResponseBlocks(payload, sessionId) as Record<
        string,
        unknown
      >[];
      const validationErrors = validateSlackBlocks(renderedBlocks);

      if (validationErrors.length > 0) {
        return recordError(recorder, args, {
          error: "invalid_blocks",
          details: validationErrors.map((e) => `${e.field}: ${e.message}`),
        });
      }

      if (deliver) {
        const actionBlocks = getResponseActionBlocks(payload.actions, sessionId);
        const deliveryResult = await deliver({
          markdownText: displayText,
          ...(actionBlocks.length > 0 && { blocks: asSlackBlocks(actionBlocks) }),
        });

        if (!deliveryResult.ok) {
          return recordError(recorder, args, {
            error: "delivery_failed",
            details: deliveryResult.error,
          });
        }
      }

      responseCapture.set(payload, renderedBlocks);

      const result = {
        success: true,
        delivered: !!deliver,
        sectionsCount: sections.length,
        actionsCount: actions.length,
      };
      recorder.record("submit_response", args as unknown as Record<string, unknown>, result);

      return textResult(result);
    },
  );
}
