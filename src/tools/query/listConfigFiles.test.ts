import { describe, it, vi } from "vitest";
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
    cronUserSchedules: false,
  };
}

function makeDeps(overrides: Partial<ListConfigFilesDeps> = {}): ListConfigFilesDeps {
  return {
    listInstructionFiles: vi.fn<ListConfigFilesDeps["listInstructionFiles"]>(() => ({
      roles: [],
      preAnalysis: [],
      repos: [],
    })),
    searchInstructionFiles: vi.fn<ListConfigFilesDeps["searchInstructionFiles"]>((query) => ({
      summary: { query, files: 0, hits: 0 },
      roles: [],
      preAnalysis: [],
      repos: [],
    })),
    ...overrides,
  };
}

function callTool(ctx: QueryToolContext, deps: ListConfigFilesDeps, query?: string) {
  const toolDef = createListConfigFilesTool(ctx, deps);
  return toolDef.handler({ query }, { sessionId: "test" });
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

  it("returns the full listing and does not search when query is omitted", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { roles: [], preAnalysis: [], repos: [] });
    assert.equal((deps.searchInstructionFiles as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.equal((deps.listInstructionFiles as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("falls back to the full listing for a blank/whitespace query", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps, "   ");

    parseToolResult(result);
    assert.equal((deps.searchInstructionFiles as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.equal((deps.listInstructionFiles as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("delegates to searchInstructionFiles with the trimmed query", async () => {
    const deps = makeDeps({
      searchInstructionFiles: vi.fn<ListConfigFilesDeps["searchInstructionFiles"]>((query) => ({
        summary: { query, files: 1, hits: 2 },
        roles: [
          {
            role: "admin",
            files: [
              {
                file: "identity.md",
                status: "default",
                matches: [{ layer: "default", line: 3, snippet: "the needle" }],
              },
            ],
            topics: [],
          },
        ],
        preAnalysis: [],
        repos: [],
      })),
    });

    const result = await callTool(makeCtx(), deps, "  needle  ");

    const parsed = parseToolResult(result);
    assert.equal(parsed.summary.query, "needle");
    assert.equal(parsed.summary.files, 1);
    assert.equal(parsed.roles[0].files[0].matches[0].snippet, "the needle");
    assert.equal((deps.listInstructionFiles as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.deepEqual((deps.searchInstructionFiles as ReturnType<typeof vi.fn>).mock.calls, [
      ["needle"],
    ]);
  });
});
