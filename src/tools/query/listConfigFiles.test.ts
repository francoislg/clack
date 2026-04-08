import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createListConfigFilesTool, type ListConfigFilesDeps } from "./listConfigFiles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  mode: "query";
  userId: string;
  role: string;
}

function makeCtx(): TestCtx {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
  };
}

function makeDeps(overrides: Partial<ListConfigFilesDeps> = {}): ListConfigFilesDeps {
  return {
    listInstructionFiles: mock.fn(() => ({
      roles: [],
      repos: [],
    })) as ListConfigFilesDeps["listInstructionFiles"],
    ...overrides,
  };
}

function callTool(ctx: TestCtx, deps: ListConfigFilesDeps) {
  const toolDef = createListConfigFilesTool(ctx as never, deps);
  return toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listConfigFiles tool", () => {
  it("returns empty object when no instruction files exist", async () => {
    const deps = makeDeps();
    const result = await callTool(makeCtx(), deps);

    const parsed = parseResult(result);
    assert.deepEqual(parsed, {});
  });

  it("returns role directories with file listings", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [
          {
            role: "user",
            files: [
              { filename: "identity.md", source: "default" },
              { filename: "response-style.md", source: "customized" },
            ],
          },
          { role: "dev", files: [{ filename: "changes.md", source: "default" }] },
        ],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseResult(result);
    assert.equal(parsed.user.length, 2);
    assert.equal(parsed.user[0].file, "identity.md");
    assert.equal(parsed.user[0].status, "default");
    assert.equal(parsed.user[1].status, "customized");
    assert.equal(parsed.dev.length, 1);
    assert.equal(parsed.dev[0].file, "changes.md");
  });

  it("includes repo files when present", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [],
        repos: [
          { filename: "my-repo/changes_instructions.md", hasOverride: false, hasDefault: true },
          {
            filename: "my-repo/worktree_setup_instructions.md",
            hasOverride: false,
            hasDefault: false,
          },
        ],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseResult(result);
    assert.equal(parsed.repos.length, 2);
    assert.equal(parsed.repos[0].status, "default");
    assert.equal(parsed.repos[1].status, "not_created");
  });

  it("includes custom-only files", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [{ role: "user", files: [{ filename: "company.md", source: "custom-only" }] }],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseResult(result);
    assert.equal(parsed.user[0].status, "custom-only");
  });

  it("omits repos key when no repo files exist", async () => {
    const deps = makeDeps({
      listInstructionFiles: () => ({
        roles: [{ role: "user", files: [{ filename: "identity.md", source: "default" }] }],
        repos: [],
      }),
    });

    const result = await callTool(makeCtx(), deps);

    const parsed = parseResult(result);
    assert.equal(parsed.repos, undefined);
  });
});
