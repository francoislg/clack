import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";
import { createRunHandle } from "../claude/runHandle.js";
import type { ClackSessionRun } from "../claude/query.js";
import type { Config } from "../config.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest } from "./types.js";
import { executeChange } from "./execution.js";
import { loadSetupNotes } from "../memory/setupMemory.js";

const clackSessionMock = vi.hoisted(() => vi.fn());
vi.mock("../claude/query.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../claude/query.js")>();
  return { ...original, clackSession: clackSessionMock };
});

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config.js")>();
  return { ...original, getConfig: () => getConfigMock() };
});

vi.mock("../sessions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sessions.js")>();
  return { ...original, addSessionUsage: vi.fn(async () => {}) };
});

vi.mock("../instructions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../instructions.js")>();
  return { ...original, resolveInstructionFile: vi.fn(() => null) };
});

const appendExecutionLogMock = vi.hoisted(() => vi.fn());
vi.mock("./persistence.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./persistence.js")>();
  return { ...original, appendExecutionLog: appendExecutionLogMock };
});

vi.mock("../skillPlugins.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../skillPlugins.js")>();
  return { ...original, discoverEagerSkillPlugins: vi.fn(() => []) };
});

vi.mock("../userRegistry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../userRegistry.js")>();
  return { ...original, getUserRecord: vi.fn(async () => null) };
});

vi.mock("./workerSkillsCatalog.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./workerSkillsCatalog.js")>();
  return { ...original, appendWorkerSkillsCatalog: vi.fn((prompt: string) => prompt) };
});

// Boundary mock: HEAD snapshots degrade to undefined (skips the no-op check).
vi.mock("simple-git", () => ({
  simpleGit: () => ({
    revparse: async () => {
      throw new Error("no git in tests");
    },
  }),
}));

// setupMemory's own behavior is covered by setupMemory.test.ts — here it is a
// mocked collaborator; the prompt-section builders stay real.
const loadSetupNotesMock = vi.hoisted(() => vi.fn());
vi.mock("../memory/setupMemory.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../memory/setupMemory.js")>();
  return { ...original, loadSetupNotes: loadSetupNotesMock };
});

function makeRunFromMessages(messages: SDKMessage[]): ClackSessionRun {
  const driver = createRunHandle({ push: () => {}, closeInput: () => {} });
  const iterable: AsyncIterable<SDKMessage> = {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
      for (const m of messages) yield m;
    },
  };
  return Object.assign(driver, { messages: iterable });
}

function successResult(text: string): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result: text,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.1,
    usage: { input_tokens: 10, output_tokens: 5 } as SDKResultSuccess["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000000" as UUID,
    session_id: "test",
  };
}

const worktree: WorktreeInfo = {
  repoName: "my-repo",
  branchName: "feature/login",
  worktreePath: "/tmp/worktrees/my-repo/w1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function makeImplementPlan(): ChangePlan {
  return {
    branchName: "feature/login",
    description: "Add the login flow",
    targetRepo: "my-repo",
  };
}

function makeRequest(): ChangeRequest {
  return {
    userId: "U001",
    userDisplayName: "Frank",
    message: "add login",
    triggerType: "mentions",
    channel: "C001",
    messageTs: "1.0",
  };
}

function capturedSystemPrompt(): string {
  const params = clackSessionMock.mock.calls[0][0];
  return params.options.systemPrompt as string;
}

describe("executeChange — worker setup-notes injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const config: Partial<Config> = { repositories: [] };
    getConfigMock.mockReturnValue(config as Config);
    clackSessionMock.mockImplementation(() => makeRunFromMessages([successResult("done")]));
  });

  it("injects the learned notes section and the rewrite directive when an entry exists", async () => {
    loadSetupNotesMock.mockResolvedValue({
      notes: "## Services\n- web: pnpm dev, port 3000",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    await executeChange({
      plan: makeImplementPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.deepEqual(vi.mocked(loadSetupNotes).mock.calls[0], ["worker", "my-repo"]);
    const systemPrompt = capturedSystemPrompt();
    assert.ok(systemPrompt.includes("NOTES FROM PREVIOUS RUNS (advisory"));
    assert.ok(systemPrompt.includes("## Services\n- web: pnpm dev, port 3000"));
    assert.ok(systemPrompt.includes("REPO SETUP MEMORY"));
    assert.ok(systemPrompt.includes('"worker-setup:my-repo"'));
  });

  it("logs the injection outcome with length and staleness timestamp", async () => {
    const notes = "## Services\n- web: pnpm dev, port 3000";
    loadSetupNotesMock.mockResolvedValue({ notes, updatedAt: "2026-01-02T00:00:00.000Z" });

    await executeChange({
      plan: makeImplementPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const lines = appendExecutionLogMock.mock.calls.map((call) => call[1]);
    assert.ok(
      lines.includes(
        `Setup notes: injected (${notes.length} chars, updated 2026-01-02T00:00:00.000Z)`,
      ),
    );
  });

  it("omits the notes section on a cold run but keeps the directive, and logs the cold run", async () => {
    loadSetupNotesMock.mockResolvedValue(null);

    await executeChange({
      plan: makeImplementPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const systemPrompt = capturedSystemPrompt();
    assert.ok(!systemPrompt.includes("NOTES FROM PREVIOUS RUNS (advisory"));
    assert.ok(systemPrompt.includes("REPO SETUP MEMORY"));
    const lines = appendExecutionLogMock.mock.calls.map((call) => call[1]);
    assert.ok(lines.includes("Setup notes: none (cold run)"));
  });

  it("leaves the base execution prompt intact", async () => {
    loadSetupNotesMock.mockResolvedValue(null);

    await executeChange({
      plan: makeImplementPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const systemPrompt = capturedSystemPrompt();
    assert.ok(systemPrompt.includes("Report your final status using the report_status tool"));
  });
});
