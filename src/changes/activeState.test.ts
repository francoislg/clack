import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  getActiveChange,
  setActiveChange,
  clearActiveChange,
  updateActiveChangeStatus,
  updateActiveChangePrUrl,
  getActiveChangeForUser,
  getActiveWorkers,
  getActiveChangeBranches,
  setActiveStateDeps,
  type ActiveStateDeps,
  type ActiveChangeState,
  type SessionRef,
} from "./activeState.js";
import { makeFakeRunHandle } from "../claude/runHandle.testFixtures.js";

// ============================================================================
// Helpers
// ============================================================================

function makeDeps(): ActiveStateDeps {
  return {
    writeSessionState: mock.fn(() => {}),
    createSessionFolder: mock.fn(() => {}),
    appendExecutionLog: mock.fn(() => {}),
    removeSessionFolder: mock.fn(() => {}),
    statusToPhase: (status: string) => status,
  };
}

function makeChange(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
  return {
    branch: "feat/test-branch",
    repo: "my-org/my-repo",
    description: "Test change",
    status: "executing",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    lastActivityAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRef(overrides: Partial<SessionRef> = {}): SessionRef {
  return {
    userId: "U001",
    channelId: "C001",
    threadTs: "1700000000.000001",
    ...overrides,
  };
}

// Clean up shared state between tests
beforeEach(() => {
  setActiveStateDeps(makeDeps());
  clearActiveChange("session-1");
  clearActiveChange("session-2");
  clearActiveChange("session-3");
  clearActiveChange("nonexistent");
});

// ============================================================================
// getActiveChange / setActiveChange
// ============================================================================

describe("setActiveChange / getActiveChange", () => {
  it("stores and retrieves an active change by session id", () => {
    const change = makeChange();
    setActiveChange("session-1", change, makeRef());

    const result = getActiveChange("session-1");
    assert.deepEqual(result, change);
  });

  it("returns undefined for an unknown session id", () => {
    assert.equal(getActiveChange("nonexistent"), undefined);
  });

  it("overwrites a previous change for the same session id", () => {
    setActiveChange("session-1", makeChange({ description: "first" }), makeRef());
    setActiveChange("session-1", makeChange({ description: "second" }), makeRef());

    const result = getActiveChange("session-1");
    assert.equal(result?.description, "second");
  });

  it("stores multiple independent sessions", () => {
    setActiveChange("session-1", makeChange({ branch: "feat/a" }), makeRef());
    setActiveChange("session-2", makeChange({ branch: "feat/b" }), makeRef());

    assert.equal(getActiveChange("session-1")?.branch, "feat/a");
    assert.equal(getActiveChange("session-2")?.branch, "feat/b");
  });

  it("stores and retrieves the live ClaudeRunHandle with active change", () => {
    const handle = makeFakeRunHandle();
    setActiveChange("session-1", makeChange({ handle }), makeRef());
    const change = getActiveChange("session-1");
    assert.equal(change?.handle, handle);
  });
});

// ============================================================================
// clearActiveChange
// ============================================================================

describe("clearActiveChange", () => {
  it("removes a previously stored change", () => {
    setActiveChange("session-1", makeChange(), makeRef());
    assert.ok(getActiveChange("session-1"));

    clearActiveChange("session-1");
    assert.equal(getActiveChange("session-1"), undefined);
  });

  it("is a no-op for an unknown session id", () => {
    // Should not throw
    clearActiveChange("nonexistent");
  });

  it("does not affect other sessions when clearing one", () => {
    setActiveChange("session-1", makeChange(), makeRef());
    setActiveChange("session-2", makeChange(), makeRef());

    clearActiveChange("session-1");
    assert.equal(getActiveChange("session-1"), undefined);
    assert.ok(getActiveChange("session-2"));
  });
});

// ============================================================================
// updateActiveChangeStatus
// ============================================================================

describe("updateActiveChangeStatus", () => {
  it("updates the status of an existing change", () => {
    setActiveChange("session-1", makeChange({ status: "executing" }), makeRef());
    updateActiveChangeStatus("session-1", "pr_created");

    const result = getActiveChange("session-1");
    assert.equal(result?.status, "pr_created");
  });

  it("updates lastActivityAt timestamp", () => {
    const earlyDate = new Date("2020-01-01T00:00:00Z");
    setActiveChange("session-1", makeChange({ lastActivityAt: earlyDate }), makeRef());

    updateActiveChangeStatus("session-1", "completed");

    const result = getActiveChange("session-1");
    assert.ok(result);
    assert.ok(result.lastActivityAt.getTime() > earlyDate.getTime());
  });

  it("is a no-op for a nonexistent session", () => {
    // Should not throw
    updateActiveChangeStatus("nonexistent", "completed");
    assert.equal(getActiveChange("nonexistent"), undefined);
  });

  it("is a no-op when session was cleared", () => {
    setActiveChange("session-1", makeChange(), makeRef());
    clearActiveChange("session-1");

    updateActiveChangeStatus("session-1", "completed");
    assert.equal(getActiveChange("session-1"), undefined);
  });
});

// ============================================================================
// updateActiveChangePrUrl
// ============================================================================

describe("updateActiveChangePrUrl", () => {
  it("sets prUrl on an existing change", () => {
    setActiveChange("session-1", makeChange(), makeRef());
    updateActiveChangePrUrl("session-1", "https://github.com/org/repo/pull/42");

    const result = getActiveChange("session-1");
    assert.equal(result?.prUrl, "https://github.com/org/repo/pull/42");
  });

  it("updates lastActivityAt timestamp", () => {
    const earlyDate = new Date("2020-01-01T00:00:00Z");
    setActiveChange("session-1", makeChange({ lastActivityAt: earlyDate }), makeRef());

    updateActiveChangePrUrl("session-1", "https://github.com/org/repo/pull/1");

    const result = getActiveChange("session-1");
    assert.ok(result);
    assert.ok(result.lastActivityAt.getTime() > earlyDate.getTime());
  });

  it("is a no-op for a nonexistent session", () => {
    // Should not throw
    updateActiveChangePrUrl("nonexistent", "https://github.com/org/repo/pull/1");
    assert.equal(getActiveChange("nonexistent"), undefined);
  });
});

// ============================================================================
// getActiveChangeForUser
// ============================================================================

describe("getActiveChangeForUser", () => {
  it("returns an actively executing change for a user", () => {
    setActiveChange("session-1", makeChange({ status: "executing" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.ok(result);
    assert.equal(result.sessionId, "session-1");
    assert.equal(result.change.status, "executing");
  });

  it("returns reviewing changes as active", () => {
    setActiveChange("session-1", makeChange({ status: "reviewing" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.ok(result);
    assert.equal(result.change.status, "reviewing");
  });

  it("returns merging changes as active", () => {
    setActiveChange("session-1", makeChange({ status: "merging" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.ok(result);
    assert.equal(result.change.status, "merging");
  });

  it("does NOT return pr_created as actively executing", () => {
    setActiveChange("session-1", makeChange({ status: "pr_created" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("does NOT return completed changes", () => {
    setActiveChange("session-1", makeChange({ status: "completed" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("does NOT return failed changes", () => {
    setActiveChange("session-1", makeChange({ status: "failed" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("does NOT return planning changes", () => {
    setActiveChange("session-1", makeChange({ status: "planning" }), makeRef({ userId: "U001" }));

    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("returns undefined for a user with no changes", () => {
    setActiveChange("session-1", makeChange({ status: "executing" }), makeRef({ userId: "U999" }));

    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("returns undefined when no changes exist at all", () => {
    const result = getActiveChangeForUser("U001");
    assert.equal(result, undefined);
  });

  it("only matches the correct user among multiple sessions", () => {
    setActiveChange("session-1", makeChange({ status: "executing" }), makeRef({ userId: "U001" }));
    setActiveChange("session-2", makeChange({ status: "executing" }), makeRef({ userId: "U002" }));

    const result = getActiveChangeForUser("U002");
    assert.ok(result);
    assert.equal(result.sessionId, "session-2");
  });
});

// ============================================================================
// getActiveWorkers
// ============================================================================

describe("getActiveWorkers", () => {
  it("returns an empty list when no changes exist", () => {
    assert.deepEqual(getActiveWorkers(), []);
  });

  it("returns workers for non-terminal changes", () => {
    setActiveChange("session-1", makeChange({ status: "executing" }), makeRef({ userId: "U001" }));

    const workers = getActiveWorkers();
    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, "session-1");
    assert.equal(workers[0].userId, "U001");
    assert.equal(workers[0].status, "executing");
  });

  it("includes pr_created changes as active workers", () => {
    setActiveChange("session-1", makeChange({ status: "pr_created" }), makeRef());

    const workers = getActiveWorkers();
    assert.equal(workers.length, 1);
    assert.equal(workers[0].status, "pr_created");
  });

  it("excludes completed changes", () => {
    setActiveChange("session-1", makeChange({ status: "completed" }), makeRef());

    const workers = getActiveWorkers();
    assert.equal(workers.length, 0);
  });

  it("excludes failed changes", () => {
    setActiveChange("session-1", makeChange({ status: "failed" }), makeRef());

    const workers = getActiveWorkers();
    assert.equal(workers.length, 0);
  });

  it("sorts workers by startedAt descending (newest first)", () => {
    setActiveChange(
      "session-1",
      makeChange({ status: "executing", startedAt: new Date("2026-01-01T00:00:00Z") }),
      makeRef(),
    );
    setActiveChange(
      "session-2",
      makeChange({ status: "reviewing", startedAt: new Date("2026-06-01T00:00:00Z") }),
      makeRef(),
    );
    setActiveChange(
      "session-3",
      makeChange({ status: "merging", startedAt: new Date("2026-03-01T00:00:00Z") }),
      makeRef(),
    );

    const workers = getActiveWorkers();
    assert.equal(workers.length, 3);
    assert.equal(workers[0].id, "session-2"); // June (newest)
    assert.equal(workers[1].id, "session-3"); // March
    assert.equal(workers[2].id, "session-1"); // January (oldest)
  });

  it("includes all expected fields in worker objects", () => {
    const change = makeChange({
      branch: "feat/cool",
      repo: "my-org/cool-repo",
      description: "Cool feature",
      status: "executing",
      prUrl: "https://github.com/org/repo/pull/7",
      startedAt: new Date("2026-02-15T12:00:00Z"),
    });
    const ref = makeRef({ userId: "U042", channelId: "C999", threadTs: "170.999" });
    setActiveChange("session-1", change, ref);

    const workers = getActiveWorkers();
    assert.equal(workers.length, 1);
    const w = workers[0];
    assert.equal(w.id, "session-1");
    assert.equal(w.userId, "U042");
    assert.equal(w.status, "executing");
    assert.equal(w.description, "Cool feature");
    assert.equal(w.branch, "feat/cool");
    assert.equal(w.repo, "my-org/cool-repo");
    assert.equal(w.prUrl, "https://github.com/org/repo/pull/7");
    assert.equal(w.channel, "C999");
    assert.equal(w.threadTs, "170.999");
    assert.deepEqual(w.startedAt, new Date("2026-02-15T12:00:00Z"));
  });
});

// ============================================================================
// getActiveChangeBranches
// ============================================================================

describe("getActiveChangeBranches", () => {
  it("returns an empty set when no changes exist", () => {
    const branches = getActiveChangeBranches();
    assert.equal(branches.size, 0);
  });

  it("returns branches for non-terminal changes", () => {
    setActiveChange("session-1", makeChange({ branch: "feat/a", status: "executing" }), makeRef());
    setActiveChange("session-2", makeChange({ branch: "feat/b", status: "pr_created" }), makeRef());

    const branches = getActiveChangeBranches();
    assert.equal(branches.size, 2);
    assert.ok(branches.has("feat/a"));
    assert.ok(branches.has("feat/b"));
  });

  it("excludes branches for completed changes", () => {
    setActiveChange(
      "session-1",
      makeChange({ branch: "feat/done", status: "completed" }),
      makeRef(),
    );

    const branches = getActiveChangeBranches();
    assert.equal(branches.size, 0);
  });

  it("excludes branches for failed changes", () => {
    setActiveChange(
      "session-1",
      makeChange({ branch: "feat/broken", status: "failed" }),
      makeRef(),
    );

    const branches = getActiveChangeBranches();
    assert.equal(branches.size, 0);
  });

  it("mixes active and terminal changes correctly", () => {
    setActiveChange(
      "session-1",
      makeChange({ branch: "feat/active", status: "executing" }),
      makeRef(),
    );
    setActiveChange(
      "session-2",
      makeChange({ branch: "feat/done", status: "completed" }),
      makeRef(),
    );
    setActiveChange(
      "session-3",
      makeChange({ branch: "feat/also-active", status: "reviewing" }),
      makeRef(),
    );

    const branches = getActiveChangeBranches();
    assert.equal(branches.size, 2);
    assert.ok(branches.has("feat/active"));
    assert.ok(branches.has("feat/also-active"));
    assert.ok(!branches.has("feat/done"));
  });
});
