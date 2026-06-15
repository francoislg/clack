import { describe, it, vi, expect } from "vitest";
import { createProposeSpinoffTool, type ProposeSpinoffDeps } from "./proposeSpinoff.js";
import type { WorkerToolContext, StagedSpinoffIntent } from "../types.js";
import type { Config } from "../../config.js";
import type { SpinoffGitOps } from "../../changes/spinoff.js";
import { createIntentStore, type IntentStore } from "../server.js";
import { parseToolResult } from "../testHelpers.js";

const testConfig = { repositories: [] } as Partial<Config> as Config;

function makeCtx(overrides?: Partial<WorkerToolContext>): WorkerToolContext {
  return {
    mode: "worker",
    worktreePath: "/tmp/worktrees/my-repo/branch",
    branchName: "clack/feat/parent",
    repoName: "my-repo",
    repoUrl: "https://github.com/org/my-repo.git",
    channelId: "C123",
    threadTs: "1.0",
    sessionId: "sess-1",
    config: testConfig,
    ...overrides,
  };
}

function makeGitOps(
  capture: SpinoffGitOps["captureAndRevertSlice"] = async () => "diff --git a/x b/x\n+changed\n",
): { gitOps: SpinoffGitOps; captureAndRevertSlice: ReturnType<typeof vi.fn> } {
  const captureAndRevertSlice = vi.fn<SpinoffGitOps["captureAndRevertSlice"]>(capture);
  const gitOps: SpinoffGitOps = {
    captureAndRevertSlice,
    applySlicePatch: vi.fn<SpinoffGitOps["applySlicePatch"]>(async () => {}),
  };
  return { gitOps, captureAndRevertSlice };
}

function makeDeps(gitOps: SpinoffGitOps): ProposeSpinoffDeps {
  return { gitOps, appendExecutionLog: vi.fn() };
}

const validArgs = {
  paths: ["src/a.ts", "src/b.ts"],
  description: "Extract shared util",
  proposed_branch: "clack/refactor/extract-util",
};

describe("propose_spinoff tool", () => {
  it("stages a spinoff intent and reverts the slice for a valid request", async () => {
    const store: IntentStore = createIntentStore();
    const { gitOps, captureAndRevertSlice } = makeGitOps();
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    const result = await toolDef.handler(validArgs, { sessionId: "test" });
    const parsed = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.applied).toBe(false);
    expect(parsed.proposed_branch).toBe("clack/refactor/extract-util");

    expect(captureAndRevertSlice).toHaveBeenCalledTimes(1);
    expect(captureAndRevertSlice.mock.calls[0]![1]).toEqual(validArgs.paths);

    const staged = [...store.getAll().values()];
    expect(staged).toHaveLength(1);
    const intent = staged[0] as StagedSpinoffIntent;
    expect(intent.type).toBe("spinoff");
    expect(intent.proposedBranch).toBe("clack/refactor/extract-util");
    expect(intent.paths).toEqual(validArgs.paths);
    expect(intent.patchPath).toContain("clack-feat-parent.0.patch");
  });

  it("rejects an invalid proposed branch and stages nothing", async () => {
    const store = createIntentStore();
    const { gitOps, captureAndRevertSlice } = makeGitOps();
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    const result = await toolDef.handler(
      { ...validArgs, proposed_branch: "not-a-clack-branch" },
      { sessionId: "test" },
    );

    expect(result.isError).toBe(true);
    expect(captureAndRevertSlice).not.toHaveBeenCalled();
    expect(store.getAll().size).toBe(0);
  });

  it("rejects spinning off to the current branch", async () => {
    const store = createIntentStore();
    const { gitOps, captureAndRevertSlice } = makeGitOps();
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    const result = await toolDef.handler(
      { ...validArgs, proposed_branch: "clack/feat/parent" },
      { sessionId: "test" },
    );

    expect(result.isError).toBe(true);
    expect(captureAndRevertSlice).not.toHaveBeenCalled();
    expect(store.getAll().size).toBe(0);
  });

  it("errors when the slice produces an empty patch (nothing to spin off)", async () => {
    const store = createIntentStore();
    const { gitOps } = makeGitOps(async () => "   \n");
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    const result = await toolDef.handler(validArgs, { sessionId: "test" });

    expect(result.isError).toBe(true);
    expect(store.getAll().size).toBe(0);
  });

  it("indexes patch paths so a second spinoff in the same run does not collide", async () => {
    const store = createIntentStore();
    const { gitOps } = makeGitOps();
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    await toolDef.handler(validArgs, { sessionId: "test" });
    await toolDef.handler(
      { ...validArgs, proposed_branch: "clack/chore/second" },
      { sessionId: "test" },
    );

    const intents = [...store.getAll().values()] as StagedSpinoffIntent[];
    expect(intents).toHaveLength(2);
    expect(intents[0]!.patchPath).toContain(".0.patch");
    expect(intents[1]!.patchPath).toContain(".1.patch");
  });

  it("surfaces a capture failure as an error and stages nothing", async () => {
    const store = createIntentStore();
    const { gitOps } = makeGitOps(async () => {
      throw new Error("git exploded");
    });
    const toolDef = createProposeSpinoffTool(makeCtx(), store, makeDeps(gitOps));

    const result = await toolDef.handler(validArgs, { sessionId: "test" });
    const parsed = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(parsed.error).toContain("git exploded");
    expect(store.getAll().size).toBe(0);
  });
});
