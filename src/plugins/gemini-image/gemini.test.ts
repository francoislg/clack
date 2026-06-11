import { describe, it, expect, vi } from "vitest";
import { generateImage, GeminiError, type GenAiLike } from "./gemini.js";

type GenAiResponse = Awaited<ReturnType<GenAiLike["models"]["generateContent"]>>;

function fakeClient(response: GenAiResponse): GenAiLike {
  return {
    models: {
      generateContent: vi.fn(async () => response),
    },
  };
}

const IMAGE_PART = { inlineData: { data: "BASE64", mimeType: "image/png" } };

describe("generateImage (gemini boundary)", () => {
  it("generates from a text prompt (string contents) and returns bytes", async () => {
    const client = fakeClient({ candidates: [{ content: { parts: [IMAGE_PART] } }] });
    const generateContent = client.models.generateContent as ReturnType<typeof vi.fn>;

    const result = await generateImage({
      prompt: "a red cube",
      model: "model-fast",
      apiKey: "k",
      clientFactory: () => client,
    });

    expect(result).toEqual({ data: "BASE64", mimeType: "image/png" });
    expect(generateContent).toHaveBeenCalledWith({ model: "model-fast", contents: "a red cube" });
  });

  it("edits by sending the input image then the instruction (array contents)", async () => {
    const client = fakeClient({ candidates: [{ content: { parts: [IMAGE_PART] } }] });
    const generateContent = client.models.generateContent as ReturnType<typeof vi.fn>;

    await generateImage({
      prompt: "make it blue",
      model: "model-edit",
      apiKey: "k",
      input: { data: "SRC", mimeType: "image/jpeg" },
      clientFactory: () => client,
    });

    expect(generateContent).toHaveBeenCalledWith({
      model: "model-edit",
      contents: [{ inlineData: { data: "SRC", mimeType: "image/jpeg" } }, { text: "make it blue" }],
    });
  });

  it("defaults mimeType to image/png when the part omits it", async () => {
    const client = fakeClient({
      candidates: [{ content: { parts: [{ inlineData: { data: "X" } }] } }],
    });
    const result = await generateImage({
      prompt: "p",
      model: "m",
      apiKey: "k",
      clientFactory: () => client,
    });
    expect(result.mimeType).toBe("image/png");
  });

  it("throws GeminiError when the response carries no image part", async () => {
    const client = fakeClient({ candidates: [{ content: { parts: [{ text: "refused" }] } }] });
    await expect(
      generateImage({ prompt: "p", model: "m", apiKey: "k", clientFactory: () => client }),
    ).rejects.toBeInstanceOf(GeminiError);
  });

  it("wraps a thrown SDK error as GeminiError", async () => {
    const client: GenAiLike = {
      models: {
        generateContent: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
    };
    await expect(
      generateImage({ prompt: "p", model: "m", apiKey: "k", clientFactory: () => client }),
    ).rejects.toThrow(/network down/);
  });
});
