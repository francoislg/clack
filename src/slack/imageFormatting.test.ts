import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImageOnlyPreAnalysisText } from "./imageFormatting.js";
import type { SlackFileBase } from "./slackFileBase.js";

const img = (id: string, name: string): SlackFileBase => ({
  id,
  name,
  mimetype: "image/png",
  size: 1024,
  url_private: `https://files.slack.com/${id}`,
});

describe("buildImageOnlyPreAnalysisText", () => {
  it("returns an empty string for undefined input", () => {
    assert.equal(buildImageOnlyPreAnalysisText(undefined), "");
  });

  it("returns an empty string for an empty array", () => {
    assert.equal(buildImageOnlyPreAnalysisText([]), "");
  });

  it("formats a single image with filename and file_id", () => {
    const result = buildImageOnlyPreAnalysisText([img("F001", "screenshot.png")]);
    assert.equal(result, "[attached images: screenshot.png (file_id: F001)]");
  });

  it("formats multiple images comma-separated on one line", () => {
    const result = buildImageOnlyPreAnalysisText([
      img("F001", "one.png"),
      img("F002", "two.jpg"),
      img("F003", "three.webp"),
    ]);
    assert.equal(
      result,
      "[attached images: one.png (file_id: F001), two.jpg (file_id: F002), three.webp (file_id: F003)]",
    );
  });

  it("matches the prompt builder's thread-context format exactly", () => {
    // Promptbuilder:56 emits `[attached images: ${name} (file_id: ${id}), ...]`
    const result = buildImageOnlyPreAnalysisText([img("F999", "diagram.webp")]);
    assert.ok(result.startsWith("[attached images: "));
    assert.ok(result.endsWith("]"));
    assert.ok(result.includes("diagram.webp (file_id: F999)"));
  });
});
