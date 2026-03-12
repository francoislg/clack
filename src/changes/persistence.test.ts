import { describe, it, beforeEach, mock, type Mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ChangeSession, ChangeStatus, PersistedSessionState } from "./types.js";

// ============================================================================
// Mock setup
// ============================================================================

let mockWorktreeSessionsDir = "/tmp/test-worktree-sessions";

mock.module("../config.js", {
  namedExports: {
    getWorktreeSessionsDir: () => mockWorktreeSessionsDir,
  },
});

mock.module("../logger.js", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  },
});

// Track all filesystem calls
let fsState: {
  existingPaths: Set<string>;
  files: Map<string, string>;
  mkdirCalls: string[];
  writeCalls: Array<{ path: string; content: string }>;
  appendCalls: Array<{ path: string; content: string }>;
  rmSyncCalls: Array<{ path: string; opts: unknown }>;
  rmCalls: Array<{ path: string; opts: unknown }>;
  statResults: Map<string, { isDirectory: () => boolean; mtimeMs: number }>;
  readdirResult: string[];
  readFileFn: ((path: string) => string) | null;
  rmShouldThrow: boolean;
  rmAsyncShouldThrow: boolean;
};

function resetFsState() {
  fsState = {
    existingPaths: new Set(),
    files: new Map(),
    mkdirCalls: [],
    writeCalls: [],
    appendCalls: [],
    rmSyncCalls: [],
    rmCalls: [],
    statResults: new Map(),
    readdirResult: [],
    readFileFn: null,
    rmShouldThrow: false,
    rmAsyncShouldThrow: false,
  };
}

resetFsState();

mock.module("node:fs", {
  namedExports: {
    existsSync: (p: string) => fsState.existingPaths.has(p),
    mkdirSync: (p: string, _opts?: unknown) => {
      fsState.mkdirCalls.push(p);
      fsState.existingPaths.add(p);
    },
    writeFileSync: (p: string, content: string) => {
      fsState.writeCalls.push({ path: p, content });
      fsState.files.set(p, content);
    },
    appendFileSync: (p: string, content: string) => {
      fsState.appendCalls.push({ path: p, content });
    },
    rmSync: (p: string, opts?: unknown) => {
      if (fsState.rmShouldThrow) {
        throw new Error("rmSync failed");
      }
      fsState.rmSyncCalls.push({ path: p, opts });
      fsState.existingPaths.delete(p);
    },
  },
});

mock.module("node:fs/promises", {
  namedExports: {
    readFile: async (p: string, _encoding?: string) => {
      if (fsState.readFileFn) {
        return fsState.readFileFn(p);
      }
      const content = fsState.files.get(p);
      if (content !== undefined) return content;
      throw new Error(`ENOENT: no such file: ${p}`);
    },
    readdir: async (_p: string) => {
      return fsState.readdirResult;
    },
    stat: async (p: string) => {
      const result = fsState.statResults.get(p);
      if (result) return result;
      throw new Error(`ENOENT: no such file or directory: ${p}`);
    },
    rm: async (p: string, opts?: unknown) => {
      if (fsState.rmAsyncShouldThrow) {
        throw new Error("rm failed");
      }
      fsState.rmCalls.push({ path: p, opts });
      fsState.existingPaths.delete(p);
    },
  },
});

// Import after mocks are set up
const {
  getSessionFolderPath,
  createSessionFolder,
  writeSessionState,
  appendExecutionLog,
  readSessionState,
  removeSessionFolder,
  statusToPhase,
  getAllPersistedSessions,
  getResumableSessions,
  cleanupStaleSessionFolders,
} = await import("./persistence.js");

// ============================================================================
// Helpers
// ============================================================================

function makeSession(overrides: Partial<ChangeSession> = {}): ChangeSession {
  return {
    id: "session-123",
    userId: "U001",
    request: {
      userId: "U001",
      message: "Fix the bug",
      triggerType: "mentions",
      channel: "C001",
      threadTs: "1700000000.000001",
      messageTs: "1700000000.000002",
    },
    plan: {
      branchName: "feat/fix-bug",
      description: "Fix the critical bug",
      targetRepo: "my-org/my-repo",
    },
    status: "executing" as ChangeStatus,
    createdAt: new Date("2026-01-15T10:00:00Z"),
    lastActivityAt: new Date("2026-01-15T10:30:00Z"),
    channel: "C001",
    threadTs: "1700000000.000001",
    ...overrides,
  };
}

function makePersistedState(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
  return {
    sessionId: "session-123",
    status: "executing",
    phase: "Implementing",
    branch: "feat/fix-bug",
    repo: "my-org/my-repo",
    userId: "U001",
    description: "Fix the critical bug",
    prUrl: null,
    startedAt: "2026-01-15T10:00:00.000Z",
    lastActivityAt: "2026-01-15T10:30:00.000Z",
    lastMessage: "Starting change workflow",
    channel: "C001",
    threadTs: "1700000000.000001",
    ...overrides,
  };
}

beforeEach(() => {
  resetFsState();
  mockWorktreeSessionsDir = "/tmp/test-worktree-sessions";
});

// ============================================================================
// statusToPhase
// ============================================================================

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
    assert.equal(statusToPhase("unknown" as never), "unknown");
  });
});

// ============================================================================
// getSessionFolderPath
// ============================================================================

describe("getSessionFolderPath", () => {
  it("returns path under worktree sessions dir", () => {
    const result = getSessionFolderPath("feat/my-branch");
    assert.equal(result, join("/tmp/test-worktree-sessions", "feat-my-branch"));
  });

  it("replaces forward slashes with dashes for filesystem safety", () => {
    const result = getSessionFolderPath("feat/nested/deep/branch");
    assert.equal(result, join("/tmp/test-worktree-sessions", "feat-nested-deep-branch"));
  });

  it("handles branch names without slashes", () => {
    const result = getSessionFolderPath("simple-branch");
    assert.equal(result, join("/tmp/test-worktree-sessions", "simple-branch"));
  });

  it("handles multiple consecutive slashes", () => {
    const result = getSessionFolderPath("a//b///c");
    assert.equal(result, join("/tmp/test-worktree-sessions", "a--b---c"));
  });
});

// ============================================================================
// createSessionFolder
// ============================================================================

describe("createSessionFolder", () => {
  it("creates the sessions dir if it does not exist", () => {
    const session = makeSession();
    createSessionFolder(session);

    assert.ok(fsState.mkdirCalls.includes("/tmp/test-worktree-sessions"));
  });

  it("creates the session folder if it does not exist", () => {
    const session = makeSession({ plan: { branchName: "feat/new", description: "desc", targetRepo: "repo" } });
    createSessionFolder(session);

    const expectedFolder = join("/tmp/test-worktree-sessions", "feat-new");
    assert.ok(fsState.mkdirCalls.includes(expectedFolder));
  });

  it("does not recreate the sessions dir if it already exists", () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    const session = makeSession();
    createSessionFolder(session);

    // Should not have called mkdir for the sessions dir itself
    assert.ok(!fsState.mkdirCalls.includes("/tmp/test-worktree-sessions"));
  });

  it("writes initial state with 'Starting change workflow' message", () => {
    const session = makeSession();
    createSessionFolder(session);

    assert.ok(fsState.writeCalls.length > 0);
    const lastWrite = fsState.writeCalls[fsState.writeCalls.length - 1];
    const parsed = JSON.parse(lastWrite.content) as PersistedSessionState;
    assert.equal(parsed.lastMessage, "Starting change workflow");
  });

  it("writes state.json in the session folder", () => {
    const session = makeSession({ plan: { branchName: "feat/test", description: "d", targetRepo: "r" } });
    createSessionFolder(session);

    const expectedStatePath = join("/tmp/test-worktree-sessions", "feat-test", "state.json");
    const writeCall = fsState.writeCalls.find((c) => c.path === expectedStatePath);
    assert.ok(writeCall, `Expected write to ${expectedStatePath}`);
  });
});

// ============================================================================
// writeSessionState
// ============================================================================

describe("writeSessionState", () => {
  it("serializes session state to JSON", () => {
    const session = makeSession();
    writeSessionState(session, "Implementing changes");

    assert.equal(fsState.writeCalls.length, 1);
    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.sessionId, "session-123");
    assert.equal(parsed.status, "executing");
    assert.equal(parsed.phase, "Implementing");
    assert.equal(parsed.branch, "feat/fix-bug");
    assert.equal(parsed.repo, "my-org/my-repo");
    assert.equal(parsed.userId, "U001");
    assert.equal(parsed.description, "Fix the critical bug");
    assert.equal(parsed.lastMessage, "Implementing changes");
  });

  it("includes prUrl when present on session", () => {
    const session = makeSession({ prUrl: "https://github.com/org/repo/pull/42" });
    writeSessionState(session, "PR created");

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.prUrl, "https://github.com/org/repo/pull/42");
  });

  it("sets prUrl to null when not present", () => {
    const session = makeSession();
    delete session.prUrl;
    writeSessionState(session, "No PR yet");

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.prUrl, null);
  });

  it("truncates lastMessage to 500 characters", () => {
    const session = makeSession();
    const longMessage = "x".repeat(1000);
    writeSessionState(session, longMessage);

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.lastMessage.length, 500);
  });

  it("keeps messages under 500 characters intact", () => {
    const session = makeSession();
    const shortMessage = "Short message";
    writeSessionState(session, shortMessage);

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.lastMessage, "Short message");
  });

  it("converts createdAt date to ISO string for startedAt", () => {
    const session = makeSession({ createdAt: new Date("2026-03-10T08:00:00Z") });
    writeSessionState(session, "test");

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.startedAt, "2026-03-10T08:00:00.000Z");
  });

  it("sets lastActivityAt to current time", () => {
    const before = new Date().toISOString();
    const session = makeSession();
    writeSessionState(session, "test");

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    const after = new Date().toISOString();
    assert.ok(parsed.lastActivityAt >= before);
    assert.ok(parsed.lastActivityAt <= after);
  });

  it("creates the folder if it does not exist", () => {
    const session = makeSession();
    writeSessionState(session, "test");

    const expectedFolder = join("/tmp/test-worktree-sessions", "feat-fix-bug");
    assert.ok(fsState.mkdirCalls.includes(expectedFolder));
  });

  it("does not recreate folder if it already exists", () => {
    const folderPath = join("/tmp/test-worktree-sessions", "feat-fix-bug");
    fsState.existingPaths.add(folderPath);

    const session = makeSession();
    writeSessionState(session, "test");

    assert.ok(!fsState.mkdirCalls.includes(folderPath));
  });

  it("includes channel and threadTs in state", () => {
    const session = makeSession({ channel: "C999", threadTs: "170.abc" });
    writeSessionState(session, "test");

    const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
    assert.equal(parsed.channel, "C999");
    assert.equal(parsed.threadTs, "170.abc");
  });

  it("maps status to correct phase via statusToPhase", () => {
    const statuses: Array<[ChangeStatus, string]> = [
      ["planning", "Planning"],
      ["executing", "Implementing"],
      ["pr_created", "PR Created"],
      ["completed", "Completed"],
      ["failed", "Failed"],
    ];

    for (const [status, expectedPhase] of statuses) {
      resetFsState();
      const session = makeSession({ status });
      writeSessionState(session, "test");

      const parsed = JSON.parse(fsState.writeCalls[0].content) as PersistedSessionState;
      assert.equal(parsed.phase, expectedPhase, `Status "${status}" should map to phase "${expectedPhase}"`);
    }
  });
});

// ============================================================================
// appendExecutionLog
// ============================================================================

describe("appendExecutionLog", () => {
  it("appends a timestamped entry to execution.log", () => {
    appendExecutionLog("feat/my-branch", "Starting implementation");

    assert.equal(fsState.appendCalls.length, 1);
    const call = fsState.appendCalls[0];
    const expectedLogPath = join("/tmp/test-worktree-sessions", "feat-my-branch", "execution.log");
    assert.equal(call.path, expectedLogPath);
    assert.match(call.content, /^\[.*\] Starting implementation\n$/);
  });

  it("includes an ISO timestamp in the log entry", () => {
    appendExecutionLog("feat/branch", "Some log message");

    const entry = fsState.appendCalls[0].content;
    // Extract timestamp from [timestamp] message format
    const match = entry.match(/^\[(.+)\]/);
    assert.ok(match, "Should contain a timestamp in brackets");
    // Verify it's a valid ISO date string
    const date = new Date(match[1]);
    assert.ok(!isNaN(date.getTime()), "Timestamp should be a valid date");
  });

  it("creates the folder if it does not exist", () => {
    appendExecutionLog("feat/new-branch", "test");

    const expectedFolder = join("/tmp/test-worktree-sessions", "feat-new-branch");
    assert.ok(fsState.mkdirCalls.includes(expectedFolder));
  });

  it("does not recreate folder if it already exists", () => {
    const folderPath = join("/tmp/test-worktree-sessions", "feat-branch");
    fsState.existingPaths.add(folderPath);

    appendExecutionLog("feat/branch", "test");
    assert.ok(!fsState.mkdirCalls.includes(folderPath));
  });
});

// ============================================================================
// readSessionState
// ============================================================================

describe("readSessionState", () => {
  it("reads and parses state.json for a given branch", async () => {
    const state = makePersistedState();
    const statePath = join("/tmp/test-worktree-sessions", "feat-fix-bug", "state.json");
    fsState.files.set(statePath, JSON.stringify(state));

    const result = await readSessionState("feat/fix-bug");
    assert.ok(result);
    assert.equal(result.sessionId, "session-123");
    assert.equal(result.status, "executing");
    assert.equal(result.branch, "feat/fix-bug");
  });

  it("returns null when state.json does not exist", async () => {
    const result = await readSessionState("nonexistent/branch");
    assert.equal(result, null);
  });

  it("returns null when state.json contains invalid JSON", async () => {
    const statePath = join("/tmp/test-worktree-sessions", "feat-bad", "state.json");
    fsState.files.set(statePath, "not valid json {{{");

    const result = await readSessionState("feat/bad");
    assert.equal(result, null);
  });
});

// ============================================================================
// removeSessionFolder
// ============================================================================

describe("removeSessionFolder", () => {
  it("removes the session folder when it exists", () => {
    const folderPath = join("/tmp/test-worktree-sessions", "feat-old");
    fsState.existingPaths.add(folderPath);

    removeSessionFolder("feat/old");

    assert.equal(fsState.rmSyncCalls.length, 1);
    assert.equal(fsState.rmSyncCalls[0].path, folderPath);
  });

  it("passes recursive option to rmSync", () => {
    const folderPath = join("/tmp/test-worktree-sessions", "feat-old");
    fsState.existingPaths.add(folderPath);

    removeSessionFolder("feat/old");

    assert.deepEqual(fsState.rmSyncCalls[0].opts, { recursive: true });
  });

  it("does nothing when folder does not exist", () => {
    removeSessionFolder("feat/nonexistent");
    assert.equal(fsState.rmSyncCalls.length, 0);
  });

  it("does not throw when rmSync fails", () => {
    const folderPath = join("/tmp/test-worktree-sessions", "feat-error");
    fsState.existingPaths.add(folderPath);
    fsState.rmShouldThrow = true;

    // Should not throw
    removeSessionFolder("feat/error");
    assert.equal(fsState.rmSyncCalls.length, 0); // rmSync threw before recording
  });
});

// ============================================================================
// getAllPersistedSessions
// ============================================================================

describe("getAllPersistedSessions", () => {
  it("returns empty array when sessions dir does not exist", async () => {
    const result = await getAllPersistedSessions();
    assert.deepEqual(result, []);
  });

  it("returns empty array when sessions dir is empty", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = [];

    const result = await getAllPersistedSessions();
    assert.deepEqual(result, []);
  });

  it("returns parsed sessions from state.json files", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-branch-a", "feat-branch-b"];

    const stateA = makePersistedState({ sessionId: "a", branch: "feat/branch-a" });
    const stateB = makePersistedState({ sessionId: "b", branch: "feat/branch-b" });

    const folderA = join("/tmp/test-worktree-sessions", "feat-branch-a");
    const folderB = join("/tmp/test-worktree-sessions", "feat-branch-b");

    fsState.statResults.set(folderA, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.statResults.set(folderB, { isDirectory: () => true, mtimeMs: Date.now() });

    fsState.files.set(join(folderA, "state.json"), JSON.stringify(stateA));
    fsState.files.set(join(folderB, "state.json"), JSON.stringify(stateB));

    const result = await getAllPersistedSessions();
    assert.equal(result.length, 2);
    assert.equal(result[0].sessionId, "a");
    assert.equal(result[1].sessionId, "b");
  });

  it("skips non-directory entries", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["a-file.txt", "a-folder"];

    const filePath = join("/tmp/test-worktree-sessions", "a-file.txt");
    const folderPath = join("/tmp/test-worktree-sessions", "a-folder");

    fsState.statResults.set(filePath, { isDirectory: () => false, mtimeMs: Date.now() });
    fsState.statResults.set(folderPath, { isDirectory: () => true, mtimeMs: Date.now() });

    const state = makePersistedState({ sessionId: "folder-session" });
    fsState.files.set(join(folderPath, "state.json"), JSON.stringify(state));

    const result = await getAllPersistedSessions();
    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, "folder-session");
  });

  it("skips folders with unparseable state.json", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["good-folder", "bad-folder"];

    const goodFolder = join("/tmp/test-worktree-sessions", "good-folder");
    const badFolder = join("/tmp/test-worktree-sessions", "bad-folder");

    fsState.statResults.set(goodFolder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.statResults.set(badFolder, { isDirectory: () => true, mtimeMs: Date.now() });

    const state = makePersistedState({ sessionId: "good" });
    fsState.files.set(join(goodFolder, "state.json"), JSON.stringify(state));
    fsState.files.set(join(badFolder, "state.json"), "invalid json");

    const result = await getAllPersistedSessions();
    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, "good");
  });

  it("skips folders without state.json", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["empty-folder"];

    const emptyFolder = join("/tmp/test-worktree-sessions", "empty-folder");
    fsState.statResults.set(emptyFolder, { isDirectory: () => true, mtimeMs: Date.now() });
    // No file set for state.json — readFile will throw

    const result = await getAllPersistedSessions();
    assert.deepEqual(result, []);
  });

  it("skips entries that fail stat", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["broken-entry"];
    // No stat result set — will throw ENOENT

    const result = await getAllPersistedSessions();
    assert.deepEqual(result, []);
  });
});

// ============================================================================
// getResumableSessions
// ============================================================================

describe("getResumableSessions", () => {
  it("returns empty array when sessions dir does not exist", async () => {
    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });

  it("includes planning sessions as resumable", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-planning"];

    const folder = join("/tmp/test-worktree-sessions", "feat-planning");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "planning", phase: "Planning" })),
    );

    const result = await getResumableSessions();
    assert.equal(result.length, 1);
    assert.equal(result[0].phase, "Planning");
  });

  it("includes executing sessions as resumable", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-exec"];

    const folder = join("/tmp/test-worktree-sessions", "feat-exec");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "executing", phase: "Implementing" })),
    );

    const result = await getResumableSessions();
    assert.equal(result.length, 1);
  });

  it("includes failed sessions as resumable", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-failed"];

    const folder = join("/tmp/test-worktree-sessions", "feat-failed");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "failed", phase: "Failed" })),
    );

    const result = await getResumableSessions();
    assert.equal(result.length, 1);
  });

  it("excludes completed sessions", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-done"];

    const folder = join("/tmp/test-worktree-sessions", "feat-done");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "completed" })),
    );

    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });

  it("excludes pr_created sessions", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-pr"];

    const folder = join("/tmp/test-worktree-sessions", "feat-pr");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "pr_created" })),
    );

    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });

  it("excludes reviewing sessions", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-reviewing"];

    const folder = join("/tmp/test-worktree-sessions", "feat-reviewing");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "reviewing" })),
    );

    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });

  it("excludes merging sessions", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-merging"];

    const folder = join("/tmp/test-worktree-sessions", "feat-merging");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "merging" })),
    );

    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });

  it("maps persisted state fields to ResumableSession shape", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-test"];

    const folder = join("/tmp/test-worktree-sessions", "feat-test");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(
        makePersistedState({
          status: "executing",
          phase: "Implementing",
          branch: "feat/test",
          repo: "my-org/repo",
          description: "Test feature",
          lastMessage: "Working on it",
          startedAt: "2026-01-15T10:00:00.000Z",
        }),
      ),
    );

    const result = await getResumableSessions();
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      branchName: "feat/test",
      repo: "my-org/repo",
      description: "Test feature",
      phase: "Implementing",
      lastMessage: "Working on it",
      startedAt: "2026-01-15T10:00:00.000Z",
    });
  });

  it("skips entries that fail stat", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["broken"];
    // No stat result — will throw

    const result = await getResumableSessions();
    assert.deepEqual(result, []);
  });
});

// ============================================================================
// cleanupStaleSessionFolders
// ============================================================================

describe("cleanupStaleSessionFolders", () => {
  it("does nothing when sessions dir does not exist", async () => {
    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("skips in-progress sessions (planning, executing, reviewing, merging)", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    const statuses: ChangeStatus[] = ["planning", "executing", "reviewing", "merging"];
    const folders = statuses.map((s) => `folder-${s}`);
    fsState.readdirResult = folders;

    for (let i = 0; i < statuses.length; i++) {
      const folderPath = join("/tmp/test-worktree-sessions", folders[i]);
      fsState.statResults.set(folderPath, { isDirectory: () => true, mtimeMs: Date.now() });
      fsState.files.set(
        join(folderPath, "state.json"),
        JSON.stringify(makePersistedState({ status: statuses[i] })),
      );
    }

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("skips failed sessions (kept for debugging)", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["failed-session"];

    const folder = join("/tmp/test-worktree-sessions", "failed-session");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "failed" })),
    );

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("skips pr_created sessions", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["pr-session"];

    const folder = join("/tmp/test-worktree-sessions", "pr-session");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "pr_created" })),
    );

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("cleans up completed sessions immediately", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["completed-session"];

    const folder = join("/tmp/test-worktree-sessions", "completed-session");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "completed" })),
    );

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 1);
    assert.equal(fsState.rmCalls[0].path, folder);
  });

  it("cleans up orphan folders (no state.json) older than retention period", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["orphan-folder"];

    const folder = join("/tmp/test-worktree-sessions", "orphan-folder");
    const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: oldTime });
    // No state.json file — readFile will throw

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 1);
    assert.equal(fsState.rmCalls[0].path, folder);
  });

  it("does not clean up orphan folders within retention period", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["recent-orphan"];

    const folder = join("/tmp/test-worktree-sessions", "recent-orphan");
    const recentTime = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: recentTime });
    // No state.json

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("respects custom retention hours", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["orphan-folder"];

    const folder = join("/tmp/test-worktree-sessions", "orphan-folder");
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: threeHoursAgo });

    // With 2-hour retention, 3-hour-old folder should be cleaned
    await cleanupStaleSessionFolders(2);
    assert.equal(fsState.rmCalls.length, 1);
  });

  it("skips folders that match active branches (slash format)", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["feat-active-branch"];

    const folder = join("/tmp/test-worktree-sessions", "feat-active-branch");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "completed" })),
    );

    // The cleanup logic converts dashes back to slashes to match active branches
    const activeBranches = new Set(["feat/active/branch"]);
    await cleanupStaleSessionFolders(24, activeBranches);
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("skips folders that match active branches (exact folder name)", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["simple-branch"];

    const folder = join("/tmp/test-worktree-sessions", "simple-branch");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "completed" })),
    );

    const activeBranches = new Set(["simple-branch"]);
    await cleanupStaleSessionFolders(24, activeBranches);
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("does not throw when rm fails during cleanup", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["completed-session"];

    const folder = join("/tmp/test-worktree-sessions", "completed-session");
    fsState.statResults.set(folder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.files.set(
      join(folder, "state.json"),
      JSON.stringify(makePersistedState({ status: "completed" })),
    );

    fsState.rmAsyncShouldThrow = true;

    // Should not throw
    await cleanupStaleSessionFolders();
  });

  it("skips non-directory entries", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["a-file.txt"];

    const filePath = join("/tmp/test-worktree-sessions", "a-file.txt");
    fsState.statResults.set(filePath, { isDirectory: () => false, mtimeMs: Date.now() });

    await cleanupStaleSessionFolders();
    assert.equal(fsState.rmCalls.length, 0);
  });

  it("handles mixed session statuses correctly", async () => {
    fsState.existingPaths.add("/tmp/test-worktree-sessions");
    fsState.readdirResult = ["completed-one", "executing-one", "failed-one"];

    const completedFolder = join("/tmp/test-worktree-sessions", "completed-one");
    const executingFolder = join("/tmp/test-worktree-sessions", "executing-one");
    const failedFolder = join("/tmp/test-worktree-sessions", "failed-one");

    fsState.statResults.set(completedFolder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.statResults.set(executingFolder, { isDirectory: () => true, mtimeMs: Date.now() });
    fsState.statResults.set(failedFolder, { isDirectory: () => true, mtimeMs: Date.now() });

    fsState.files.set(join(completedFolder, "state.json"), JSON.stringify(makePersistedState({ status: "completed" })));
    fsState.files.set(join(executingFolder, "state.json"), JSON.stringify(makePersistedState({ status: "executing" })));
    fsState.files.set(join(failedFolder, "state.json"), JSON.stringify(makePersistedState({ status: "failed" })));

    await cleanupStaleSessionFolders();
    // Only completed should be cleaned
    assert.equal(fsState.rmCalls.length, 1);
    assert.equal(fsState.rmCalls[0].path, completedFolder);
  });
});
