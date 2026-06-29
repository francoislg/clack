import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  TRIVIA_MANAGEMENT_DESCRIPTION,
  TRIVIA_MANAGEMENT_INSTRUCTION,
  TRIVIA_CHECK_INSTRUCTION,
  PENDING_QUESTION_FOLLOWUP_CONTEXT,
  CLARIFICATION_ALLOWED_EXAMPLE,
  CLARIFICATION_CHEATING_EXAMPLE,
} from "./triviaCheckInstruction.js";

describe("clarification carve-out (anti-cheat ⇄ follow-up context consistency)", () => {
  it("the trivia-check instruction carves out pending-question clarifications", () => {
    assert.match(TRIVIA_CHECK_INSTRUCTION, /Clarification carve-out/i);
    assert.ok(TRIVIA_CHECK_INSTRUCTION.includes(CLARIFICATION_ALLOWED_EXAMPLE));
    assert.ok(TRIVIA_CHECK_INSTRUCTION.includes(CLARIFICATION_CHEATING_EXAMPLE));
  });

  it("the posted-question follow-up context uses the SAME canonical examples (cannot drift)", () => {
    assert.ok(PENDING_QUESTION_FOLLOWUP_CONTEXT.includes(CLARIFICATION_ALLOWED_EXAMPLE));
    assert.ok(PENDING_QUESTION_FOLLOWUP_CONTEXT.includes(CLARIFICATION_CHEATING_EXAMPLE));
  });

  it("the follow-up context directs re-reading the original message and stopping after reveal", () => {
    assert.match(PENDING_QUESTION_FOLLOWUP_CONTEXT, /RE-READ the original question message/);
    assert.match(PENDING_QUESTION_FOLLOWUP_CONTEXT, /REVEALED answer/);
  });
});

describe("TRIVIA_MANAGEMENT_DESCRIPTION", () => {
  const REQUIRED_TOOLS = [
    "upsert_game",
    "delete_game",
    "set_workspace_config",
    "upsert_season",
    "delete_season",
    "add_categories",
    "remove_categories",
  ];

  for (const name of REQUIRED_TOOLS) {
    it(`mentions ${name}`, () => {
      assert.ok(
        TRIVIA_MANAGEMENT_DESCRIPTION.includes(name),
        `description must mention ${name} so Claude can discover the gated tool`,
      );
    });
  }

  it("flags itself as admin-only", () => {
    assert.match(TRIVIA_MANAGEMENT_DESCRIPTION, /admin/i);
  });
});

describe("TRIVIA_MANAGEMENT_INSTRUCTION — correcting an already-posted batch", () => {
  const REQUIRED = [
    "Correcting an already-posted batch",
    "compute_answers",
    "reprocessQuestionIds",
    "update_answers_block",
    "run_scheduled_message_now",
  ];

  for (const fragment of REQUIRED) {
    it(`mentions ${fragment}`, () => {
      assert.ok(
        TRIVIA_MANAGEMENT_INSTRUCTION.includes(fragment),
        `instruction must mention "${fragment}" so Claude reprocesses instead of re-firing the cron`,
      );
    });
  }

  it("states config edits only affect future batches", () => {
    assert.match(TRIVIA_MANAGEMENT_INSTRUCTION, /FUTURE batches ONLY/);
  });

  it("gates reprocessing to explicit admin requests (never automatic)", () => {
    assert.match(TRIVIA_MANAGEMENT_INSTRUCTION, /SEPARATE, EXPLICIT/);
    assert.match(TRIVIA_MANAGEMENT_INSTRUCTION, /Never reprocess on your own initiative/);
    assert.match(TRIVIA_MANAGEMENT_INSTRUCTION, /automatic follow-up to a config change/);
  });
});
