import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildProcessRevealInstructions } from "./scheduledPrompts.js";
import { FINALE_TONE_CONTENT } from "./topicInstructions.js";

describe("Perfect Rounds Champion bonus medal in prompts", () => {
  it("includes perfectRoundsChampion field reference in reveal prompt", () => {
    const prompt = buildProcessRevealInstructions();
    assert.match(
      prompt,
      /seasonStatus\.perfectRoundsChampion/,
      "Reveal prompt should reference seasonStatus.perfectRoundsChampion",
    );
  });

  it("includes 🎖️ medal glyph in reveal prompt bonus medal step", () => {
    const prompt = buildProcessRevealInstructions();
    assert.match(prompt, /🎖️/, "Reveal prompt should contain the bonus medal 🎖️ glyph");
  });

  it("instructs rendering nothing when perfectRoundsChampion is absent", () => {
    const prompt = buildProcessRevealInstructions();
    assert.match(
      prompt,
      /BONUS MEDAL.*ABSENT/is,
      "Reveal prompt should instruct rendering nothing when perfectRoundsChampion is absent",
    );
  });

  it("describes bonus medal as separate from points podium in reveal prompt", () => {
    const prompt = buildProcessRevealInstructions();
    assert.match(
      prompt,
      /separate from.*additional to.*podium/i,
      "Reveal prompt should describe the bonus medal as separate from and additional to the points podium",
    );
  });

  it("includes perfect rounds reference in FINALE_TONE_CONTENT", () => {
    assert.match(
      FINALE_TONE_CONTENT,
      /perfect rounds/i,
      "FINALE_TONE_CONTENT should reference perfect rounds",
    );
  });

  it("describes bonus medal as distinct from MVP in FINALE_TONE_CONTENT", () => {
    assert.match(
      FINALE_TONE_CONTENT,
      /consistency award.*distinct from.*MVP/i,
      "FINALE_TONE_CONTENT should describe the bonus medal as a consistency award distinct from the MVP",
    );
  });

  it("mentions gating to seasonStatus.perfectRoundsChampion presence in FINALE_TONE_CONTENT", () => {
    assert.match(
      FINALE_TONE_CONTENT,
      /seasonStatus\.perfectRoundsChampion.*present/i,
      "FINALE_TONE_CONTENT should mention the perfect rounds champion is only rendered when present",
    );
  });
});
