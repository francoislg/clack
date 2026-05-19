import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  getProcessResponsesInstructions,
} from "./scheduledPrompts.js";

describe("SEND_QUESTIONS_INSTRUCTIONS (boolean path)", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof SEND_QUESTIONS_INSTRUCTIONS, "string");
    assert.ok(SEND_QUESTIONS_INSTRUCTIONS.length > 100);
  });

  it("references the required trivia tools by bare name", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /get_ideas/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /find_previous_questions/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /save_question/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /submit_response/);
  });

  it("enforces the difficulty gate and reaction ordering", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /3\/10/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /4\/10/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"\+1", "-1"/);
  });

  it("instructs Claude to honor the server-chosen suggestedAnswer", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedAnswer/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Branch on suggestedAnswer/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do NOT randomize the polarity yourself/i);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /randomly decide/i);
  });

  it("frames false statements directly instead of researching truth-then-flipping", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CORRECT POLARITY FROM THE START/);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /do NOT write a true statement and try to flip it later/i,
    );
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /plausible-sounding FALSE statement/);
  });

  it("includes an explicit polarity self-check gate", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /POLARITY SELF-CHECK/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do these match\?/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /rewrite/i);
  });

  it("instructs Claude to target suggestedDifficulty with the bucket-to-1-10 mapping", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedDifficulty/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Easy/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Medium/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Hard/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Easy.*4-6/s);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Medium.*7-8/s);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Hard.*9-10/s);
  });

  it("invites invented styles rather than prescribing a rotation", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /invent a style/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Example/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /rotate between them/);
  });
});

describe("getProcessResponsesInstructions(seasonsEnabled)", () => {
  it("returns a non-empty prompt", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 100);
  });

  it("references the required tools by name", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /fetch_channel_messages/);
    assert.match(prompt, /find_previous_questions/);
    assert.match(prompt, /get_question_history/);
    assert.match(prompt, /submit_answers/);
    assert.match(prompt, /submit_response/);
  });

  it("does NOT reference cheat DETECTION — that is handled by trivia-check only", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.doesNotMatch(prompt, /save_cheating/);
    assert.doesNotMatch(prompt, /<@ASKER_ID>/);
  });

  it("instructs silent cheater exclusion using cheaterUserIds from get_question_history", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /cheaterUserIds/);
    assert.match(prompt, /silent/i);
    assert.match(prompt, /never name a caught cheater/i);
    assert.match(prompt, /MUST NOT appear anywhere in the reveal/);
  });

  it("instructs cheater exclusion from the submit_answers payload as well", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /cheaters are already absent/i);
  });

  it("describes the questionId resolution fallback", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /refine the keyword/i);
    assert.match(prompt, /most[- ]?recent/i);
    assert.match(prompt, /empty array/i);
  });

  it("enforces bot exclusion without hardcoding a specific bot user ID", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /bot's own user ID/i);
    assert.doesNotMatch(prompt, /U0A8WSEBF7B/);
  });

  it("requires submit_answers before submit_response", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /BEFORE submit_response/);
  });

  it("names the four voter situations Clack should cover", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /CORRECT voters/);
    assert.match(prompt, /INCORRECT voters/);
    assert.match(prompt, /FENCE-SITTERS/);
    assert.match(prompt, /WILDCARDS/);
  });

  it("instructs to skip any voter situation with no qualifying users", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(prompt, /Skip anything with no qualifying users entirely/i);
    assert.match(prompt, /cover whichever ones actually apply/i);
  });

  it("does not prescribe a rigid four-sub-group layout", () => {
    const prompt = getProcessResponsesInstructions(false);
    assert.match(
      prompt,
      /NOT required to use four sections, four headings, or any fixed structure/i,
    );
  });
});
