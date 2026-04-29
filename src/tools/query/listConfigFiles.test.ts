import { describe, it, mock } from "node:test";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import { createListConfigFilesTool, type ListConfigFilesDeps } from "./listConfigFiles.js";
import type { QueryToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeSession = { sessionId: "test", channelId: "C1", threadTs: "1.0" };
const fakeConfig = {};

function makeCtx(): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
    session: fakeSession as QueryToolContext["session"],
    config: fakeConfig as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
  };
}

function makeDeps(overrides: Partial<ListConfigFilesDeps> = {}): ListConfigFilesDeps {
  return {
    listInstructionFiles: mock.fn<ListConfigFilesDeps["listInstructionFiles"]>(() => ({
      roles: [],
      preAnalysis: [],
      repos: [],
    })),
    ...overrides,
  };
}

function callTool(ctx: QueryToolContext, deps: ListConfigFilesDeps) {
  const toolDef = createListConfigFilesTool(ctx, deps);
  return toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listConfigFiles tool", () => {
  it("returns the empty shape when no files exist", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { roles: [], preAnalysis: [], repos: [] });
  });

  it("returns roles with semantic file/status entries", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [
          {
            role: "user",
            files: [
              { file: "identity.md", status: "default" },
              { file: "response-style.md", status: "customized" },
            ],
            topics: [],
          },
          {
            role: "dev",
            files: [{ file: "changes.md", status: "default" }],
            topics: [],
          },
        ],
        preAnalysis: [],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    const userRole = parsed.roles.find((r: { role: string }) => r.role === "user");
    assert.equal(userRole.files.length, 2);
    assert.equal(userRole.files[0].file, "identity.md");
    assert.equal(userRole.files[0].status, "default");
    assert.equal(userRole.files[1].status, "customized");
    assert.deepEqual(userRole.topics, []);

    const devRole = parsed.roles.find((r: { role: string }) => r.role === "dev");
    assert.equal(devRole.files.length, 1);
    assert.equal(devRole.files[0].file, "changes.md");
  });

  it("surfaces topic groups under their role", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [
          {
            role: "user",
            files: [{ file: "identity.md", status: "default" }],
            topics: [
              {
                topic: "metabase",
                files: [{ file: "rules.md", status: "customized" }],
              },
            ],
          },
        ],
        preAnalysis: [],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    const userRole = parsed.roles[0];
    assert.equal(userRole.topics.length, 1);
    assert.equal(userRole.topics[0].topic, "metabase");
    assert.equal(userRole.topics[0].files[0].file, "rules.md");
    assert.equal(userRole.topics[0].files[0].status, "customized");
  });

  it("surfaces multiple topics under a single role", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [
          {
            role: "dev",
            files: [],
            topics: [
              { topic: "metabase", files: [{ file: "queries.md", status: "default" }] },
              { topic: "monday", files: [{ file: "boards.md", status: "custom-only" }] },
            ],
          },
        ],
        preAnalysis: [],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    const devRole = parsed.roles[0];
    assert.equal(devRole.topics.length, 2);
    const topicNames = devRole.topics.map((t: { topic: string }) => t.topic);
    assert.ok(topicNames.includes("metabase"));
    assert.ok(topicNames.includes("monday"));
  });

  it("surfaces repos grouped by repo name with semantic statuses", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [],
        preAnalysis: [],
        repos: [
          {
            repo: "alpha",
            files: [
              { file: "changes_instructions.md", status: "default" },
              { file: "worktree_setup_instructions.md", status: "not_created" },
            ],
          },
        ],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.equal(parsed.repos.length, 1);
    assert.equal(parsed.repos[0].repo, "alpha");
    assert.equal(parsed.repos[0].files.length, 2);
    assert.equal(parsed.repos[0].files[0].status, "default");
    assert.equal(parsed.repos[0].files[1].status, "not_created");
  });

  it("surfaces preAnalysis as a top-level field", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [],
        preAnalysis: [{ file: "context.md", status: "customized" }],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.equal(parsed.preAnalysis.length, 1);
    assert.equal(parsed.preAnalysis[0].file, "context.md");
    assert.equal(parsed.preAnalysis[0].status, "customized");
  });
});
