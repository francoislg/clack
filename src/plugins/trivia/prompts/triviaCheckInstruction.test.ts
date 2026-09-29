import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  getTriviaManagementDescription,
  TRIVIA_MANAGEMENT_INSTRUCTION,
  TRIVIA_CHECK_INSTRUCTION,
  TRIVIA_GAMES_ADMIN_INSTRUCTION,
  PENDING_QUESTION_CREATION_CONTEXT,
  CLARIFICATION_ALLOWED_EXAMPLE,
  CLARIFICATION_CHEATING_EXAMPLE,
  DUPLICATE_INQUIRY_GUIDANCE,
  NO_SPOILER_CONFIRMATION,
} from "./triviaCheckInstruction.js";

describe("duplicate-question inquiry carve-out", () => {
  it("is carried by both the trivia-check instruction and the pending-question context", () => {
    assert.ok(TRIVIA_CHECK_INSTRUCTION.includes(DUPLICATE_INQUIRY_GUIDANCE));
    assert.ok(PENDING_QUESTION_CREATION_CONTEXT.includes(DUPLICATE_INQUIRY_GUIDANCE));
  });

  it("is not treated as cheating", () => {
    assert.match(DUPLICATE_INQUIRY_GUIDANCE, /NOT cheating/);
    assert.match(DUPLICATE_INQUIRY_GUIDANCE, /do NOT call `save_cheating`/);
    assert.match(DUPLICATE_INQUIRY_GUIDANCE, /Look it up with `find_previous_questions`/);
  });

  it("does not cover an inquiry that also guesses a specific answer", () => {
    assert.match(DUPLICATE_INQUIRY_GUIDANCE, /states or guesses a specific answer.*answer-fishing/);
  });

  it("forbids leaking the live or the earlier question's answer", () => {
    assert.match(
      DUPLICATE_INQUIRY_GUIDANCE,
      /Never state, hint at, confirm, or rule out the answer/,
    );
    assert.match(DUPLICATE_INQUIRY_GUIDANCE, /earlier question's answer or verdict/);
  });
});

describe("no-spoiler confirmation for on-demand questions", () => {
  it("is part of the admin baseline instruction and the pending-question thread context", () => {
    assert.ok(TRIVIA_GAMES_ADMIN_INSTRUCTION.includes(NO_SPOILER_CONFIRMATION));
    assert.ok(PENDING_QUESTION_CREATION_CONTEXT.includes(NO_SPOILER_CONFIRMATION));
  });

  it("limits the confirmation to a bare 'new question' notice", () => {
    assert.match(NO_SPOILER_CONFIRMATION, /ONLY "I've generated a new question\."/);
    assert.match(NO_SPOILER_CONFIRMATION, /answer.*subject, the theme, the category/);
    assert.match(NO_SPOILER_CONFIRMATION, /not even to the admin who asked/);
  });

  it("covers replacements, top-ups, and follow-up requests", () => {
    assert.match(NO_SPOILER_CONFIRMATION, /replacement.*top-up.*"change the question".*follow-up/);
  });

  it("is referenced from the replay and top-up flows", () => {
    assert.match(
      TRIVIA_GAMES_ADMIN_INSTRUCTION,
      /reveals the replacement\. Confirm per the no-spoiler rule/,
    );
    assert.match(TRIVIA_MANAGEMENT_INSTRUCTION, /Confirm per the no-spoiler rule/);
  });
});

describe("clarification carve-out (anti-cheat ⇄ creation context consistency)", () => {
  it("the trivia-check instruction carves out pending-question clarifications", () => {
    assert.match(TRIVIA_CHECK_INSTRUCTION, /Clarification carve-out/i);
    assert.ok(TRIVIA_CHECK_INSTRUCTION.includes(CLARIFICATION_ALLOWED_EXAMPLE));
    assert.ok(TRIVIA_CHECK_INSTRUCTION.includes(CLARIFICATION_CHEATING_EXAMPLE));
  });

  it("the posted-question creation context uses the SAME canonical examples (cannot drift)", () => {
    assert.ok(PENDING_QUESTION_CREATION_CONTEXT.includes(CLARIFICATION_ALLOWED_EXAMPLE));
    assert.ok(PENDING_QUESTION_CREATION_CONTEXT.includes(CLARIFICATION_CHEATING_EXAMPLE));
  });

  it("the creation context directs re-reading the original message and stopping after reveal", () => {
    assert.match(PENDING_QUESTION_CREATION_CONTEXT, /RE-READ the original question message/);
    assert.match(PENDING_QUESTION_CREATION_CONTEXT, /REVEALED answer/);
  });
});

describe("TRIVIA_GAMES_ADMIN_INSTRUCTION — correction-tool dispatch", () => {
  const DISPATCH_TARGETS = [
    "override_answer",
    "settle_question",
    "remove_cheat",
    "override_question",
  ];

  for (const name of DISPATCH_TARGETS) {
    it(`routes to ${name}`, () => {
      assert.ok(
        TRIVIA_GAMES_ADMIN_INSTRUCTION.includes(name),
        `the dispatch heuristic must name ${name} so Claude picks the right correction tool`,
      );
    });
  }

  it("scopes override_question to points/difficulty and away from verdicts and keys", () => {
    assert.match(
      TRIVIA_GAMES_ADMIN_INSTRUCTION,
      /Do NOT reach for `override_question` to fix a verdict or an answer key/,
    );
  });

  it("states the override is bounded by the absolute range, not the configured cap", () => {
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /NOT by the game's configured `points\.max`/);
  });

  it("directs no reprocess after a points override (the aggregation join re-prices)", () => {
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /Nothing else — do NOT reprocess/);
  });

  it("keeps suggestedDifficulty un-overridable", () => {
    assert.match(TRIVIA_GAMES_ADMIN_INSTRUCTION, /cannot touch `suggestedDifficulty`/);
  });
});

describe("getTriviaManagementDescription", () => {
  const ALWAYS_REGISTERED = [
    "upsert_game",
    "delete_game",
    "unlock_questions",
    "set_workspace_config",
    "add_categories",
    "remove_categories",
  ];
  const SEASONS_GATED = ["upsert_season", "delete_season"];

  for (const name of ALWAYS_REGISTERED) {
    it(`mentions ${name} regardless of the seasons flag`, () => {
      assert.ok(
        getTriviaManagementDescription(false).includes(name),
        `description must mention ${name} so Claude can discover the gated tool`,
      );
      assert.ok(getTriviaManagementDescription(true).includes(name));
    });
  }

  for (const name of SEASONS_GATED) {
    it(`mentions ${name} only when seasons are enabled`, () => {
      assert.ok(getTriviaManagementDescription(true).includes(name));
      assert.ok(
        !getTriviaManagementDescription(false).includes(name),
        `description must not advertise ${name} when the tool is not registered`,
      );
    });
  }

  it("flags itself as admin-only", () => {
    assert.match(getTriviaManagementDescription(true), /admin/i);
  });
});

describe("TRIVIA_MANAGEMENT_INSTRUCTION — correcting an already-posted batch", () => {
  const REQUIRED = [
    "Correcting an already-posted batch",
    "compute_answers",
    "reprocessQuestionIds",
    "refresh_question_cards",
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
