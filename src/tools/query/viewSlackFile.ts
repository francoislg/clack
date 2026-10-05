import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import {
  getCachedFilePath,
  readCachedFileBase64,
  readCachedFileBuffer,
  cacheFile,
} from "../../slack/fileCache.js";
import { classifyMimeType } from "../../slack/fileExtractor.js";
import { isSlackHost } from "../../slack/fileRef.js";
import { logger } from "../../logger.js";
import { formatFileSize, MAX_FILE_SIZE } from "../../slack/slackFileBase.js";
import type { SlackFileRef, SlackRef } from "../../slack/slackRefs.js";
import { resolveRefForReader, wrongKindMessage } from "../resolveRefForReader.js";

const MAX_REDIRECTS = 5;

/** The facts of a registered file that opening it needs. */
interface ViewableFile {
  name: string;
  mimetype: string;
  size: number | undefined;
  urlPrivate: string | undefined;
  tooLarge: boolean;
}

function viewableFile(ref: SlackFileRef): ViewableFile {
  const facts = ref.facts ?? {};
  return {
    name: ref.name ?? ref.id,
    mimetype: facts.mimetype ?? "application/octet-stream",
    size: facts.size,
    urlPrivate: facts.urlPrivate,
    tooLarge: ref.tooLarge === true,
  };
}

function sizeLine(size: number | undefined): string {
  return `Size: ${size === undefined ? "unknown" : formatFileSize(size)}`;
}

/** Hosts that may receive the bot token: Slack itself and its file CDNs. */
function isSlackFileHost(hostname: string): boolean {
  return (
    isSlackHost(hostname) ||
    hostname.endsWith(".slack-edge.com") ||
    hostname.endsWith(".slack-files.com")
  );
}

/**
 * Download a file from Slack, manually following redirects so the Authorization header
 * reaches Slack's file hosts (fetch strips it on cross-origin redirects). A hop to any
 * other host is followed without the token.
 */
export async function downloadSlackFile(url: string, botToken: string): Promise<Buffer> {
  let currentUrl = new URL(url);

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl.href, {
      headers: isSlackFileHost(currentUrl.hostname) ? { Authorization: `Bearer ${botToken}` } : {},
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without Location header`);
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    // Validate we got the file, not an HTML login page
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("text/html")) {
      throw new Error("Received HTML instead of the file — bot token may lack files:read scope");
    }

    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("Too many redirects downloading Slack file");
}

/**
 * Hand Claude the on-disk path so it can pull the document in with `Read`, which
 * renders PDF pages and preserves layout. Returning the bytes inline is not an
 * option: MCP's tool-result content union has no document block, and emitting
 * one fails the server's `CallToolResult` validation before it reaches Claude.
 */
function documentLocatorResult(file: ViewableFile, path: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `File: ${file.name}`,
          `Type: ${file.mimetype}`,
          sizeLine(file.size),
          `Path: ${path}`,
          "",
          "The file is downloaded but NOT yet in context. Call the Read tool on the path above to view it.",
          'For a long document pass `pages` (e.g. "1-5"); one Read covers at most 20 pages.',
        ].join("\n"),
      },
    ],
  };
}

function imageResult(data: string, mimeType: string) {
  return { content: [{ type: "image" as const, data, mimeType }] };
}

export function createViewSlackFileTool(ctx: QueryToolContext) {
  // Mutable — queued messages and the fetch tools register refs mid-run.
  const availableRefs = ctx.availableRefs ?? new Map<string, SlackRef>();

  return tool(
    "view_slack_file",
    "View a file uploaded in Slack. Images are returned for visual analysis; text-based files are returned inline; PDFs are downloaded and returned as a path to open with the Read tool. Use this when the prompt lists referenced files or images, or when a fetched message contains file attachments.",
    {
      file_id: z
        .string()
        .describe(
          "The Slack file ID from the REFERENCED SLACK ITEMS section or from a fetched message's files array",
        ),
    },
    async (args, _extra) => {
      const resolved = await resolveRefForReader(
        { ...ctx, availableRefs },
        args.file_id,
        ["image", "document", "file"],
        { alwaysCheckAccess: false },
      );
      if (!resolved.ok) return resolved.error;
      if (resolved.ref.type !== "file") return errorResult(wrongKindMessage(resolved.ref));
      const fileId = resolved.ref.id;
      const file = viewableFile(resolved.ref);

      if (file.tooLarge) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `File: ${file.name}`,
                `Type: ${file.mimetype}`,
                sizeLine(file.size),
                "",
                `This attachment is above the ${formatFileSize(MAX_FILE_SIZE)} limit and was not fetched from Slack.`,
                "Tell the user the file is too large for you to open, and answer the rest of their question without it.",
                "Do not infer its contents.",
              ].join("\n"),
            },
          ],
        };
      }

      const tier = resolved.ref.kind === "image" ? "image" : classifyMimeType(file.mimetype);

      // Unsupported binary: return metadata only (no download needed)
      if (tier === "unsupported") {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `File: ${file.name}`,
                `Type: ${file.mimetype}`,
                sizeLine(file.size),
                "",
                "This format cannot be opened. Tell the user you cannot read this file type and say what would work instead",
                "(for example the text pasted inline, or a PDF export). Do not infer or describe its contents from the filename.",
              ].join("\n"),
            },
          ],
        };
      }

      // Try cache first
      if (tier === "image") {
        const cached = await readCachedFileBase64(fileId);
        if (cached) {
          return imageResult(cached.data, cached.mimeType);
        }
      } else if (tier === "pdf") {
        const cachedPath = await getCachedFilePath(fileId);
        if (cachedPath) {
          return documentLocatorResult(file, cachedPath);
        }
      } else {
        const cached = await readCachedFileBuffer(fileId);
        if (cached) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(cached.data);
          return {
            content: [{ type: "text" as const, text: `File: ${file.name}\n\n${text}` }],
          };
        }
      }

      if (file.urlPrivate === undefined) {
        return errorResult(
          `Slack returned no download URL for ${file.name}. Tell the user the file could not be fetched and answer the rest without it.`,
        );
      }

      // Download from Slack
      try {
        const buffer = await downloadSlackFile(file.urlPrivate, ctx.config.slack.botToken);

        const path = await cacheFile(fileId, buffer, {
          mimeType: file.mimetype,
          originalName: file.name,
        });

        if (tier === "image") {
          return imageResult(buffer.toString("base64"), file.mimetype);
        }

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
