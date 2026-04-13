import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  discoverPluginInfo,
  discoverPlugins,
  setPluginsDeps,
  resetPluginsDeps,
  type PluginsDeps,
} from "./plugins.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<(path: string) => boolean>();
const mockReaddirSync = mock.fn<(path: string) => string[]>();
const mockReadFileSync = mock.fn<(path: string, encoding: string) => string>();
const mockStatSync = mock.fn<(path: string) => { isDirectory: () => boolean }>();
const mockGetDataDir = mock.fn<() => string>();

function makeDeps(): PluginsDeps {
  return {
    existsSync: mockExistsSync as PluginsDeps["existsSync"],
    readdirSync: mockReaddirSync as Function as PluginsDeps["readdirSync"],
    readFileSync: mockReadFileSync as Function as PluginsDeps["readFileSync"],
    statSync: mockStatSync as Function as PluginsDeps["statSync"],
    getDataDir: mockGetDataDir,
  };
}

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

  resetPluginsDeps();
}

// ---------------------------------------------------------------------------
// discoverPluginInfo
// ---------------------------------------------------------------------------

describe("discoverPluginInfo", () => {
  beforeEach(resetMocks);

  it("returns empty array when plugins directory does not exist", () => {
    mockExistsSync.mock.mockImplementation(() => false);
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("returns empty array when plugins directory is empty", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/skill-plugins");
    mockReaddirSync.mock.mockImplementation(() => []);
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips non-directory entries in plugins/", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/skill-plugins");
    mockReaddirSync.mock.mockImplementation(() => ["somefile.txt"]);
    mockStatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips directories without a .claude-plugin manifest", () => {
    const calls: string[] = [];
    mockExistsSync.mock.mockImplementation((p: string) => {
      calls.push(p);
      // Only the plugins dir itself exists, not plugin.json or marketplace.json
      return p === "/fake/data/skill-plugins";
    });
    mockReaddirSync.mock.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/my-plugin",
    }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.deepEqual(result, []);
  });

  it("discovers a plugin with plugin.json manifest", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/awesome/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["awesome"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/awesome",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Awesome Plugin" }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Awesome Plugin");
    assert.equal(result[0].path, "/fake/data/skill-plugins/awesome");
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers a plugin with marketplace.json manifest", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/market/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["market"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/market",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Market Plugin" }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Market Plugin");
  });

  it("prefers plugin.json over marketplace.json", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/both/.claude-plugin/plugin.json",
      "/fake/data/skill-plugins/both/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["both"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/both",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Plugin JSON Name" }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    // readFileSync should be called with plugin.json path, not marketplace.json
    const readPath = mockReadFileSync.mock.calls[0].arguments[0];
    assert.ok(readPath.endsWith("plugin.json"));
  });

  it("uses directory name as fallback when manifest has no name", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/fallback-name/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["fallback-name"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/fallback-name",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({}));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "fallback-name");
  });

  it("counts skills from manifest plugins[0].skills", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/skilled/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["skilled"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/skilled",
    }));
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        name: "Skilled Plugin",
        plugins: [{ skills: ["skill-a", "skill-b", "skill-c"] }],
      }),
    );
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].skillCount, 3);
  });

  it("counts skills from skills/ directory when not in manifest", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/dir-skills/.claude-plugin/plugin.json",
      "/fake/data/skill-plugins/dir-skills/skills",
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
      if (p === "/fake/data/skill-plugins/dir-skills") return { isDirectory: () => true };
      if (p.endsWith("skill-one")) return { isDirectory: () => true };
      if (p.endsWith("skill-two")) return { isDirectory: () => true };
      if (p.endsWith("not-a-dir")) return { isDirectory: () => false };
      return { isDirectory: () => false };
    });
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "Dir Skills Plugin" }));
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].skillCount, 2);
  });

  it("uses defaults when manifest JSON is invalid", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/broken/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["broken"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/broken",
    }));
    mockReadFileSync.mock.mockImplementation(() => "{ not valid json }}}");
    setPluginsDeps(makeDeps());

    const result = discoverPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "broken"); // falls back to dir name
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers multiple plugins", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/alpha/.claude-plugin/plugin.json",
      "/fake/data/skill-plugins/beta/.claude-plugin/marketplace.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));

    let _readdirCallCount = 0;
    mockReaddirSync.mock.mockImplementation(() => {
      _readdirCallCount++;
      return ["alpha", "beta"];
    });
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () =>
        p === "/fake/data/skill-plugins/alpha" || p === "/fake/data/skill-plugins/beta",
    }));
    mockReadFileSync.mock.mockImplementation((p: string) => {
      if (p.includes("alpha")) return JSON.stringify({ name: "Alpha" });
      return JSON.stringify({ name: "Beta" });
    });
    setPluginsDeps(makeDeps());

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
    setPluginsDeps(makeDeps());

    const result = discoverPlugins();
    assert.deepEqual(result, []);
  });

  it("returns SDK-compatible plugin configs with type and path", () => {
    const existingPaths = new Set([
      "/fake/data/skill-plugins",
      "/fake/data/skill-plugins/my-plugin/.claude-plugin/plugin.json",
    ]);
    mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mock.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mock.mockImplementation((p: string) => ({
      isDirectory: () => p === "/fake/data/skill-plugins/my-plugin",
    }));
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "My Plugin" }));
    setPluginsDeps(makeDeps());

    const result = discoverPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "local");
    assert.equal(result[0].path, "/fake/data/skill-plugins/my-plugin");
  });
});
