import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { logger } from "../../logger.js";

const MAX_CONTENT_BYTES = 500 * 1024; // 500KB

export function createUploadFileTool(ctx: QueryToolContext) {
  return tool(
    "upload_file",
    "Upload generated content (CSV, JSON, Markdown, code, config files) to Slack as a file attachment. " +
      "Use this when the user asks for exportable data, when displaying file contents, or when a response is too large for a chat message. " +
      "You must still call submit_response after uploading to explain what you uploaded.",
    {
      content: z.string().describe("The file content to upload"),
      filename: z.string().describe("Filename with extension (e.g. 'report.csv', 'config.md')"),
      title: z.string().optional().describe("Display title in Slack (defaults to filename)"),
      channel: z
        .string()
        .optional()
        .describe(
          "Target channel ID. Only provide when the user explicitly asked to upload to a DIFFERENT channel than the current one. Omit to upload to the current channel.",
        ),
      thread_ts: z
        .string()
        .optional()
        .describe(
          "Target thread timestamp. Only provide when the user explicitly asked to post in a DIFFERENT thread than the current one (e.g. they shared a Slack message URL). Never fabricate this — omit it to post in the current thread.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("File upload requires a Slack connection");
      }

      // Validate content
      if (!args.content.trim()) {
        return errorResult("Content must be non-empty");
      }

      const contentBytes = Buffer.byteLength(args.content, "utf-8");
      if (contentBytes > MAX_CONTENT_BYTES) {
        return errorResult(
          `Content is too large (${Math.round(contentBytes / 1024)}KB). ` +
            `Maximum is ${MAX_CONTENT_BYTES / 1024}KB. Summarize or split the content.`,
        );
      }

      const channelId = args.channel ?? ctx.session.channelId;
      const threadTs =
        args.thread_ts ?? (channelId === ctx.session.channelId ? ctx.session.threadTs : undefined);

      try {
        const uploadArgs = {
          channel_id: channelId,
          content: args.content,
          filename: args.filename,
          title: args.title ?? args.filename,
        };
        const result = await ctx.slackClient.filesUploadV2(
          threadTs ? { ...uploadArgs, thread_ts: threadTs } : uploadArgs,
        );

        const file = result.files?.[0]?.files?.[0];

        return textResult({
          ok: true,
          file_id: file?.id ?? null,
          permalink: file?.permalink ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error("Failed to upload file to Slack:", error);
        return errorResult(`Failed to upload file to Slack: ${message}`);
      }
    },
  );
}
