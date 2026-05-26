import { describe, it, vi } from "vitest";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import { createListRepositoriesTool, type ListRepositoriesDeps } from "./listRepositories.js";
import type { RepositoryConfig } from "../../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  mode: "query";
  userId: string;
  role: string;
  config: { repositories: RepositoryConfig[] };
}

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ListRepositoriesDeps> = {}): ListRepositoriesDeps {
  return {
    getVisibleRepos: vi.fn(() => [makeRepo()]) as ListRepositoriesDeps["getVisibleRepos"],
    canWriteRepo: vi.fn(() => true) as ListRepositoriesDeps["canWriteRepo"],
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<TestCtx>): TestCtx {
  return {
    mode: "query",
    userId: "U123",
    role: "dev",
    config: { repositories: [makeRepo()] },
    ...overrides,
  };
}

function callTool(
  ctx: TestCtx,
  deps: ListRepositoriesDeps,
  args: { includeChangeSupport?: boolean } = {},
) {
  const toolDef = createListRepositoriesTool(ctx as never, deps);
  return toolDef.handler(
    { includeChangeSupport: args.includeChangeSupport },
    { sessionId: "test" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listRepositories tool", () => {
  it("returns visible repos with name, description, and canChange", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "my-repo");
    assert.equal(parsed[0].description, "Test repo");
    assert.equal(parsed[0].canChange, true);
  });

  it("returns canChange=false when user lacks write access", async () => {
    const deps = makeDeps({
      canWriteRepo: vi.fn(() => false) as ListRepositoriesDeps["canWriteRepo"],
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.equal(parsed[0].canChange, false);
  });

  it("includes canChange by default", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.ok("canChange" in parsed[0]);
  });

  it("includes canChange when includeChangeSupport=true", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps, { includeChangeSupport: true });

    const parsed = parseToolResult(result);
    assert.ok("canChange" in parsed[0]);
  });

  it("excludes canChange when includeChangeSupport=false", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps, { includeChangeSupport: false });

    const parsed = parseToolResult(result);
    assert.equal(parsed[0].canChange, undefined);
    assert.ok(!("canChange" in parsed[0]));
  });

  it("returns empty array when no repos are visible", async () => {
    const deps = makeDeps({
      getVisibleRepos: vi.fn(() => []) as ListRepositoriesDeps["getVisibleRepos"],
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, []);
  });

  it("returns multiple repos", async () => {
    const repos = [
      makeRepo({ name: "repo-a", description: "First repo" }),
      makeRepo({ name: "repo-b", description: "Second repo" }),
      makeRepo({ name: "repo-c", description: "Third repo" }),
    ];
    const deps = makeDeps({
      getVisibleRepos: vi.fn(() => repos) as ListRepositoriesDeps["getVisibleRepos"],
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].name, "repo-a");
    assert.equal(parsed[1].name, "repo-b");
    assert.equal(parsed[2].name, "repo-c");
  });

  it("calls getVisibleRepos with role and config repos", async () => {
    const mockGetVisibleRepos = vi.fn<ListRepositoriesDeps["getVisibleRepos"]>((_role, _repos) => [
      makeRepo(),
    ]);
    const deps = makeDeps({ getVisibleRepos: mockGetVisibleRepos });

    const result = await callTool(makeCtx({ role: "admin" }), deps);

    // Verify results are correct (confirms the function was called)
    const parsed = parseToolResult(result);
    assert.equal(parsed.length, 1);

    assert.equal(mockGetVisibleRepos.mock.calls.length, 1);
    assert.equal(mockGetVisibleRepos.mock.calls[0][0], "admin");
  });
});
