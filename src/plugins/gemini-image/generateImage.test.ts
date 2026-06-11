import { describe, it, expect, vi } from "vitest";
import {
  createGenerateImageTool,
  type GenerateImageDeps,
  type GenerateImageSlackDeps,
} from "./generateImage.js";
import type { ModelMap } from "./models.js";

const MODEL_MAP: ModelMap = { fast: "M_FAST", best: "M_BEST", edit: "M_EDIT" };

function makeSlack(overrides: Partial<GenerateImageSlackDeps> = {}) {
  const upload = vi.fn(async (_opts: Parameters<GenerateImageSlackDeps["upload"]>[0]) => ({
    fileId: "F1",
    permalink: "https://slack/p",
  }));
  const slack: GenerateImageSlackDeps = {
    isConnected: () => true,
    botToken: () => "xoxb-1",
    upload,
    ...overrides,
  };
  return { slack, upload };
}

function makeDeps(overrides: Partial<GenerateImageDeps> = {}) {
  const generateImage = vi.fn(async () => ({ data: "IMG64", mimeType: "image/png" }));
  const downloadImage = vi.fn(async () => ({ data: "SRC64", mimeType: "image/jpeg" }));
  const { slack, upload } = makeSlack();
  const deps: GenerateImageDeps = {
    getApiKey: () => "key",
    getModelMap: () => MODEL_MAP,
    generateImage,
    downloadImage,
    slack,
    ...overrides,
  };
  return { deps, generateImage, downloadImage, upload };
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
    deliver: undefined,
    channel: undefined,
    thread_ts: undefined,
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
    const result = await run(deps, { prompt: "x", deliver: "data" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/GEMINI_API_KEY/);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("rejects an empty prompt without calling Gemini", async () => {
    const { deps, generateImage } = makeDeps();
    const result = await run(deps, { prompt: "   ", deliver: "data" });
    expect(result.isError).toBe(true);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("generate + data: returns an image block and provenance, no license/attribution/subjectId", async () => {
    const { deps, generateImage } = makeDeps();
    const result = await run(deps, { prompt: "a cat", quality: "best", deliver: "data" });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a cat", model: "M_BEST", input: undefined }),
    );
    expect(imageBlock(result)).toEqual({ type: "image", data: "IMG64", mimeType: "image/png" });
    const m = meta(result);
    expect(m).toMatchObject({ generated: true, provenance: "ai-generated", edited: false });
    expect(m).not.toHaveProperty("license");
    expect(m).not.toHaveProperty("attribution");
    expect(m).not.toHaveProperty("subjectId");
  });

  it("defaults quality to fast", async () => {
    const { deps, generateImage } = makeDeps();
    await run(deps, { prompt: "p", deliver: "data" });
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ model: "M_FAST" }));
  });

  it("upload without a channel errors and does not post", async () => {
    const { deps, upload } = makeDeps();
    const result = await run(deps, { prompt: "p" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/channel/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("upload with a channel posts a neutral-named file and returns the file ref, no image block", async () => {
    const { deps, upload } = makeDeps();
    const result = await run(deps, { prompt: "p", channel: "C123" });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatchObject({
      channel: "C123",
      filename: "image.png",
      data: "IMG64",
    });
    expect(imageBlock(result)).toBeUndefined();
    expect(meta(result)).toMatchObject({ fileId: "F1", permalink: "https://slack/p" });
  });

  it("both: posts AND returns an image block", async () => {
    const { deps, upload } = makeDeps();
    const result = await run(deps, { prompt: "p", channel: "C1", deliver: "both" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(imageBlock(result)).toBeDefined();
    expect(meta(result)).toMatchObject({ fileId: "F1" });
  });

  it("passes thread_ts through to the upload when given", async () => {
    const { deps, upload } = makeDeps();
    await run(deps, { prompt: "p", channel: "C1", thread_ts: "111.222" });
    expect(upload.mock.calls[0][0]).toMatchObject({ threadTs: "111.222" });
  });

  it("edit: fetches the input image with the bot token and uses the edit model", async () => {
    const { deps, generateImage, downloadImage } = makeDeps();
    await run(deps, {
      prompt: "make it blue",
      input_image_url: "https://files.slack.com/x",
      quality: "best",
      deliver: "data",
    });
    expect(downloadImage).toHaveBeenCalledWith("https://files.slack.com/x", "xoxb-1");
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "M_EDIT",
        input: { data: "SRC64", mimeType: "image/jpeg" },
      }),
    );
  });

  it("errors when the input image cannot be loaded", async () => {
    const { deps, generateImage } = makeDeps({
      downloadImage: vi.fn(async () => {
        throw new Error("403");
      }),
    });
    const result = await run(deps, {
      prompt: "edit",
      input_image_url: "https://x",
      deliver: "data",
    });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(/input image/i);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("upload errors cleanly when Slack is disconnected", async () => {
    const { slack } = makeSlack({ isConnected: () => false });
    const { deps } = makeDeps({ slack });
    const result = await run(deps, { prompt: "p", channel: "C1" });
    expect(result.isError).toBe(true);
    expect(isTextBlock(result.content[0]) && result.content[0].text).toMatch(
      /not connected|deliver:'data'/,
    );
  });
});
