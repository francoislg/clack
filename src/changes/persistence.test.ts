import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusToPhase } from "./persistence.js";

describe("statusToPhase", () => {
  it("maps known statuses to human-readable phases", () => {
    assert.equal(statusToPhase("planning"), "Planning");
    assert.equal(statusToPhase("executing"), "Implementing");
    assert.equal(statusToPhase("pr_created"), "PR Created");
    assert.equal(statusToPhase("reviewing"), "Reviewing PR");
    assert.equal(statusToPhase("merging"), "Merging");
    assert.equal(statusToPhase("completed"), "Completed");
    assert.equal(statusToPhase("failed"), "Failed");
  });

  it("returns the raw status for unknown values", () => {
    // Cast to exercise the default case
    assert.equal(statusToPhase("unknown" as never), "unknown");
  });
});
