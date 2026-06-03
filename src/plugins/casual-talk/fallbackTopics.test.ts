import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BUILTIN_FALLBACK_TOPICS, resolveFallbackTopics } from "./fallbackTopics.js";

describe("resolveFallbackTopics", () => {
  it("returns the built-in list when enabled with no custom topics", () => {
    const topics = resolveFallbackTopics({
      useBuiltinFallbackTopics: true,
      smallTalkTopics: [],
    });
    assert.deepEqual(topics, BUILTIN_FALLBACK_TOPICS);
  });

  it("unions built-ins with custom topics when enabled (built-ins first)", () => {
    const topics = resolveFallbackTopics({
      useBuiltinFallbackTopics: true,
      smallTalkTopics: ["office gossip", "weekend plans"],
    });
    for (const t of BUILTIN_FALLBACK_TOPICS) assert.ok(topics.includes(t));
    assert.ok(topics.includes("office gossip"));
    // "weekend plans" is also a built-in — must appear exactly once (dedup).
    assert.equal(topics.filter((t) => t === "weekend plans").length, 1);
    assert.deepEqual(topics.slice(0, BUILTIN_FALLBACK_TOPICS.length), BUILTIN_FALLBACK_TOPICS);
  });

  it("returns custom topics verbatim when disabled", () => {
    const topics = resolveFallbackTopics({
      useBuiltinFallbackTopics: false,
      smallTalkTopics: ["food"],
    });
    assert.deepEqual(topics, ["food"]);
  });

  it("returns an empty list when disabled with no custom topics", () => {
    const topics = resolveFallbackTopics({
      useBuiltinFallbackTopics: false,
      smallTalkTopics: [],
    });
    assert.deepEqual(topics, []);
  });
});
