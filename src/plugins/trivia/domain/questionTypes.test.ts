import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { TriviaConfig } from "../core/configTypes.js";
import { getActiveChoiceBounds } from "./questionTypes.js";

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

describe("getActiveChoiceBounds", () => {
  it("defaults to { min: 4, max: 4 } when not configured", () => {
    assert.deepEqual(getActiveChoiceBounds(makeConfig()), { min: 4, max: 4 });
  });

  it("returns workspace bounds when configured", () => {
    const cfg = makeConfig({ choices: { min: 3, max: 4 } });
    assert.deepEqual(getActiveChoiceBounds(cfg), { min: 3, max: 4 });
  });

  it("ignores season state — bounds are workspace-only", () => {
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      choices: { min: 2, max: 3 },
    });
    assert.deepEqual(getActiveChoiceBounds(cfg), { min: 2, max: 3 });
  });
});
