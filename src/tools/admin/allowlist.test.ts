import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SlackAuthConfig } from "../../config.js";
import {
  isAllowedPath,
  validateContent,
  getAllowedPaths,
  readDataFile,
  type AllowlistDeps,
  defaultAllowlistDeps,
} from "./allowlist.js";

// ============================================================================
// Helpers
// ============================================================================

function makeDeps(overrides: Partial<AllowlistDeps> = {}): AllowlistDeps {
  // validateConfig only checks for thrown errors in allowlist, return value is unused
  const validateConfig = mock.fn((_config: unknown, _auth: SlackAuthConfig) => {
    // no-op: does not throw = valid
  });
  return {
    ...defaultAllowlistDeps,
    getDataDir: () => "/tmp/test-data",
    // The allowlist only checks whether validateConfig throws, not its return value
    validateConfig: validateConfig as never as AllowlistDeps["validateConfig"],
    loadSlackAuth: mock.fn(
      (): SlackAuthConfig => ({
        botToken: "xoxb-test",
        appToken: "xapp-test",
        signingSecret: "secret",
      }),
    ),
    ...overrides,
  };
}

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

  it("rejects auth/.env (managed by dedicated env tools)", () => {
    assert.ok(!isAllowedPath("auth/.env"));
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
    assert.ok(!paths.includes("auth/.env"));
    assert.ok(paths.some((p) => p.includes("tool_mapping")));
  });
});

describe("validateContent", () => {
  it("validates valid mcp.json", () => {
    const deps = makeDeps();
    const result = validateContent("mcp.json", JSON.stringify({ mcpServers: {} }), deps);
    assert.ok(result.valid);
  });

  it("rejects mcp.json without mcpServers", () => {
    const deps = makeDeps();
    const result = validateContent("mcp.json", JSON.stringify({ foo: "bar" }), deps);
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("mcpServers"));
  });

  it("rejects invalid JSON for mcp.json", () => {
    const deps = makeDeps();
    const result = validateContent("mcp.json", "not json", deps);
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("Invalid JSON"));
  });

  it("rejects auth/.env (no validator)", () => {
    const deps = makeDeps();
    const result = validateContent("auth/.env", "KEY=value\n", deps);
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("No validator"));
  });

  it("validates valid tool_mapping JSON", () => {
    const deps = makeDeps();
    const result = validateContent(
      "configuration/tool_mapping/test.json",
      JSON.stringify({ tools: [] }),
      deps,
    );
    assert.ok(result.valid);
  });

  it("rejects invalid JSON for tool_mapping", () => {
    const deps = makeDeps();
    const result = validateContent("configuration/tool_mapping/test.json", "{broken", deps);
    assert.ok(!result.valid);
  });
});

describe("readDataFile tool_mapping directory listing", () => {
  it("excludes hidden dotfiles (._*.json, .#*.json, etc.)", () => {
    const tmpDataDir = resolve(tmpdir(), `allowlist-test-${process.pid}-${Date.now()}`);
    const toolMappingDir = resolve(tmpDataDir, "configuration/tool_mapping");
    mkdirSync(toolMappingDir, { recursive: true });
    writeFileSync(resolve(toolMappingDir, "github.json"), "{}");
    writeFileSync(resolve(toolMappingDir, "clack.json"), "{}");
    writeFileSync(resolve(toolMappingDir, "._github.json"), "apple metadata");
    writeFileSync(resolve(toolMappingDir, ".#clack.json"), "emacs lock target");
    writeFileSync(resolve(toolMappingDir, ".hidden.json"), "{}");

    try {
      const deps = makeDeps({ getDataDir: () => tmpDataDir });
      const result = readDataFile("configuration/tool_mapping/", deps);

      assert.ok(result.isDirectory);
      assert.ok(result.content?.includes("configuration/tool_mapping/github.json"));
      assert.ok(result.content?.includes("configuration/tool_mapping/clack.json"));
      assert.ok(!result.content?.includes("._github.json"));
      assert.ok(!result.content?.includes(".#clack.json"));
      assert.ok(!result.content?.includes(".hidden.json"));
    } finally {
      if (existsSync(tmpDataDir)) rmSync(tmpDataDir, { recursive: true });
    }
  });
});
