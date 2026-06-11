import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import {
  generateImage as defaultGenerateImage,
  loadGeminiApiKey,
  GeminiError,
  type GenerateImageParams,
  type GeminiImageResult,
} from "./gemini.js";
import { getModelMap, resolveModel, type ModelMap } from "./models.js";
import { downloadImageAsBase64, type FetchedImage } from "./slackImage.js";

const MAX_PROMPT_LENGTH = 2000;

const DESCRIPTION =
  "Generate a brand-new, AI-GENERATED image from a text prompt, or edit an uploaded image (supply input_image_url). " +
  "The output is SYNTHETIC — invented by an image model. It is NOT a photograph, NOT a real-world document or screenshot, " +
  "and NOT a depiction of any real person, place, logo, or event. Do not use it as factual or source imagery, and never " +
  "present it as real. Returns no license/attribution metadata because the image has no real-world source. " +
  "Delivery is controlled by `deliver`: `upload` (default) posts the image to a Slack `channel` you supply, `data` returns " +
  "the image inline for you to inspect, `both` does both.";

const PROVENANCE = { generated: true as const, provenance: "ai-generated" as const };

const Args = {
  prompt: z
    .string()
    .min(1)
    .max(MAX_PROMPT_LENGTH)
    .describe(
      "What to generate, or — when input_image_url is set — the edit instruction to apply to that image.",
    ),
  input_image_url: z
    .string()
    .optional()
    .describe(
      "Optional. A Slack image's url_private (or any image URL) to EDIT. When set, the call performs image-to-image editing using `prompt` as the instruction.",
    ),
  quality: z
    .enum(["fast", "best"])
    .optional()
    .describe(
      "Image model tier. 'fast' (default): quick, cheap, good for most things. 'best': higher fidelity, better at text-in-image and complex prompts.",
    ),
  deliver: z
    .enum(["upload", "data", "both"])
    .optional()
    .describe(
      "Where the image lands. 'upload' (default): post it to Slack (requires `channel`). 'data': return the bytes inline for you to inspect only. 'both': post AND return inline.",
    ),
  channel: z
    .string()
    .optional()
    .describe(
      "Slack channel ID to post to (required for 'upload'/'both'). Use the Channel ID from your context. Not available in DMs/channelless runs — there, use deliver:'data'.",
    ),
  thread_ts: z
    .string()
    .optional()
    .describe("Optional thread timestamp to post the upload under, instead of top-level."),
};

export interface UploadResult {
  fileId: string | null;
  permalink: string | null;
}

/**
 * The Slack operations the tool needs, abstracted so tests inject a fake instead
 * of a full WebClient (mirrors trivia's `PostQuestionsSlackDeps`).
 */
export interface GenerateImageSlackDeps {
  isConnected(): boolean;
  botToken(): string | null;
  upload(opts: {
    channel: string;
    threadTs?: string;
    filename: string;
    data: string;
    mimeType: string;
  }): Promise<UploadResult>;
}

export interface GenerateImageDeps {
  getApiKey: () => string | undefined;
  getModelMap: () => ModelMap;
  generateImage: (params: GenerateImageParams) => Promise<GeminiImageResult>;
  downloadImage: (url: string, botToken: string) => Promise<FetchedImage>;
  slack: GenerateImageSlackDeps;
}

export function defaultGenerateImageSlackDeps(
  getSlackClient: () => App["client"] | null,
): GenerateImageSlackDeps {
  return {
    isConnected() {
      return getSlackClient() !== null;
    },
    botToken() {
      return getSlackClient()?.token ?? null;
    },
    async upload(opts) {
      const client = getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-call");
      const uploadArgs = {
        channel_id: opts.channel,
        file: Buffer.from(opts.data, "base64"),
        filename: opts.filename,
      };
      const result = await client.filesUploadV2(
        opts.threadTs ? { ...uploadArgs, thread_ts: opts.threadTs } : uploadArgs,
      );
      const file = result.files?.[0]?.files?.[0];
      return { fileId: file?.id ?? null, permalink: file?.permalink ?? null };
    },
  };
}

export function defaultGenerateImageDeps(
  getSlackClient: () => App["client"] | null,
): GenerateImageDeps {
  return {
    getApiKey: loadGeminiApiKey,
    getModelMap,
    generateImage: defaultGenerateImage,
    downloadImage: downloadImageAsBase64,
    slack: defaultGenerateImageSlackDeps(getSlackClient),
  };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

function neutralFilename(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "image.jpg";
  if (mimeType.includes("webp")) return "image.webp";
  if (mimeType.includes("gif")) return "image.gif";
  return "image.png";
}

export function createGenerateImageTool(deps: GenerateImageDeps) {
  return tool("generate_image", DESCRIPTION, Args, async (args) => {
    const apiKey = deps.getApiKey();
    if (!apiKey) {
      return errorResult(
        "GEMINI_API_KEY is not set. An admin needs to add it to data/auth/.env before image generation works.",
      );
    }

    const prompt = args.prompt.trim();
    if (prompt.length === 0) {
      return errorResult("prompt is empty.");
    }

    const editing = args.input_image_url !== undefined && args.input_image_url.trim() !== "";
    const deliver = args.deliver ?? "upload";
    const needsUpload = deliver === "upload" || deliver === "both";

    if (needsUpload && (args.channel === undefined || args.channel.trim() === "")) {
      return errorResult(
        "deliver 'upload'/'both' requires a `channel` to post to. Supply the Channel ID from your context, or use deliver:'data' (e.g. in a DM or channelless run where no channel is available).",
      );
    }

    let input: FetchedImage | undefined;
    if (editing) {
      try {
        input = await deps.downloadImage(args.input_image_url!.trim(), deps.slack.botToken() ?? "");
      } catch (err) {
        return errorResult(
          `Could not load the input image to edit: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const model = resolveModel(deps.getModelMap(), args.quality ?? "fast", { edit: editing });

    let image: GeminiImageResult;
    try {
      image = await deps.generateImage({ prompt, model, apiKey, input });
    } catch (err) {
      if (err instanceof GeminiError) return errorResult(err.message);
      return errorResult(
        `Image generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let upload: UploadResult | undefined;
    if (needsUpload) {
      if (!deps.slack.isConnected()) {
        return errorResult(
          "Slack is not connected, so the image cannot be uploaded. Retry with deliver:'data'.",
        );
      }
      try {
        upload = await deps.slack.upload({
          channel: args.channel!,
          ...(args.thread_ts ? { threadTs: args.thread_ts } : {}),
          filename: neutralFilename(image.mimeType),
          data: image.data,
          mimeType: image.mimeType,
        });
      } catch (err) {
        return errorResult(
          `Image generated but the Slack upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const meta = {
      ...PROVENANCE,
      edited: editing,
      deliver,
      ...(upload ? { fileId: upload.fileId, permalink: upload.permalink } : {}),
    };

    const content: Array<
      { type: "image"; data: string; mimeType: string } | { type: "text"; text: string }
    > = [];
    if (deliver === "data" || deliver === "both") {
      content.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    content.push({ type: "text", text: JSON.stringify(meta) });
    return { content };
  });
}
