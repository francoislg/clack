import { describe, it, expect, vi } from "vitest";
import {
  createGenerateImageTool,
  type GenerateImageDeps,
  type GenerateImageSlackDeps,
} from "./generateImage.js";
import type { ModelMap } from "./models.js";

const MODEL_MAP: ModelMap = { fast: "M_FAST", best: "M_BEST", edit: "M_EDIT" };

function makeSlack(overrides: Partial<GenerateImageSlackDeps> = {}) {
  const store = vi.fn(async (_opts: Parameters<GenerateImageSlackDeps["store"]>[0]) => ({
    fileId: "F1",
    permalink: "https://slack/p",
  }));
  const slack: GenerateImageSlackDeps = {
    isConnected: () => true,
    botToken: () => "xoxb-1",
    store,
    ...overrides,
  };
  return { slack, store };
}

function makeDeps(overrides: Partial<GenerateImageDeps> = {}) {
  const generateImage = vi.fn(async () => ({ data: "IMG64", mimeType: "image/png" }));
  const downloadImage = vi.fn(async () => ({ data: "SRC64", mimeType: "image/jpeg" }));
  const { slack, store } = makeSlack();
  const deps: GenerateImageDeps = {
    getApiKey: () => "key",
    getModelMap: () => MODEL_MAP,
    generateImage,
    downloadImage,
    slack,
    ...overrides,
  };
  return { deps, generateImage, downloadImage, store };
}

interface TextBlock {
  type: "text";
  text: string;
}
function isTextBlock(block: { type: string }): block is TextBlock {
  return block.type === "text";
}

type ToolArgs = Parameters<ReturnType<typeof createGenerateImageTool>["handler"]>[0];

function argsOf(partial: Partial<ToolArgs> & { prompt: string }): ToolArgs {
  return {
    input_image_url: undefined,
    quality: undefined,
    ...partial,
  };
}

async function run(deps: GenerateImageDeps, partial: Partial<ToolArgs> & { prompt: string }) {
  return createGenerateImageTool(deps).handler(argsOf(partial), {});
}

function meta(result: { content: Array<{ type: string }> }) {
  const block = result.content.find(isTextBlock);
  return JSON.parse(block ? block.text : "{}");
}

function imageBlock(result: { content: Array<{ type: string }> }) {
  return result.content.find((c) => c.type === "image");
}

describe("generate_image tool", () => {
  it("errors when GEMINI_API_KEY is missing, without calling Gemini", async () => {
    const { deps, generateImage } = makeDeps({ getApiKey: () => undefined });
    const result = await run(deps, { prompt: "x" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/GEMINI_API_KEY/);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("rejects an empty prompt without calling Gemini", async () => {
    const { deps, generateImage } = makeDeps();
    const result = await run(deps, { prompt: "   " });
    expect(result.isError).toBe(true);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("stores a neutral-named file (no channel) and returns the file ref, no image block", async () => {
    const { deps, generateImage, store } = makeDeps();
    const result = await run(deps, { prompt: "a cat", quality: "best" });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a cat", model: "M_BEST", input: undefined }),
    );
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toMatchObject({ filename: "image.png", data: "IMG64" });
    expect(store.mock.calls[0][0]).not.toHaveProperty("channel");

    expect(imageBlock(result)).toBeUndefined();
    const m = meta(result);
    expect(m).toMatchObject({
      generated: true,
      provenance: "ai-generated",
      edited: false,
      fileId: "F1",
      permalink: "https://slack/p",
    });
    expect(m).not.toHaveProperty("license");
    expect(m).not.toHaveProperty("attribution");
  });

  it("defaults quality to fast", async () => {
    const { deps, generateImage } = makeDeps();
    await run(deps, { prompt: "p" });
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ model: "M_FAST" }));
  });

  it("edit: fetches the input image with the bot token and uses the edit model", async () => {
    const { deps, generateImage, downloadImage } = makeDeps();
    await run(deps, {
      prompt: "make it blue",
      input_image_url: "https://files.slack.com/x",
      quality: "best",
    });
    expect(downloadImage).toHaveBeenCalledWith("https://files.slack.com/x", "xoxb-1");
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "M_EDIT",
        input: { data: "SRC64", mimeType: "image/jpeg" },
      }),
    );
  });

  it("errors when the input image cannot be loaded, without generating", async () => {
    const { deps, generateImage } = makeDeps({
      downloadImage: vi.fn(async () => {
        throw new Error("403");
      }),
    });
    const result = await run(deps, { prompt: "edit", input_image_url: "https://x" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/input image/i);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("errors cleanly when Slack is disconnected, without generating", async () => {
    const { slack, store } = makeSlack({ isConnected: () => false });
    const { deps, generateImage } = makeDeps({ slack });
    const result = await run(deps, { prompt: "p" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/not connected/);
    expect(generateImage).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it("surfaces a clean error when storing fails", async () => {
    const { slack } = makeSlack({
      store: vi.fn(async () => {
        throw new Error("upload boom");
      }),
    });
    const { deps } = makeDeps({ slack });
    const result = await run(deps, { prompt: "p" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/storing it in Slack/);
  });
});
