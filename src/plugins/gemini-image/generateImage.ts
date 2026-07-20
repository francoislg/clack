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
  "The image is STORED in Slack (not posted anywhere) and the call returns `{ fileId, permalink }`. To show it, emit an " +
  "image block with `slack_file: { id: fileId }` in your submit_response. To edit it again, pass `permalink` as `input_image_url`.";

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
      "Optional. A Slack image's url_private/permalink (or any image URL) to EDIT. When set, the call performs image-to-image editing using `prompt` as the instruction.",
    ),
  quality: z
    .enum(["fast", "best"])
    .optional()
    .describe(
      "Image model tier. 'fast' (default): quick, cheap, good for most things. 'best': higher fidelity, better at text-in-image and complex prompts.",
    ),
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
  /** Upload the image to Slack WITHOUT sharing it to any channel, returning its file handle. */
  store(opts: { filename: string; data: string }): Promise<UploadResult>;
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
    async store(opts) {
      const client = getSlackClient();
      if (!client) throw new Error("Slack client became unavailable mid-call");
      // Omitting channel_id uploads the file unshared — owned by the bot, not posted anywhere.
      const result = await client.filesUploadV2({
        file: Buffer.from(opts.data, "base64"),
        filename: opts.filename,
      });
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

// Deliberately NOT the SDK's `errorResult`: this plugin's errors are prose for
// Claude to relay, so the text stays plain instead of a JSON `{ error }` envelope.
function plainErrorResult(message: string) {
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
      return plainErrorResult(
        "GEMINI_API_KEY is not set. An admin needs to add it to data/auth/.env before image generation works.",
      );
    }

    const prompt = args.prompt.trim();
    if (prompt.length === 0) {
      return plainErrorResult("prompt is empty.");
    }

    const editing = args.input_image_url !== undefined && args.input_image_url.trim() !== "";

    if (!deps.slack.isConnected()) {
      return plainErrorResult("Slack is not connected, so the image cannot be stored.");
    }

    let input: FetchedImage | undefined;
    if (editing) {
      try {
        input = await deps.downloadImage(args.input_image_url!.trim(), deps.slack.botToken() ?? "");
      } catch (err) {
        return plainErrorResult(
          `Could not load the input image to edit: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const model = resolveModel(deps.getModelMap(), args.quality ?? "fast", { edit: editing });

    let image: GeminiImageResult;
    try {
      image = await deps.generateImage({ prompt, model, apiKey, input });
    } catch (err) {
      if (err instanceof GeminiError) return plainErrorResult(err.message);
      return plainErrorResult(
        `Image generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let stored: UploadResult;
    try {
      stored = await deps.slack.store({
        filename: neutralFilename(image.mimeType),
        data: image.data,
      });
    } catch (err) {
      return plainErrorResult(
        `Image generated but storing it in Slack failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const meta = {
      ...PROVENANCE,
      edited: editing,
      fileId: stored.fileId,
      permalink: stored.permalink,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(meta) }] };
  });
}
