import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  TriggerType,
  ChangeRequest,
  ChangePlan,
  ChangeSession,
  ChangeStatus,
  ChangeResult,
  FollowUpCommand,
  FollowUpInfo,
  PersistedSessionState,
  ExecutionResult,
} from "./types.js";

// ============================================================================
// types.ts — pure type definitions, no runtime code
// These tests verify the types are exported and structurally correct
// by assigning literals that conform to each type.
// ============================================================================

describe("changes/types", () => {
  describe("TriggerType", () => {
    it("accepts valid trigger types", () => {
      const types: TriggerType[] = ["directMessages", "mentions", "reactions"];
      assert.equal(types.length, 3);
    });
  });

  describe("ChangeRequest", () => {
    it("can be constructed with required fields", () => {
      const request: ChangeRequest = {
        userId: "U123",
        message: "Fix the bug",
        triggerType: "mentions",
        channel: "C456",
        messageTs: "1234567890.123456",
      };
      assert.equal(request.userId, "U123");
      assert.equal(request.triggerType, "mentions");
    });

    it("accepts optional threadTs", () => {
      const request: ChangeRequest = {
        userId: "U123",
        message: "Fix the bug",
        triggerType: "reactions",
        channel: "C456",
        messageTs: "1234567890.123456",
        threadTs: "1234567890.000001",
      };
      assert.equal(request.threadTs, "1234567890.000001");
    });
  });

  describe("ChangePlan", () => {
    it("can be constructed with all fields", () => {
      const plan: ChangePlan = {
        branchName: "fix/bug-123",
        description: "Fix null pointer in auth flow",
        targetRepo: "my-org/my-repo",
      };
      assert.equal(plan.branchName, "fix/bug-123");
      assert.equal(plan.targetRepo, "my-org/my-repo");
    });
  });

  describe("ChangeStatus", () => {
    it("accepts all valid status values", () => {
      const statuses: ChangeStatus[] = [
        "planning",
        "executing",
        "pr_created",
        "reviewing",
        "merging",
        "completed",
        "failed",
      ];
      assert.equal(statuses.length, 7);
    });
  });

  describe("ChangeSession", () => {
    it("can be constructed with required fields", () => {
      const session: ChangeSession = {
        id: "session-1",
        userId: "U123",
        request: {
          userId: "U123",
          message: "Add tests",
          triggerType: "directMessages",
          channel: "C456",
          messageTs: "1234567890.123456",
        },
        plan: {
          branchName: "feat/add-tests",
          description: "Add unit tests",
          targetRepo: "my-org/repo",
        },
        status: "planning",
        createdAt: new Date(),
        lastActivityAt: new Date(),
        channel: "C456",
        threadTs: "1234567890.123456",
      };
      assert.equal(session.id, "session-1");
      assert.equal(session.status, "planning");
      assert.equal(session.worktree, undefined);
      assert.equal(session.prUrl, undefined);
    });

    it("accepts optional worktree and prUrl", () => {
      const session: ChangeSession = {
        id: "session-2",
        userId: "U123",
        request: {
          userId: "U123",
          message: "Fix bug",
          triggerType: "mentions",
          channel: "C789",
          messageTs: "1234567890.123456",
        },
        plan: {
          branchName: "fix/bug",
          description: "Fix the bug",
          targetRepo: "org/repo",
        },
        status: "pr_created",
        createdAt: new Date(),
        lastActivityAt: new Date(),
        channel: "C789",
        threadTs: "1234567890.123456",
        prUrl: "https://github.com/org/repo/pull/42",
      };
      assert.equal(session.prUrl, "https://github.com/org/repo/pull/42");
    });
  });

  describe("ChangeResult", () => {
    it("can represent a success", () => {
      const result: ChangeResult = {
        success: true,
        prUrl: "https://github.com/org/repo/pull/1",
        summary: "Created PR with changes",
      };
      assert.equal(result.success, true);
      assert.equal(result.error, undefined);
    });

    it("can represent a failure", () => {
      const result: ChangeResult = {
        success: false,
        error: "Merge conflict",
      };
      assert.equal(result.success, false);
      assert.equal(result.prUrl, undefined);
    });
  });

  describe("FollowUpCommand", () => {
    it("accepts all valid commands", () => {
      const commands: FollowUpCommand[] = ["review", "merge", "update", "close"];
      assert.equal(commands.length, 4);
    });
  });

  describe("FollowUpInfo", () => {
    it("can be constructed with just a command", () => {
      const info: FollowUpInfo = { command: "merge" };
      assert.equal(info.command, "merge");
      assert.equal(info.additionalInstructions, undefined);
    });

    it("accepts optional additionalInstructions", () => {
      const info: FollowUpInfo = {
        command: "update",
        additionalInstructions: "Also fix the typo on line 42",
      };
      assert.equal(info.command, "update");
      assert.equal(info.additionalInstructions, "Also fix the typo on line 42");
    });
  });

  describe("PersistedSessionState", () => {
    it("can be constructed with all fields", () => {
      const state: PersistedSessionState = {
        sessionId: "sess-1",
        status: "executing",
        phase: "implementation",
        branch: "feat/thing",
        repo: "org/repo",
        userId: "U123",
        description: "Add a thing",
        prUrl: null,
        startedAt: "2025-01-01T00:00:00.000Z",
        lastActivityAt: "2025-01-01T01:00:00.000Z",
        lastMessage: "Working on it",
        channel: "C456",
        threadTs: "1234567890.123456",
      };
      assert.equal(state.sessionId, "sess-1");
      assert.equal(state.prUrl, null);
      assert.equal(state.channel, "C456");
    });

    it("allows null for channel and threadTs", () => {
      const state: PersistedSessionState = {
        sessionId: "sess-2",
        status: "completed",
        phase: "done",
        branch: "fix/bug",
        repo: "org/repo",
        userId: "U456",
        description: "Fix a bug",
        prUrl: "https://github.com/org/repo/pull/5",
        startedAt: "2025-01-01T00:00:00.000Z",
        lastActivityAt: "2025-01-01T02:00:00.000Z",
        lastMessage: "Done",
        channel: null,
        threadTs: null,
      };
      assert.equal(state.channel, null);
      assert.equal(state.threadTs, null);
    });
  });

  describe("ExecutionResult", () => {
    it("can represent a success with commit hash", () => {
      const result: ExecutionResult = {
        success: true,
        commitHash: "abc123def",
        summary: "Applied 3 changes",
      };
      assert.equal(result.success, true);
      assert.equal(result.commitHash, "abc123def");
    });

    it("can represent a failure with error", () => {
      const result: ExecutionResult = {
        success: false,
        error: "Tests failed",
      };
      assert.equal(result.success, false);
      assert.equal(result.commitHash, undefined);
    });
  });
});
