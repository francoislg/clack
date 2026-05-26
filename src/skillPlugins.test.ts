import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import {
  discoverSkillPluginInfo,
  discoverSkillPlugins,
  discoverEagerSkillPlugins,
  setSkillPluginsDeps,
  resetSkillPluginsDeps,
  type SkillPluginsDeps,
} from "./skillPlugins.js";

// Production code does `resolve(getDataDir(), "skill-plugins")` then `join(...)`. On Windows
// these become backslash-and-drive-prefixed paths, so we compute the expected base once and
// build all expected paths from it to stay platform-independent.
const FAKE_DATA_DIR = "/fake/data";
const PLUGINS_DIR = resolve(FAKE_DATA_DIR, "skill-plugins");
const P = (...parts: string[]) => join(PLUGINS_DIR, ...parts);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = vi.fn<SkillPluginsDeps["existsSync"]>();
const mockReaddirSync = vi.fn<SkillPluginsDeps["readdirSync"]>();
const mockReadFileSync = vi.fn<SkillPluginsDeps["readFileSync"]>();
const mockStatSync = vi.fn<SkillPluginsDeps["statSync"]>();
const mockGetDataDir = vi.fn<SkillPluginsDeps["getDataDir"]>();
const mockGetConfig = vi.fn<SkillPluginsDeps["getConfig"]>();

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
  mockExistsSync.mockClear();
  mockReaddirSync.mockClear();
  mockReadFileSync.mockClear();
  mockStatSync.mockClear();
  mockGetDataDir.mockClear();
  mockGetConfig.mockClear();

  mockGetDataDir.mockImplementation(() => "/fake/data");
  mockExistsSync.mockImplementation(() => false);
  mockReaddirSync.mockImplementation(() => []);
  mockReadFileSync.mockImplementation(() => "{}");
  mockStatSync.mockImplementation(() => ({ isDirectory: () => false }));
  // Default: config throws (simulates "config not loaded") — discover* treats as no registry.
  mockGetConfig.mockImplementation(() => {
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
    mockExistsSync.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("returns empty array when plugins directory is empty", () => {
    mockExistsSync.mockImplementation((p: string) => p === PLUGINS_DIR);
    mockReaddirSync.mockImplementation(() => []);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips non-directory entries in plugins/", () => {
    mockExistsSync.mockImplementation((p: string) => p === PLUGINS_DIR);
    mockReaddirSync.mockImplementation(() => ["somefile.txt"]);
    mockStatSync.mockImplementation(() => ({ isDirectory: () => false }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("skips directories without a .claude-plugin manifest", () => {
    const calls: string[] = [];
    mockExistsSync.mockImplementation((p: string) => {
      calls.push(p);
      // Only the plugins dir itself exists, not plugin.json or marketplace.json
      return p === PLUGINS_DIR;
    });
    mockReaddirSync.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("my-plugin"),
    }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.deepEqual(result, []);
  });

  it("discovers a plugin with plugin.json manifest", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("awesome/.claude-plugin/plugin.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["awesome"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("awesome"),
    }));
    mockReadFileSync.mockImplementation(() => JSON.stringify({ name: "Awesome Plugin" }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Awesome Plugin");
    assert.equal(result[0].path, P("awesome"));
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers a plugin with marketplace.json manifest", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("market/.claude-plugin/marketplace.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["market"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("market"),
    }));
    mockReadFileSync.mockImplementation(() => JSON.stringify({ name: "Market Plugin" }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Market Plugin");
  });

  it("prefers plugin.json over marketplace.json", () => {
    const existingPaths = new Set([
      PLUGINS_DIR,
      P("both/.claude-plugin/plugin.json"),
      P("both/.claude-plugin/marketplace.json"),
    ]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["both"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("both"),
    }));
    mockReadFileSync.mockImplementation(() => JSON.stringify({ name: "Plugin JSON Name" }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    // readFileSync should be called with plugin.json path, not marketplace.json
    const readPath = mockReadFileSync.mock.calls[0][0];
    assert.ok(readPath.endsWith("plugin.json"));
  });

  it("uses directory name as fallback when manifest has no name", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("fallback-name/.claude-plugin/plugin.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["fallback-name"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("fallback-name"),
    }));
    mockReadFileSync.mockImplementation(() => JSON.stringify({}));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "fallback-name");
  });

  it("counts skills from manifest plugins[0].skills", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("skilled/.claude-plugin/plugin.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["skilled"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("skilled"),
    }));
    mockReadFileSync.mockImplementation(() =>
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
      PLUGINS_DIR,
      P("dir-skills/.claude-plugin/plugin.json"),
      P("dir-skills/skills"),
    ]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));

    let readdirCallCount = 0;
    mockReaddirSync.mockImplementation(() => {
      readdirCallCount++;
      if (readdirCallCount === 1) return ["dir-skills"]; // plugins dir listing
      return ["skill-one", "skill-two", "not-a-dir"]; // skills dir listing
    });

    let _statCallCount = 0;
    mockStatSync.mockImplementation((p: string) => {
      _statCallCount++;
      // The plugin entry itself and skill subdirs
      if (p === P("dir-skills")) return { isDirectory: () => true };
      if (p.endsWith("skill-one")) return { isDirectory: () => true };
      if (p.endsWith("skill-two")) return { isDirectory: () => true };
      if (p.endsWith("not-a-dir")) return { isDirectory: () => false };
      return { isDirectory: () => false };
    });
    mockReadFileSync.mockImplementation(() => JSON.stringify({ name: "Dir Skills Plugin" }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].skillCount, 2);
  });

  it("uses defaults when manifest JSON is invalid", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("broken/.claude-plugin/plugin.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["broken"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("broken"),
    }));
    mockReadFileSync.mockImplementation(() => "{ not valid json }}}");
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "broken"); // falls back to dir name
    assert.equal(result[0].skillCount, 0);
  });

  it("discovers multiple plugins", () => {
    const existingPaths = new Set([
      PLUGINS_DIR,
      P("alpha/.claude-plugin/plugin.json"),
      P("beta/.claude-plugin/marketplace.json"),
    ]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));

    let _readdirCallCount = 0;
    mockReaddirSync.mockImplementation(() => {
      _readdirCallCount++;
      return ["alpha", "beta"];
    });
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("alpha") || p === P("beta"),
    }));
    mockReadFileSync.mockImplementation((p: string) => {
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
    mockExistsSync.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPlugins();
    assert.deepEqual(result, []);
  });

  it("returns SDK-compatible plugin configs with type and path", () => {
    const existingPaths = new Set([PLUGINS_DIR, P("my-plugin/.claude-plugin/plugin.json")]);
    mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
    mockReaddirSync.mockImplementation(() => ["my-plugin"]);
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p === P("my-plugin"),
    }));
    mockReadFileSync.mockImplementation(() => JSON.stringify({ name: "My Plugin" }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "local");
    assert.equal(result[0].path, P("my-plugin"));
  });
});

// ---------------------------------------------------------------------------
// lazyLoad field + discoverEagerSkillPlugins
// ---------------------------------------------------------------------------

function setupTwoPlugins() {
  const existingPaths = new Set([
    PLUGINS_DIR,
    P("marketingskills/.claude-plugin/plugin.json"),
    P("devtools/.claude-plugin/plugin.json"),
  ]);
  mockExistsSync.mockImplementation((p: string) => existingPaths.has(p));
  mockReaddirSync.mockImplementation(() => ["marketingskills", "devtools"]);
  mockStatSync.mockImplementation((p: string) => ({
    isDirectory: () => p === P("marketingskills") || p === P("devtools"),
  }));
  mockReadFileSync.mockImplementation((p: string) => {
    if (p.includes("marketingskills")) return JSON.stringify({ name: "marketingskills" });
    return JSON.stringify({ name: "devtools" });
  });
}

describe("discoverSkillPluginInfo — lazyLoad field", () => {
  beforeEach(resetMocks);

  it("defaults lazyLoad to false when config.skillPlugins is absent", () => {
    setupTwoPlugins();
    mockGetConfig.mockImplementation(() => ({ skillPlugins: undefined }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverSkillPluginInfo();
    assert.equal(result.length, 2);
    assert.equal(result[0].lazyLoad, false);
    assert.equal(result[1].lazyLoad, false);
  });

  it("sets lazyLoad: true for plugins tagged in the registry", () => {
    setupTwoPlugins();
    mockGetConfig.mockImplementation(() => ({
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
    mockGetConfig.mockImplementation(() => {
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
    mockExistsSync.mockImplementation(() => false);
    setSkillPluginsDeps(makeDeps());

    assert.deepEqual(discoverEagerSkillPlugins(), []);
  });

  it("excludes lazy-tagged plugins from the SDK plugin set", () => {
    setupTwoPlugins();
    mockGetConfig.mockImplementation(() => ({
      skillPlugins: {
        marketingskills: { lazyLoad: true, description: "Marketing pack" },
      },
    }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 1);
    assert.equal(result[0].path, P("devtools"));
  });

  it("includes all plugins when config has no lazy tags", () => {
    setupTwoPlugins();
    mockGetConfig.mockImplementation(() => ({ skillPlugins: undefined }));
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 2);
  });

  it("falls back to eager (all plugins) when config is unavailable", () => {
    setupTwoPlugins();
    mockGetConfig.mockImplementation(() => {
      throw new Error("Config not loaded");
    });
    setSkillPluginsDeps(makeDeps());

    const result = discoverEagerSkillPlugins();
    assert.equal(result.length, 2);
  });
});
