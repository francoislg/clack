import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validatePromptMediumMap } from "./axes.js";

describe("validatePromptMediumMap", () => {
  it("accepts a valid full map", () => {
    const r = validatePromptMediumMap({ text: 1, image: 2 }, "promptMedium");
    assert.ok(r.ok);
    assert.deepEqual(r.value, { text: 1, image: 2 });
  });

  it("accepts a partial map (missing key normalizes to 0)", () => {
    const r = validatePromptMediumMap({ image: 1 }, "promptMedium");
    assert.ok(r.ok);
    assert.deepEqual(r.value, { text: 0, image: 1 });
  });

  it("rejects an all-zero map", () => {
    const r = validatePromptMediumMap({ text: 0, image: 0 }, "promptMedium");
    assert.ok(!r.ok);
  });

  it("rejects an unknown key", () => {
    const r = validatePromptMediumMap({ text: 1, audio: 1 }, "promptMedium");
    assert.ok(!r.ok);
    assert.match(r.error, /unknown key 'audio'/);
  });

  it("rejects a non-integer / negative weight", () => {
    assert.ok(!validatePromptMediumMap({ text: 1.5 }, "promptMedium").ok);
    assert.ok(!validatePromptMediumMap({ text: -1, image: 1 }, "promptMedium").ok);
  });

  it("rejects a non-object", () => {
    assert.ok(!validatePromptMediumMap(null, "promptMedium").ok);
    assert.ok(!validatePromptMediumMap([1, 2], "promptMedium").ok);
  });
});
