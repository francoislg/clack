import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  PREP_QUESTIONS_INSTRUCTIONS,
  POST_QUESTIONS_INSTRUCTIONS,
  LOCK_QUESTIONS_INSTRUCTIONS,
  buildProcessRevealInstructions,
} from "./scheduledPrompts.js";
import {
  getTriviaCheckInstruction,
  TRIVIA_CHECK_INSTRUCTION,
  TRIVIA_MANAGEMENT_INSTRUCTION,
  TRIVIA_GAMES_ADMIN_INSTRUCTION,
  PENDING_QUESTION_CREATION_CONTEXT,
} from "./triviaCheckInstruction.js";

const REVEAL = buildProcessRevealInstructions();

// Every shipped scheduled prompt + admin runbook string. If a new prompt module is
// added, list it here so the stale-name guard keeps covering the full surface.
const ALL_PROMPTS: Array<[string, string]> = [
  ["SEND_QUESTIONS_INSTRUCTIONS", SEND_QUESTIONS_INSTRUCTIONS],
  ["PREP_QUESTIONS_INSTRUCTIONS", PREP_QUESTIONS_INSTRUCTIONS],
  ["POST_QUESTIONS_INSTRUCTIONS", POST_QUESTIONS_INSTRUCTIONS],
  ["LOCK_QUESTIONS_INSTRUCTIONS", LOCK_QUESTIONS_INSTRUCTIONS],
  ["buildProcessRevealInstructions()", REVEAL],
  ["TRIVIA_CHECK_INSTRUCTION", TRIVIA_CHECK_INSTRUCTION],
  ["getTriviaCheckInstruction(true)", getTriviaCheckInstruction(true)],
  ["getTriviaCheckInstruction(false)", getTriviaCheckInstruction(false)],
  ["TRIVIA_MANAGEMENT_INSTRUCTION", TRIVIA_MANAGEMENT_INSTRUCTION],
  ["TRIVIA_GAMES_ADMIN_INSTRUCTION", TRIVIA_GAMES_ADMIN_INSTRUCTION],
  ["PENDING_QUESTION_CREATION_CONTEXT", PENDING_QUESTION_CREATION_CONTEXT],
];

describe("prompt content — no stale tool names", () => {
  for (const [name, text] of ALL_PROMPTS) {
    it(`${name} names neither retired tool`, () => {
      assert.doesNotMatch(text, /update_answers_block/, `${name} references update_answers_block`);
      assert.doesNotMatch(text, /update_question/, `${name} references update_question`);
    });
  }
});

describe("prompt content — invalidation recovery is taught", () => {
  it("the reveal prompt's invalidate step notes reversibility via reopen", () => {
    assert.match(REVEAL, /invalidate: true/);
    assert.match(REVEAL, /reopen: true/);
  });

  it("the admin runbook documents the reopen recovery sequence", () => {
    // The correction recipes (override, wrong-key, replay, reopen) live in the
    // games-admin runbook alongside the other admin fixes.
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /reopen: true/);
    // The already-revealed recovery path chains settle → reprocess → repaint.
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /reprocessQuestionIds/);
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /refresh_question_cards/);
  });
});
