import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Mocks
// ============================================================================

mock.module("../../config.js", {
  namedExports: {
    getDataDir: () => "/tmp/test-data",
    validateConfig: mock.fn((_config: unknown, _auth: unknown) => ({})),
    loadSlackAuth: mock.fn(() => ({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
    })),
    getConfig: () => ({}),
    loadConfig: () => ({}),
    getRepositoriesDir: () => "/tmp/test-data/repositories",
    getSessionsDir: () => "/tmp/test-data/sessions",
    getWorktreesDir: () => "/tmp/test-data/worktrees",
    getConfigurationDir: () => "/tmp/test-data/configuration",
    getDefaultConfigurationDir: () => "/tmp/test-data/default_configuration",
    getWorktreeSessionsDir: () => "/tmp/test-data/worktree-sessions",
    findRepoByName: () => undefined,
  },
});

const { isAllowedPath, validateContent, getAllowedPaths } = await import("./allowlist.js");

// ============================================================================
// Tests
// ============================================================================

describe("isAllowedPath", () => {
  it("allows config.json", () => {
    assert.ok(isAllowedPath("config.json"));
  });

  it("allows mcp.json", () => {
    assert.ok(isAllowedPath("mcp.json"));
  });

  it("allows auth/.env", () => {
    assert.ok(isAllowedPath("auth/.env"));
  });

  it("allows tool_mapping JSON files", () => {
    assert.ok(isAllowedPath("configuration/tool_mapping/clack.json"));
    assert.ok(isAllowedPath("configuration/tool_mapping/github.json"));
  });

  it("allows tool_mapping directory listing", () => {
    assert.ok(isAllowedPath("configuration/tool_mapping/"));
  });

  it("rejects disallowed paths", () => {
    assert.ok(!isAllowedPath("auth/slack.json"));
    assert.ok(!isAllowedPath("auth/github.json"));
    assert.ok(!isAllowedPath("auth/github-app.pem"));
    assert.ok(!isAllowedPath("state/roles.json"));
    assert.ok(!isAllowedPath("sessions/foo.json"));
  });

  it("rejects path traversal", () => {
    assert.ok(!isAllowedPath("../something"));
    assert.ok(!isAllowedPath("auth/../config.json"));
    assert.ok(!isAllowedPath("configuration/tool_mapping/../../auth/slack.json"));
  });

  it("rejects non-JSON files in tool_mapping", () => {
    assert.ok(!isAllowedPath("configuration/tool_mapping/readme.md"));
    assert.ok(!isAllowedPath("configuration/tool_mapping/script.sh"));
  });
});

describe("getAllowedPaths", () => {
  it("returns the list of allowed paths", () => {
    const paths = getAllowedPaths();
    assert.ok(paths.includes("config.json"));
    assert.ok(paths.includes("mcp.json"));
    assert.ok(paths.includes("auth/.env"));
    assert.ok(paths.some((p) => p.includes("tool_mapping")));
  });
});

describe("validateContent", () => {
  it("validates valid mcp.json", () => {
    const result = validateContent("mcp.json", JSON.stringify({ mcpServers: {} }));
    assert.ok(result.valid);
  });

  it("rejects mcp.json without mcpServers", () => {
    const result = validateContent("mcp.json", JSON.stringify({ foo: "bar" }));
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("mcpServers"));
  });

  it("rejects invalid JSON for mcp.json", () => {
    const result = validateContent("mcp.json", "not json");
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("Invalid JSON"));
  });

  it("validates valid dotenv content", () => {
    const result = validateContent("auth/.env", "KEY=value\nANOTHER=123\n# comment\n");
    assert.ok(result.valid);
  });

  it("rejects dotenv with missing =", () => {
    const result = validateContent("auth/.env", "GOOD=value\nBADLINE\n");
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("KEY=VALUE"));
  });

  it("validates valid tool_mapping JSON", () => {
    const result = validateContent("configuration/tool_mapping/test.json", JSON.stringify({ tools: [] }));
    assert.ok(result.valid);
  });

  it("rejects invalid JSON for tool_mapping", () => {
    const result = validateContent("configuration/tool_mapping/test.json", "{broken");
    assert.ok(!result.valid);
  });
});
