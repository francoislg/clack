import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  discoverSkillPluginInfo,
  discoverSkillPlugins,
  discoverEagerSkillPlugins,
  setSkillPluginsDeps,
  resetSkillPluginsDeps,
  type SkillPluginsDeps,
} from "./skillPlugins.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<SkillPluginsDeps["existsSync"]>();
const mockReaddirSync = mock.fn<SkillPluginsDeps["readdirSync"]>();
const mockReadFileSync = mock.fn<SkillPluginsDeps["readFileSync"]>();
const mockStatSync = mock.fn<SkillPluginsDeps["statSync"]>();
const mockGetDataDir = mock.fn<SkillPluginsDeps["getDataDir"]>();
const mockGetConfig = mock.fn<SkillPluginsDeps["getConfig"]>();

function makeDeps(): SkillPluginsDeps {
  return {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    statSync: mockStatSync,
    getDataDir: mockGetDataDir,
    getConfig: mockGetConfig,
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
  mockGetConfig.mock.resetCalls();

  mockGetDataDir.mock.mockImplementation(() => "/fake/data");
  mockExistsSync.mock.mockImplementation(() => false);
  mockReaddirSync.mock.mockImplementation(() => []);
  mockReadFileSync.mock.mockImplementation(() => "{}");
  mockStatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));
  // Default: config throws (simulates "config not loaded") — discover* treats as no registry.
  mockGetConfig.mock.mockImplementation(() => {
    throw new Error("Config not loaded");
  });

  resetSkillPluginsDeps();
}

// ---------------------------------------------------------------------------
// discoverSkillPluginInfo
// ---------------------------------------------------------------------------

describe("discoverSkillPluginInfo", () => {
  beforeEach(resetMocks);

  it("returns empty array when plugins directory does not exist", () => {
    mockExistsSync.mock.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("returns empty array when plugins directory is empty", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/skill-plugins");
    mockReaddirSync.mock.mockImplementation(() => []);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips non-directory entries in plugins/", () => {
    mockExistsSync.mock.mockImplementation((p: string) => p === "/fake/data/skill-plugins");
    mockReaddirSync.mock.mockImplementation(() => ["somefile.txt"]);
    mockStatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "Alpha");
    assert.equal(result[1].name, "Beta");
  });
});

// ---------------------------------------------------------------------------
// discoverSkillPlugins
// ---------------------------------------------------------------------------

describe("discoverSkillPlugins", () => {
  beforeEach(resetMocks);

  it("returns empty array when no plugins found", () => {
    mockExistsSync.mock.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPlugins();
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
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "local");
    assert.equal(result[0].path, "/fake/data/skill-plugins/my-plugin");
  });
});

// ---------------------------------------------------------------------------
// lazyLoad field + discoverEagerSkillPlugins
// ---------------------------------------------------------------------------

function setupTwoPlugins() {
  const existingPaths = new Set([
    "/fake/data/skill-plugins",
    "/fake/data/skill-plugins/marketingskills/.claude-plugin/plugin.json",
    "/fake/data/skill-plugins/devtools/.claude-plugin/plugin.json",
  ]);
  mockExistsSync.mock.mockImplementation((p: string) => existingPaths.has(p));
  mockReaddirSync.mock.mockImplementation(() => ["marketingskills", "devtools"]);
  mockStatSync.mock.mockImplementation((p: string) => ({
    isDirectory: () =>
      p === "/fake/data/skill-plugins/marketingskills" || p === "/fake/data/skill-plugins/devtools",
  }));
  mockReadFileSync.mock.mockImplementation((p: string) => {
    if (p.includes("marketingskills")) return JSON.stringify({ name: "marketingskills" });
    return JSON.stringify({ name: "devtools" });
  });
}

describe("discoverSkillPluginInfo — lazyLoad field", () => {
  beforeEach(resetMocks);

  it("defaults lazyLoad to false when config.skillPlugins is absent", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => ({ skillPlugins: undefined }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 2);
    assert.equal(result[0].lazyLoad, false);
    assert.equal(result[1].lazyLoad, false);
  });

  it("sets lazyLoad: true for plugins tagged in the registry", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => ({
      skillPlugins: {
        marketingskills: { lazyLoad: true, description: "Marketing pack" },
      },
    }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    const mk = result.find((p) => p.name === "marketingskills");
    const dt = result.find((p) => p.name === "devtools");
    assert.ok(mk);
    assert.ok(dt);
    assert.equal(mk.lazyLoad, true);
    assert.equal(dt.lazyLoad, false);
  });

  it("falls back to lazyLoad: false when getConfig throws", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => {
      throw new Error("Config not loaded");
    });
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 2);
    for (const p of result) assert.equal(p.lazyLoad, false);
  });
});

describe("discoverEagerSkillPlugins", () => {
  beforeEach(resetMocks);

  it("returns empty array when no plugins found", () => {
    mockExistsSync.mock.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    assert.deepEqual(discoverEagerSkillPlugins(), []);
  });

  it("excludes lazy-tagged plugins from the SDK plugin set", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => ({
      skillPlugins: {
        marketingskills: { lazyLoad: true, description: "Marketing pack" },
      },
    }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "/fake/data/skill-plugins/devtools");
  });

  it("includes all plugins when config has no lazy tags", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => ({ skillPlugins: undefined }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 2);
  });

  it("falls back to eager (all plugins) when config is unavailable", () => {
    setupTwoPlugins();
    mockGetConfig.mock.mockImplementation(() => {
      throw new Error("Config not loaded");
    });
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 2);
  });
});
