import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { getCachedFilePath, readCachedFileBuffer, cacheFile } from "../../slack/fileCache.js";
import { classifyMimeType } from "../../slack/fileExtractor.js";
import { downloadSlackFile } from "./viewSlackImage.js";
import { logger } from "../../logger.js";
import type { SlackFile } from "../../slack/slackFileBase.js";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

      const tier = classifyMimeType(file.mimetype);

      // Unsupported binary: return metadata only (no download needed)
      if (tier === "unsupported") {
        return {
          content: [
            {
              type: "text" as const,
              text: `File: ${file.name}\nType: ${file.mimetype}\nSize: ${formatFileSize(file.size)}\n\nThis file format cannot be read directly. You can describe the file to the user based on its name and type.`,
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
          `Failed to download file from Slack: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    },
  );
}
