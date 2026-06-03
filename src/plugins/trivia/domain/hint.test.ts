import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { difficultyMeetsThreshold, effectiveHintMode } from "./hint.js";

describe("difficultyMeetsThreshold", () => {
  it("easy threshold passes for every bucket", () => {
    assert.equal(difficultyMeetsThreshold("easy", "easy"), true);
    assert.equal(difficultyMeetsThreshold("medium", "easy"), true);
    assert.equal(difficultyMeetsThreshold("hard", "easy"), true);
  });

  it("medium threshold suppresses easy", () => {
    assert.equal(difficultyMeetsThreshold("easy", "medium"), false);
    assert.equal(difficultyMeetsThreshold("medium", "medium"), true);
    assert.equal(difficultyMeetsThreshold("hard", "medium"), true);
  });

  it("hard threshold suppresses easy and medium", () => {
    assert.equal(difficultyMeetsThreshold("easy", "hard"), false);
    assert.equal(difficultyMeetsThreshold("medium", "hard"), false);
    assert.equal(difficultyMeetsThreshold("hard", "hard"), true);
  });
});

describe("effectiveHintMode", () => {
  it("mode none stays none regardless of difficulty", () => {
    assert.equal(effectiveHintMode({ mode: "none" }, "hard"), "none");
  });

  it("returns the configured mode when no minDifficulty is set", () => {
    assert.equal(effectiveHintMode({ mode: "button" }, "easy"), "button");
    assert.equal(effectiveHintMode({ mode: "inline" }, "hard"), "inline");
  });

  it("forces none when the rolled difficulty is below minDifficulty", () => {
    assert.equal(effectiveHintMode({ mode: "button", minDifficulty: "hard" }, "easy"), "none");
    assert.equal(effectiveHintMode({ mode: "inline", minDifficulty: "medium" }, "easy"), "none");
  });

  it("keeps the mode when the rolled difficulty meets minDifficulty", () => {
    assert.equal(
      effectiveHintMode({ mode: "button", minDifficulty: "medium" }, "medium"),
      "button",
    );
    assert.equal(effectiveHintMode({ mode: "inline", minDifficulty: "easy" }, "hard"), "inline");
  });
});
