import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { getCachedFilePath, readCachedFileBuffer, cacheFile } from "../../slack/fileCache.js";
import { classifyMimeType } from "../../slack/fileExtractor.js";
import { downloadSlackFile } from "./viewSlackImage.js";
import { logger } from "../../logger.js";
import { formatFileSize, MAX_FILE_SIZE, type SlackFile } from "../../slack/slackFileBase.js";

/**
 * Hand Claude the on-disk path so it can pull the document in with `Read`, which
 * renders PDF pages and preserves layout. Returning the bytes inline is not an
 * option: MCP's tool-result content union has no document block, and emitting
 * one fails the server's `CallToolResult` validation before it reaches Claude.
 */
function documentLocatorResult(file: SlackFile, path: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `File: ${file.name}`,
          `Type: ${file.mimetype}`,
          `Size: ${formatFileSize(file.size)}`,
          `Path: ${path}`,
          "",
          "The file is downloaded but NOT yet in context. Call the Read tool on the path above to view it.",
          'For a long document pass `pages` (e.g. "1-5"); one Read covers at most 20 pages.',
        ].join("\n"),
      },
    ],
  };
}

export function createViewSlackFileTool(ctx: QueryToolContext) {
  const availableFiles = ctx.availableFiles ?? new Map();

  return tool(
    "view_slack_file",
    "View a non-image file uploaded in Slack. Text-based files are returned inline; PDFs are downloaded and returned as a path to open with the Read tool. Use this when the prompt lists attached files or when a fetched message contains non-image file attachments.",
    {
      file_id: z
        .string()
        .describe(
          "The Slack file ID from the ATTACHED FILES section or from a fetched message's files array",
        ),
    },
    async (args, _extra) => {
      const file = availableFiles.get(args.file_id);
      if (!file) {
        const available = [...availableFiles.keys()].join(", ");
        return errorResult(`Unknown file_id "${args.file_id}". Available: ${available}`);
      }

      if (file.unavailable === "too_large") {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `File: ${file.name}`,
                `Type: ${file.mimetype}`,
                `Size: ${formatFileSize(file.size)}`,
                "",
                `This attachment is above the ${formatFileSize(MAX_FILE_SIZE)} limit and was not fetched from Slack.`,
                "Tell the user the file is too large for you to open, and answer the rest of their question without it.",
                "Do not infer its contents.",
              ].join("\n"),
            },
          ],
        };
      }

      const tier = classifyMimeType(file.mimetype);

      // Unsupported binary: return metadata only (no download needed)
      if (tier === "unsupported") {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `File: ${file.name}`,
                `Type: ${file.mimetype}`,
                `Size: ${formatFileSize(file.size)}`,
                "",
                "This format cannot be opened. Tell the user you cannot read this file type and say what would work instead",
                "(for example the text pasted inline, or a PDF export). Do not infer or describe its contents from the filename.",
              ].join("\n"),
            },
          ],
        };
      }

      // Try cache first
      if (tier === "pdf") {
        const cachedPath = await getCachedFilePath(args.file_id);
        if (cachedPath) {
          return documentLocatorResult(file, cachedPath);
        }
      } else {
        const cached = await readCachedFileBuffer(args.file_id);
        if (cached) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(cached.data);
          return {
            content: [{ type: "text" as const, text: `File: ${file.name}\n\n${text}` }],
          };
        }
      }

      // Download from Slack
      try {
        const buffer = await downloadSlackFile(file.url_private, ctx.config.slack.botToken);

        const path = await cacheFile(args.file_id, buffer, {
          mimeType: file.mimetype,
          originalName: file.name,
        });

        if (tier === "pdf") {
          return documentLocatorResult(file, path);
        }

        // Text tier
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
        return {
          content: [{ type: "text" as const, text: `File: ${file.name}\n\n${text}` }],
        };
      } catch (error) {
        logger.error("Failed to download Slack file:", error);
        return errorResult(
          [
            `Failed to download ${file.name} from Slack:`,
            error instanceof Error ? error.message : "unknown error",
            "— this usually does not resolve on retry. If one more attempt fails the same way,",
            "tell the user the attachment could not be fetched and answer the rest without it.",
          ].join(" "),
        );
      }
    },
  );
}
