import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRosterBlock, orderedRosterUserIds } from "./roster.js";
import type { SubmittedAnswer } from "../core/types.js";

function row(userId: string, timestamp: number): SubmittedAnswer {
  return {
    userId,
    questionId: "q-1",
    answerText: "ignored",
    timestamp,
  };
}

describe("orderedRosterUserIds", () => {
  it("returns a single user for a single row", () => {
    assert.deepEqual(orderedRosterUserIds([row("U_A", 100)]), ["U_A"]);
  });

  it("returns users newest-first by timestamp", () => {
    const rows = [row("U_A", 100), row("U_B", 200), row("U_C", 150)];
    assert.deepEqual(orderedRosterUserIds(rows), ["U_B", "U_C", "U_A"]);
  });

  it("dedupes the same user and uses their MAX timestamp for ordering", () => {
    // U_A submitted at 100, then edited at 300 → should sort above U_B (200)
    const rows = [row("U_A", 100), row("U_B", 200), row("U_A", 300)];
    const ordered = orderedRosterUserIds(rows);
    assert.deepEqual(ordered, ["U_A", "U_B"]);
    assert.equal(ordered.length, 2);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(orderedRosterUserIds([]), []);
  });

  it("ignores rows for other questions when caller didn't pre-filter", () => {
    // Caller is expected to pre-filter by questionId — this test just confirms
    // the helper doesn't crash on heterogeneous input and treats every row
    // as part of the roster. (Documented call-site assumption.)
    const rows: SubmittedAnswer[] = [
      { userId: "U_A", questionId: "q-other", timestamp: 500 },
      { userId: "U_B", questionId: "q-1", timestamp: 200, answerText: "x" },
    ];
    assert.deepEqual(orderedRosterUserIds(rows), ["U_A", "U_B"]);
  });
});

describe("buildRosterBlock", () => {
  it("renders a context block with the mention list for 1 user", () => {
    const block = buildRosterBlock(["U_A"], "q-1");
    assert.equal(block.type, "context");
    assert.equal(block.block_id, "freeform-answered-roster:q-1");
    const el = block.elements[0];
    assert.equal(el.type, "mrkdwn");
    if (el.type === "mrkdwn") {
      assert.equal(el.text, "📝 *Answered:* <@U_A>");
    }
  });

  it("renders mentions in the supplied order (newest-first responsibility of caller)", () => {
    const block = buildRosterBlock(["U_C", "U_A", "U_B"], "q-1");
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.equal(el.text, "📝 *Answered:* <@U_C>, <@U_A>, <@U_B>");
    } else {
      assert.fail("expected mrkdwn element");
    }
  });

  it("emits a sentinel message for an empty list", () => {
    const block = buildRosterBlock([], "q-1");
    const el = block.elements[0];
    if (el.type === "mrkdwn") {
      assert.match(el.text, /no answers yet/i);
    } else {
      assert.fail("expected mrkdwn element");
    }
  });

  it("namespaces the block_id by questionId", () => {
    assert.equal(buildRosterBlock(["U_A"], "q-abc").block_id, "freeform-answered-roster:q-abc");
    assert.equal(buildRosterBlock(["U_A"], "q-xyz").block_id, "freeform-answered-roster:q-xyz");
  });
});
