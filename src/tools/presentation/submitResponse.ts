import { randomBytes } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import type { DeliverFn, ResponseSnapshot, SendToThreadAction } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getStructuredResponseBlocks, getResponseActionBlocks, validateSlackBlocks, asSlackBlocks } from "../../slack/blocks.js";

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
  workMode: z.boolean().optional().describe("If true, enables work mode when clicked (use for choices that request code changes)"),
});

const sendToThreadActionSchema = z.object({
  type: z.literal("send_to_thread"),
  label: z.string().optional().describe("Custom button label (default: 'Send to thread')"),
  auto: z.boolean().optional().describe("If true, post the answer to the original channel thread immediately without waiting for button click"),
  channel: z.string().optional().describe("Explicit target channel ID. Use when sharing findings to a different thread than the origin (e.g., a thread the user shared via URL)."),
  thread_ts: z.string().optional().describe("Explicit target thread timestamp. Use with channel to post into a specific thread."),
  content: z.string().describe("The exact text this button will post to the thread. Each send_to_thread button posts only its own content. When presenting multiple options, put each option's text in its own button's content field."),
});

const changeActionSchema = z.object({
  type: z.literal("change"),
  ref: z.string().describe("Ref ID from propose_change"),
  label: z.string().optional().describe("Custom button label (default: 'Start Change')"),
  auto: z.boolean().optional().describe("If true, execute immediately without waiting for button click"),
});

const configUpdateActionSchema = z.object({
  type: z.literal("config_update"),
  ref: z.string().describe("Ref ID from propose_config_update"),
  label: z.string().optional().describe("Custom button label (default: 'Apply Update')"),
  auto: z.boolean().optional().describe("If true, execute immediately without waiting for button click"),
});

const updateActionSchema = z.object({
  type: z.literal("update"),
  ref: z.string().describe("Ref ID from request_update"),
  label: z.string().optional().describe("Custom button label (default: 'Update')"),
  auto: z.boolean().optional().describe("If true, execute immediately without waiting for button click"),
});

const actionSchema = z.discriminatedUnion("type", [
  followupActionSchema,
  choiceActionSchema,
  sendToThreadActionSchema,
  changeActionSchema,
  configUpdateActionSchema,
  updateActionSchema,
]);

// Ref-based action types that need validation
const REF_ACTION_TYPES = new Set(["change", "config_update", "update"]);

export interface SubmitResponseDeps {
  intentStore: IntentStore;
  responseCapture: ResponseCapture;
  recorder: ToolCallRecorder;
  sessionId: string;
  deliver?: DeliverFn;
  persistSnapshot?: (id: string, snapshot: ResponseSnapshot) => Promise<void>;
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

function buildTexts(sections: z.infer<typeof sectionSchema>[], message?: string) {
  const answerText = sections
    .map((s) => (s.title ? `**${s.title}**\n${s.body}` : s.body))
    .join("\n\n");
  const displayText = message ? `${message}\n\n${answerText}` : answerText;
  return { answerText, displayText };
}

function recordError(
  recorder: ToolCallRecorder,
  args: unknown,
  errData: Record<string, unknown>,
) {
  recorder.record("submit_response", args as Record<string, unknown>, errData);
  return { ...textResult(errData), isError: true as const };
}

export function createSubmitResponseTool(deps: SubmitResponseDeps) {
  const { intentStore, responseCapture, recorder, sessionId, deliver, persistSnapshot } = deps;
  return tool(
    "submit_response",
    "Submit the final response to the user. This defines what the user sees: text sections and interactive buttons. Always call this tool to deliver your response.",
    {
      message: z.string().optional().describe(
        "Short conversational preamble shown to the user but NOT included when sharing via send_to_thread. " +
        "Use for meta-commentary like 'Here is the updated version:' or 'I adjusted the tone:'. " +
        "Put the actual shareable content in sections."
      ),
      sections: z
        .array(sectionSchema)
        .min(1)
        .describe("Response sections shown to the user"),
      actions: z
        .array(actionSchema)
        .describe("Interactive buttons for the user to click. Use an empty array for casual/conversational responses that don't need actions."),
    },
    async (args) => {
      const refError = validateRefActions(args.actions, intentStore);
      if (refError) {
        recorder.record("submit_response", args as unknown as Record<string, unknown>, { error: refError });
        return errorResult(refError);
      }

      const payload = {
        ...(args.message && { message: args.message }),
        sections: args.sections,
        actions: args.actions,
      };

      const { displayText } = buildTexts(args.sections, args.message);

      const SLACK_MESSAGE_TEXT_LIMIT = 10000;
      if (displayText.length > SLACK_MESSAGE_TEXT_LIMIT) {
        return recordError(recorder, args, {
          error: "response_too_long",
          details: `Total response text (${displayText.length} chars) exceeds the ${SLACK_MESSAGE_TEXT_LIMIT}-char limit. Significantly shorten your answer — summarize key points and offer followup actions to expand on specific areas.`,
        });
      }

      // Persist per-button content for each send_to_thread action
      if (persistSnapshot) {
        for (const action of payload.actions) {
          if (action.type === "send_to_thread") {
            const contentId = randomBytes(6).toString("hex");
            const content = (action as SendToThreadAction).content;
            await persistSnapshot(contentId, { text: content, sections: [{ body: content }] });
            (action as SendToThreadAction)._snapshotId = contentId;
          }
        }
      }

      const renderedBlocks = getStructuredResponseBlocks(payload, sessionId) as Record<string, unknown>[];
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

      const result = { success: true, delivered: !!deliver, sectionsCount: args.sections.length, actionsCount: args.actions.length };
      recorder.record("submit_response", args as unknown as Record<string, unknown>, result);

      return textResult(result);
    }
  );
}
