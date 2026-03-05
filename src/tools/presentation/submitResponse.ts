import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { IntentStore, ResponseCapture, ToolCallRecorder } from "../server.js";
import { getStructuredResponseBlocks, validateSlackBlocks } from "../../slack/blocks.js";

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

const sectionSchema = z.object({
  title: z.string().optional().describe("Optional bold section title"),
  body: z.string().describe("Section body text (supports Slack mrkdwn)"),
});

// Ref-based action types that need validation
const REF_ACTION_TYPES = new Set(["change", "config_update", "update"]);

export function createSubmitResponseTool(
  intentStore: IntentStore,
  responseCapture: ResponseCapture,
  recorder: ToolCallRecorder,
  sessionId: string
) {
  return tool(
    "submit_response",
    "Submit the final response to the user. This defines what the user sees: text sections and interactive buttons. Always call this tool to deliver your response.",
    {
      sections: z
        .array(sectionSchema)
        .min(1)
        .describe("Response sections shown to the user"),
      actions: z
        .array(actionSchema)
        .describe("Interactive buttons for the user to click. Use an empty array for casual/conversational responses that don't need actions."),
    },
    async (args) => {
      // Validate that all ref-based actions reference valid staged intents
      for (const action of args.actions) {
        if (REF_ACTION_TYPES.has(action.type) && "ref" in action) {
          const intent = intentStore.resolve(action.ref);
          if (!intent) {
            const errorResult = {
              error: `Action type "${action.type}" references unknown ref "${action.ref}". Call the corresponding action tool first (e.g., propose_change, request_merge).`,
            };
            recorder.record("submit_response", args as unknown as Record<string, unknown>, errorResult);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
              isError: true,
            };
          }
          // Validate ref type matches action type
          if (intent.type !== action.type) {
            const errorResult = {
              error: `Ref "${action.ref}" is a "${intent.type}" intent but action type is "${action.type}".`,
            };
            recorder.record("submit_response", args as unknown as Record<string, unknown>, errorResult);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
              isError: true,
            };
          }
        }
      }

      // Render and validate blocks before capturing
      const payload = {
        sections: args.sections,
        actions: args.actions,
      };
      const renderedBlocks = getStructuredResponseBlocks(payload, sessionId) as Record<string, unknown>[];
      const validationErrors = validateSlackBlocks(renderedBlocks);

      if (validationErrors.length > 0) {
        const errorResult = {
          error: "invalid_blocks",
          details: validationErrors.map((e) => `${e.field}: ${e.message}`),
        };
        recorder.record("submit_response", args as unknown as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      // Capture the validated payload and pre-rendered blocks
      responseCapture.set(payload, renderedBlocks);

      const result = { success: true, sectionsCount: args.sections.length, actionsCount: args.actions.length };
      recorder.record("submit_response", args as unknown as Record<string, unknown>, result);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );
}
