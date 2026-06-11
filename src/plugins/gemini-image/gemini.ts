import { GoogleGenAI } from "@google/genai";

/** A generated image as raw bytes. Gemini returns no URL — only inline base64. */
export interface GeminiImageResult {
  data: string;
  mimeType: string;
}

/** Optional source image for the edit (image-to-image) path. */
export interface GeminiInputImage {
  data: string;
  mimeType: string;
}

/** Structured failure from the Gemini boundary — never thrown across the tool layer as a raw Error. */
export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export function loadGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

/**
 * Minimal slice of the `@google/genai` client we depend on. Tests pass a fake;
 * production injects `(apiKey) => new GoogleGenAI({ apiKey })`.
 */
export interface GenAiLike {
  models: {
    generateContent(req: { model: string; contents: GenAiContents }): Promise<GenAiResponse>;
  };
}

type GenAiPart = { text?: string; inlineData?: { data?: string; mimeType?: string } };
type GenAiContents = string | GenAiPart[];
interface GenAiResponse {
  candidates?: Array<{ content?: { parts?: GenAiPart[] } }>;
}

export interface GenerateImageParams {
  prompt: string;
  model: string;
  apiKey: string;
  /** When present, the call edits this image instead of generating from scratch. */
  input?: GeminiInputImage;
  /** Injected for tests — defaults to `(apiKey) => new GoogleGenAI({ apiKey })`. */
  clientFactory?: (apiKey: string) => GenAiLike;
}

function firstInlineImage(response: GenAiResponse): GeminiImageResult | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType ?? "image/png",
      };
    }
  }
  return null;
}

/**
 * Generate or edit an image. With `input`, the prompt is treated as an edit
 * instruction applied to the supplied image; otherwise it is a from-scratch
 * generation prompt. Returns the first inline image in the response.
 */
export async function generateImage(params: GenerateImageParams): Promise<GeminiImageResult> {
  const factory = params.clientFactory ?? ((key: string) => new GoogleGenAI({ apiKey: key }));
  const ai = factory(params.apiKey);

  const contents: GenAiContents = params.input
    ? [
        { inlineData: { data: params.input.data, mimeType: params.input.mimeType } },
        { text: params.prompt },
      ]
    : params.prompt;

  let response: GenAiResponse;
  try {
    response = await ai.models.generateContent({ model: params.model, contents });
  } catch (err) {
    throw new GeminiError(
      `Gemini image request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const image = firstInlineImage(response);
  if (!image) {
    throw new GeminiError(
      "Gemini returned no image. The prompt may have been refused by safety filters — try rephrasing.",
    );
  }
  return image;
}
