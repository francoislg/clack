import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  TRIVIA_MANAGEMENT_DESCRIPTION,
  TRIVIA_MANAGEMENT_INSTRUCTION,
} from "./triviaCheckInstruction.js";

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
    "reprocessBatchId",
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
