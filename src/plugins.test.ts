import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<(path: string) => boolean>();
const mockReaddirSync = mock.fn<(path: string) => string[]>();
const mockReadFileSync = mock.fn<(path: string, encoding: string) => string>();
const mockStatSync = mock.fn<(path: string) => { isDirectory: () => boolean }>();

mock.module("node:fs", {
  namedExports: {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    statSync: mockStatSync,
  },
});

const mockGetDataDir = mock.fn<() => string>();

mock.module("./config.js", {
  namedExports: {
    getDataDir: mockGetDataDir,
  },
});

const { discoverPluginInfo, discoverPlugins } = await import("./plugins.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  mockExistsSync.mock.resetCalls();
  mockReaddirSync.mock.resetCalls();
  mockReadFileSync.mock.resetCalls();
  mockStatSync.mock.resetCalls();
  mockGetDataDir.mock.resetCalls();

  mockGetDataDir.mock.mockImplementation(() => "/fake/data");
  mockExistsSync.mock.mockImplementation(() => false);
  mockReaddirSync.mock.mockImplementation(() => []);
  mockReadFileSync.mock.mockImplementation(() => "{}");
  mockStatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));
}

// ---------------------------------------------------------------------------
// discoverPluginInfo
// ---------------------------------------------------------------------------

describe("discoverPluginInfo", () => {
  beforeEach(resetMocks);

  it("returns empty array when plugins directory does not exist", () => {
    mockExistsSync.mock.mockImplementation(() => false);

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("returns empty array when plugins directory is empty", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/plugins");
    mockReaddirSync.mock.mockImplementation(() => []);

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips non-directory entries in plugins/", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/plugins");
    mockReaddirSync.mock.mockImplementation(() => ["somefile.txt"]);
    mockStatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips directories without a .claude-plugin manifest", () => {
    const calls: string[] = [];
    mockExistsSync.mock.mockImplementation((p: string) => {
      calls.push(p);
      // Only the plugins dir itself exists, not plugin.json or marketplace.json
      return p === "/fake/data/plugins";
    });
    mockReaddirSync.mock.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/my-plugin",
    }));

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("discovers a plugin with plugin.json manifest", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/awesome/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["awesome"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/awesome",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Awesome Plugin" }));

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Awesome Plugin");
    assert.equal(result[0].path, "/fake/data/plugins/awesome");
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers a plugin with marketplace.json manifest", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/market/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["market"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/market",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Market Plugin" }));

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Market Plugin");
  });

  it("prefers plugin.json over marketplace.json", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/both/.claude-plugin/plugin.json",
      "/fake/data/plugins/both/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["both"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/both",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Plugin JSON Name" }));

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    // readFileSync should be called with plugin.json path, not marketplace.json
    const readPath = mockReadFileSync.mock.calls[0].arguments[0];
    assert.ok(readPath.endsWith("plugin.json"));
  });

  it("uses directory name as fallback when manifest has no name", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/fallback-name/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["fallback-name"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/fallback-name",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({}));

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "fallback-name");
  });

  it("counts skills from manifest plugins[0].skills", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/skilled/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["skilled"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/skilled",
    }));
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        name: "Skilled Plugin",
        plugins: [{ skills: ["skill-a", "skill-b", "skill-c"] }],
      }),
    );

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].skillCount, 3);
  });

  it("counts skills from skills/ directory when not in manifest", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/dir-skills/.claude-plugin/plugin.json",
      "/fake/data/plugins/dir-skills/skills",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));

    let readdirCallCount = 0;
    mockReaddirSync.mock.mockImplementation(() => {
      readdirCallCount++;
      if (readdirCallCount === 1) return ["dir-skills"]; // plugins dir listing
      return ["skill-one", "skill-two", "not-a-dir"]; // skills dir listing
    });

    let _statCallCount = 0;
    mockStatSync.mock.mockImplementation((p: string) => {
      _statCallCount++;
      // The plugin entry itself and skill subdirs
      if (p === "/fake/data/plugins/dir-skills") return { isDirectory: () => true };
      if (p.endsWith("skill-one")) return { isDirectory: () => true };
      if (p.endsWith("skill-two")) return { isDirectory: () => true };
      if (p.endsWith("not-a-dir")) return { isDirectory: () => false };
      return { isDirectory: () => false };
    });
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Dir Skills Plugin" }));

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].skillCount, 2);
  });

  it("uses defaults when manifest JSON is invalid", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/broken/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["broken"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/broken",
    }));
    mockReadFileSync.mock.mockImplementation(() => "{ not valid json }}}");

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "broken"); // falls back to dir name
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers multiple plugins", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/alpha/.claude-plugin/plugin.json",
      "/fake/data/plugins/beta/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));

    let _readdirCallCount = 0;
    mockReaddirSync.mock.mockImplementation(() => {
      _readdirCallCount++;
      return ["alpha", "beta"];
    });
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/alpha" || p === "/fake/data/plugins/beta",
    }));
    mockReadFileSync.mock.mockImplementation((p: string) => {
      if (p.includes("alpha")) return JSON.stringify({ name: "Alpha" });
      return JSON.stringify({ name: "Beta" });
    });

    const result = discoverPluginInfo();
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "Alpha");
    assert.equal(result[1].name, "Beta");
  });
});

// ---------------------------------------------------------------------------
// discoverPlugins
// ---------------------------------------------------------------------------

describe("discoverPlugins", () => {
  beforeEach(resetMocks);

  it("returns empty array when no plugins found", () => {
    mockExistsSync.mock.mockImplementation(() => false);

    const result = discoverPlugins();
    assert.deepEqual(result, []);
  });

  it("returns SDK-compatible plugin configs with type and path", () => {
    const existingPaths = new Set([
      "/fake/data/plugins",
      "/fake/data/plugins/my-plugin/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/plugins/my-plugin",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "My Plugin" }));

    const result = discoverPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "local");
    assert.equal(result[0].path, "/fake/data/plugins/my-plugin");
  });
});
