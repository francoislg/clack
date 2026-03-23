import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { errorResult } from "../helpers.js";
import { readCachedImageBase64, cacheImage } from "../../slack/imageCache.js";
import { logger } from "../../logger.js";

const MAX_REDIRECTS = 5;

/**
 * Download a file from Slack, manually following redirects to preserve
 * the Authorization header (fetch strips it on cross-origin redirects).
 */
export async function downloadSlackFile(url: string, botToken: string): Promise<Buffer> {
  let currentUrl = url;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without Location header`);
      currentUrl = location;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    // Validate we got an image, not an HTML login page
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("text/html")) {
      throw new Error("Received HTML instead of image — bot token may lack files:read scope");
    }

    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("Too many redirects downloading Slack image");
}

export function createViewSlackImageTool(ctx: QueryToolContext) {
  // availableImages is mutable — fetch tools add discovered images mid-query
  const availableImages = ctx.availableImages ?? new Map();

  return tool(
    "view_slack_image",
    "View an image uploaded in Slack. Returns the image content for visual analysis. Use this when the prompt mentions attached images or when a fetched message contains images.",
    {
      file_id: z.string().describe("The Slack file ID from the ATTACHED IMAGES section or from a fetched message's images array"),
    },
    async (args) => {
      const imageFile = availableImages.get(args.file_id);
      if (!imageFile) {
        const available = [...availableImages.keys()].join(", ");
        return errorResult(
          `Unknown file_id "${args.file_id}". Available: ${available}`,
        );
      }

      // Check cache first
      const cached = await readCachedImageBase64(args.file_id);
      if (cached) {
        return {
          content: [
            { type: "image" as const, data: cached.data, mimeType: cached.mimeType },
          ],
        };
      }

      // Download from Slack
      try {
        const buffer = await downloadSlackFile(imageFile.url_private, ctx.config.slack.botToken);

        // Cache for future use
        await cacheImage(args.file_id, buffer, {
          mimeType: imageFile.mimetype,
          originalName: imageFile.name,
        });

        const base64 = buffer.toString("base64");

        return {
          content: [
            { type: "image" as const, data: base64, mimeType: imageFile.mimetype },
          ],
        };
      } catch (error) {
        logger.error("Failed to download Slack image:", error);
        return errorResult(`Failed to download image from Slack: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
  );
}
