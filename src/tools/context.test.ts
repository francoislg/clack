import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQueryContext, buildWorkerContext } from "./context.js";
import type { BuildQueryContextParams, BuildWorkerContextParams } from "./context.js";
import type { Config } from "../config.js";

const stubConfig = {} as Config;

describe("buildQueryContext", () => {
  it("returns a QueryToolContext with mode 'query' and all params mapped", () => {
    const params: BuildQueryContextParams = {
      userId: "U123",
      role: "dev",
      session: { id: "sess-1" } as unknown as BuildQueryContextParams["session"],
      config: stubConfig,
      changesWorkflowEnabled: true,
    };

    const ctx = buildQueryContext(params);

    assert.equal(ctx.mode, "query");
    assert.equal(ctx.userId, "U123");
    assert.equal(ctx.role, "dev");
    assert.deepEqual(ctx.session, { id: "sess-1" });
    assert.equal(ctx.config, stubConfig);
    assert.equal(ctx.changesWorkflowEnabled, true);
    assert.equal(ctx.slackClient, undefined);
    assert.equal(ctx.deliver, undefined);
  });

  it("passes optional slackClient and deliver when provided", () => {
    const fakeClient = { chat: {} } as unknown as BuildQueryContextParams["slackClient"];
    const fakeDeliver = async () => ({ ok: true as const });

    const params: BuildQueryContextParams = {
      userId: "U456",
      role: "admin",
      session: { id: "sess-2" } as unknown as BuildQueryContextParams["session"],
      config: stubConfig,
      changesWorkflowEnabled: false,
      slackClient: fakeClient,
      deliver: fakeDeliver,
    };

    const ctx = buildQueryContext(params);

    assert.equal(ctx.slackClient, fakeClient);
    assert.equal(ctx.deliver, fakeDeliver);
    assert.equal(ctx.changesWorkflowEnabled, false);
  });

  it("preserves the exact role value", () => {
    for (const role of ["member", "dev", "admin", "owner"] as const) {
      const ctx = buildQueryContext({
        userId: "U1",
        role,
        session: {} as unknown as BuildQueryContextParams["session"],
        config: stubConfig,
        changesWorkflowEnabled: false,
      });
      assert.equal(ctx.role, role);
    }
  });
});

describe("buildWorkerContext", () => {
  it("returns a WorkerToolContext with mode 'worker' and all params mapped", () => {
    const params: BuildWorkerContextParams = {
      worktreePath: "/tmp/worktrees/abc",
      branchName: "feat/test",
      repoName: "my-repo",
      repoUrl: "https://github.com/org/my-repo",
      channelId: "C789",
      threadTs: "1234567890.123456",
      sessionId: "sess-3",
      config: stubConfig,
    };

    const ctx = buildWorkerContext(params);

    assert.equal(ctx.mode, "worker");
    assert.equal(ctx.worktreePath, "/tmp/worktrees/abc");
    assert.equal(ctx.branchName, "feat/test");
    assert.equal(ctx.repoName, "my-repo");
    assert.equal(ctx.repoUrl, "https://github.com/org/my-repo");
    assert.equal(ctx.channelId, "C789");
    assert.equal(ctx.threadTs, "1234567890.123456");
    assert.equal(ctx.sessionId, "sess-3");
    assert.equal(ctx.config, stubConfig);
  });

  it("uses the same config reference passed in", () => {
    const specificConfig = { special: true } as unknown as Config;
    const ctx = buildWorkerContext({
      worktreePath: "/w",
      branchName: "b",
      repoName: "r",
      repoUrl: "u",
      channelId: "C1",
      threadTs: "0.0",
      sessionId: "s1",
      config: specificConfig,
    });

    assert.equal(ctx.config, specificConfig);
  });
});
