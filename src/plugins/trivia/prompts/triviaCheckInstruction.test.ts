import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRIVIA_MANAGEMENT_DESCRIPTION } from "./triviaCheckInstruction.js";

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
