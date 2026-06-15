import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { computePriority } from "./priority.js";

describe("computePriority", () => {
  it("orders the kinds continue > triage > implement > review > none", () => {
    const c = computePriority({ kind: "continue" });
    const t = computePriority({ kind: "triage" });
    const i = computePriority({ kind: "implement" });
    const r = computePriority({ kind: "review" });
    const n = computePriority({ kind: "none" });
    assert.ok(c > t && t > i && i > r && r > n);
  });

  it("fresh input raises priority within a kind", () => {
    assert.ok(
      computePriority({ kind: "triage", freshInput: true }) > computePriority({ kind: "triage" }),
    );
  });

  it("blocked sinks below any workable kind", () => {
    const blockedContinue = computePriority({ kind: "continue", blocked: true });
    const workableReview = computePriority({ kind: "review" });
    assert.ok(blockedContinue < workableReview);
  });

  it("a fresh reply resurfaces a blocked unit above a quiet one", () => {
    const resurfaced = computePriority({ kind: "continue", blocked: false, freshInput: true });
    const stillBlocked = computePriority({ kind: "continue", blocked: true });
    assert.ok(resurfaced > stillBlocked);
  });
});
