import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { McpDeps } from "./mcp.js";
import {
  loadMcpServers,
  loadMcpServer,
  loadAlwaysOnMcpServers,
  getConfiguredMcpServerNames,
  resetMcpCache,
  resolveEffectiveRegistry,
  DEFAULT_GITHUB_REGISTRY_ENTRY,
  UNMAPPED_REGISTRY_DESCRIPTION,
} from "./mcp.js";
import type { McpServerRegistry } from "./config.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<(path: string) => boolean>();
const mockReadFileSync = mock.fn<(path: string, encoding: string) => string>();
const mockExecSync =
  mock.fn<(cmd: string, opts: { stdio?: string | NodeJS.WriteStream[] }) => Buffer>();
const mockGetInstallationToken = mock.fn<
  () => Promise<{
    token: string;
    permissions: Record<string, string>;
    expiresAt: Date;
  }>
>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the expected MCP config path based on cwd */
function mcpConfigPath(): string {
  return join(process.cwd(), "data", "mcp.json");
}

/** Build the expected GitHub auth path based on cwd */
function githubAuthPath(): string {
  return join(process.cwd(), "data", "auth", "github.json");
}

/**
 * Create a test deps object with the current mocks
 */
function makeDeps(): McpDeps {
  return {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    execSync: mockExecSync,
    getInstallationToken: mockGetInstallationToken,
  };
}

/**
 * Configure existsSync to return true/false based on which paths should exist.
 */
function setExistingPaths(paths: string[]): void {
  mockExistsSync.mock.mockImplementation((p: string) => paths.includes(p));
}

/** A minimal mcp.json with one stdio server */
function stdioMcpJson(): string {
  return JSON.stringify({
    mcpServers: {
      myserver: {
        command: "my-mcp-binary",
        args: ["--flag"],
        env: { KEY: "value" },
      },
    },
  });
}

/** An mcp.json with a remote (SSE) server */
function remoteMcpJson(): string {
  return JSON.stringify({
    mcpServers: {
      remote: {
        type: "sse",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token123" },
      },
    },
  });
}

/** An mcp.json with an HTTP server */
function httpMcpJson(): string {
  return JSON.stringify({
    mcpServers: {
      httpserver: {
        type: "http",
        url: "https://example.com/http-mcp",
      },
    },
  });
}

function resetMocks(): void {
  resetMcpCache();
  mockExistsSync.mock.resetCalls();
  mockReadFileSync.mock.resetCalls();
  mockExecSync.mock.resetCalls();
  mockGetInstallationToken.mock.resetCalls();

  // Defaults: nothing exists, binary not found
  mockExistsSync.mock.mockImplementation(() => false);
  mockReadFileSync.mock.mockImplementation(() => "");
  mockExecSync.mock.mockImplementation(() => {
    throw new Error("not found");
  });
  mockGetInstallationToken.mock.mockImplementation(async () => ({
    token: "ghs_test_token",
    permissions: { contents: "read", pull_requests: "write" },
    expiresAt: new Date(),
  }));
}

// ---------------------------------------------------------------------------
// loadMcpServers — static config loading
// ---------------------------------------------------------------------------

describe("loadMcpServers", () => {
  beforeEach(resetMocks);

  it("returns undefined when mcp.json does not exist and no GitHub credentials", async () => {
    setExistingPaths([]);
    const result = await loadMcpServers(makeDeps());
    assert.equal(result, undefined);
  });

  it("parses a stdio server from mcp.json", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("myserver" in result);
    assert.equal(result.myserver.type, "stdio");
    assert.equal((result.myserver as { command: string }).command, "my-mcp-binary");
    assert.deepEqual((result.myserver as { args: string[] }).args, ["--flag"]);
    assert.deepEqual((result.myserver as { env: Record<string, string> }).env, { KEY: "value" });
  });

  it("parses an SSE server from mcp.json", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => remoteMcpJson());

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("remote" in result);
    assert.equal(result.remote.type, "sse");
    assert.equal((result.remote as { url: string }).url, "https://example.com/mcp");
    assert.deepEqual((result.remote as { headers: Record<string, string> }).headers, {
      Authorization: "Bearer token123",
    });
  });

  it("parses an HTTP server from mcp.json", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => httpMcpJson());

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("httpserver" in result);
    assert.equal(result.httpserver.type, "http");
    assert.equal((result.httpserver as { url: string }).url, "https://example.com/http-mcp");
  });

  it("returns undefined when mcpServers is empty", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ mcpServers: {} }));

    const result = await loadMcpServers(makeDeps());
    assert.equal(result, undefined);
  });

  it("returns undefined when mcpServers key is missing", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({}));

    const result = await loadMcpServers(makeDeps());
    assert.equal(result, undefined);
  });

  it("returns undefined when mcp.json contains invalid JSON", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => "{ not valid json }}}");

    const result = await loadMcpServers(makeDeps());
    assert.equal(result, undefined);
  });

  it("caches static config on subsequent calls", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    const first = await loadMcpServers(makeDeps());
    const second = await loadMcpServers(makeDeps());

    assert.deepEqual(first, second);
    // readFileSync should only be called once thanks to caching
    assert.equal(mockReadFileSync.mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// getConfiguredMcpServerNames
// ---------------------------------------------------------------------------

describe("getConfiguredMcpServerNames", () => {
  beforeEach(resetMocks);

  it("returns empty array when no config exists and no GitHub credentials", () => {
    setExistingPaths([]);
    const names = getConfiguredMcpServerNames(makeDeps());
    assert.deepEqual(names, []);
  });

  it("returns server names from static config", () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          server_a: { command: "a" },
          server_b: { command: "b" },
        },
      }),
    );

    const names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(names.includes("server_a"));
    assert.ok(names.includes("server_b"));
  });

  it("includes 'github' when auto-config conditions are met", () => {
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(names.includes("github"));
  });

  it("does not include 'github' when binary is unavailable", () => {
    setExistingPaths([githubAuthPath()]);
    // execSync throws by default — binary not found

    const names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(!names.includes("github"));
  });

  it("does not include 'github' when credentials do not exist", () => {
    setExistingPaths([]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(!names.includes("github"));
  });

  it("does not duplicate 'github' when already in static config", () => {
    const configWithGithub = JSON.stringify({
      mcpServers: {
        github: { command: "custom-github" },
      },
    });
    setExistingPaths([mcpConfigPath(), githubAuthPath()]);
    mockReadFileSync.mock.mockImplementation(() => configWithGithub);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const names = getConfiguredMcpServerNames(makeDeps());
    const githubCount = names.filter((n) => n === "github").length;
    assert.equal(githubCount, 1);
  });
});

// ---------------------------------------------------------------------------
// substituteEnvVars (tested indirectly through loadMcpServers)
// ---------------------------------------------------------------------------

describe("environment variable substitution", () => {
  beforeEach(resetMocks);

  it("substitutes ${VAR} in stdio env values", async () => {
    const originalEnv = process.env.TEST_MCP_SECRET;
    process.env.TEST_MCP_SECRET = "supersecret";

    try {
      setExistingPaths([mcpConfigPath()]);
      mockReadFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          mcpServers: {
            myserver: {
              command: "server",
              env: { API_KEY: "${TEST_MCP_SECRET}" },
            },
          },
        }),
      );

      const result = await loadMcpServers(makeDeps());
      assert.ok(result);
      const env = (result.myserver as { env: Record<string, string> }).env;
      assert.equal(env.API_KEY, "supersecret");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.TEST_MCP_SECRET;
      } else {
        process.env.TEST_MCP_SECRET = originalEnv;
      }
    }
  });

  it("substitutes ${VAR} in remote server headers", async () => {
    const originalEnv = process.env.TEST_MCP_TOKEN;
    process.env.TEST_MCP_TOKEN = "bearerXYZ";

    try {
      setExistingPaths([mcpConfigPath()]);
      mockReadFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          mcpServers: {
            remote: {
              type: "sse",
              url: "https://example.com",
              headers: { Authorization: "Bearer ${TEST_MCP_TOKEN}" },
            },
          },
        }),
      );

      const result = await loadMcpServers(makeDeps());
      assert.ok(result);
      const headers = (result.remote as { headers: Record<string, string> }).headers;
      assert.equal(headers.Authorization, "Bearer bearerXYZ");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.TEST_MCP_TOKEN;
      } else {
        process.env.TEST_MCP_TOKEN = originalEnv;
      }
    }
  });

  it("replaces unset env vars with empty string", async () => {
    // Ensure the var is unset
    const originalEnv = process.env.DEFINITELY_UNSET_VAR_12345;
    delete process.env.DEFINITELY_UNSET_VAR_12345;

    try {
      setExistingPaths([mcpConfigPath()]);
      mockReadFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          mcpServers: {
            myserver: {
              command: "server",
              env: { KEY: "prefix-${DEFINITELY_UNSET_VAR_12345}-suffix" },
            },
          },
        }),
      );

      const result = await loadMcpServers(makeDeps());
      assert.ok(result);
      const env = (result.myserver as { env: Record<string, string> }).env;
      assert.equal(env.KEY, "prefix--suffix");
    } finally {
      if (originalEnv !== undefined) {
        process.env.DEFINITELY_UNSET_VAR_12345 = originalEnv;
      }
    }
  });

  it("handles multiple substitutions in one value", async () => {
    const origA = process.env.MCP_TEST_A;
    const origB = process.env.MCP_TEST_B;
    process.env.MCP_TEST_A = "hello";
    process.env.MCP_TEST_B = "world";

    try {
      setExistingPaths([mcpConfigPath()]);
      mockReadFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          mcpServers: {
            myserver: {
              command: "server",
              env: { GREETING: "${MCP_TEST_A} ${MCP_TEST_B}" },
            },
          },
        }),
      );

      const result = await loadMcpServers(makeDeps());
      assert.ok(result);
      const env = (result.myserver as { env: Record<string, string> }).env;
      assert.equal(env.GREETING, "hello world");
    } finally {
      if (origA === undefined) delete process.env.MCP_TEST_A;
      else process.env.MCP_TEST_A = origA;
      if (origB === undefined) delete process.env.MCP_TEST_B;
      else process.env.MCP_TEST_B = origB;
    }
  });

  it("passes through values without ${} unchanged", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          myserver: {
            command: "server",
            env: { PLAIN: "no-vars-here" },
          },
        },
      }),
    );

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    const env = (result.myserver as { env: Record<string, string> }).env;
    assert.equal(env.PLAIN, "no-vars-here");
  });
});

// ---------------------------------------------------------------------------
// resetMcpCache
// ---------------------------------------------------------------------------

describe("resetMcpCache", () => {
  beforeEach(resetMocks);

  it("forces static config to be re-read after reset", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    // First load caches the result
    await loadMcpServers(makeDeps());
    assert.equal(mockReadFileSync.mock.callCount(), 1);

    // Reset and change the config
    resetMcpCache();
    mockReadFileSync.mock.mockImplementation(() => remoteMcpJson());

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("remote" in result);
    assert.ok(!("myserver" in result));
    assert.equal(mockReadFileSync.mock.callCount(), 2);
  });

  it("forces binary availability to be re-checked after reset", () => {
    setExistingPaths([githubAuthPath()]);
    // Binary not found initially
    mockExecSync.mock.mockImplementation(() => {
      throw new Error("not found");
    });

    let names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(!names.includes("github"));

    // Reset and make binary available
    resetMcpCache();
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(names.includes("github"));
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveRegistry
// ---------------------------------------------------------------------------

describe("resolveEffectiveRegistry", () => {
  it("passes through a fully-mapped registry with no unmapped warnings", () => {
    const configRegistry: McpServerRegistry = {
      metabase: { alwaysLoad: false, description: "metabase queries" },
      monday: { alwaysLoad: false, description: "monday boards" },
    };

    const result = resolveEffectiveRegistry({
      configRegistry,
      mcpServerNames: ["metabase", "monday"],
      githubAutoInjected: false,
    });

    assert.deepEqual(result.registry, configRegistry);
    assert.deepEqual(result.unmapped, []);
  });

  it("adds a synthetic always-load entry for each mcp.json server missing from the registry", () => {
    const result = resolveEffectiveRegistry({
      configRegistry: {
        metabase: { alwaysLoad: false, description: "metabase" },
      },
      mcpServerNames: ["metabase", "sentry", "monday"],
      githubAutoInjected: false,
    });

    assert.deepEqual(result.unmapped.sort(), ["monday", "sentry"]);
    assert.equal(result.registry.sentry.alwaysLoad, true);
    assert.equal(result.registry.sentry.description, UNMAPPED_REGISTRY_DESCRIPTION);
    assert.equal(result.registry.monday.alwaysLoad, true);
    assert.equal(result.registry.monday.description, UNMAPPED_REGISTRY_DESCRIPTION);
    // metabase kept its explicit entry
    assert.equal(result.registry.metabase.alwaysLoad, false);
    assert.equal(result.registry.metabase.description, "metabase");
  });

  it("injects a default github entry when auto-injection is active and no override exists", () => {
    const result = resolveEffectiveRegistry({
      configRegistry: {},
      mcpServerNames: [],
      githubAutoInjected: true,
    });

    assert.deepEqual(result.registry.github, DEFAULT_GITHUB_REGISTRY_ENTRY);
    // auto-injected github is NOT reported as unmapped (it's a first-class path).
    assert.deepEqual(result.unmapped, []);
  });

  it("does not override an explicit github registry entry when auto-injecting", () => {
    const explicit = { alwaysLoad: false, description: "Custom github usage" };
    const result = resolveEffectiveRegistry({
      configRegistry: { github: explicit },
      mcpServerNames: [],
      githubAutoInjected: true,
    });

    assert.deepEqual(result.registry.github, explicit);
  });

  it("does not insert a github entry when auto-inject is inactive", () => {
    const result = resolveEffectiveRegistry({
      configRegistry: {},
      mcpServerNames: [],
      githubAutoInjected: false,
    });

    assert.ok(!("github" in result.registry));
  });

  it("accepts an undefined configRegistry", () => {
    const result = resolveEffectiveRegistry({
      mcpServerNames: ["sentry"],
      githubAutoInjected: true,
    });

    assert.deepEqual(result.unmapped, ["sentry"]);
    assert.equal(result.registry.sentry.description, UNMAPPED_REGISTRY_DESCRIPTION);
    assert.deepEqual(result.registry.github, DEFAULT_GITHUB_REGISTRY_ENTRY);
  });

  it("preserves instructions-only entries (in registry but not in mcp.json)", () => {
    // A registry entry for a "scheduling" topic that has no matching mcp.json server —
    // valid per the design (instructions-only integrations).
    const result = resolveEffectiveRegistry({
      configRegistry: {
        scheduling: { alwaysLoad: false, description: "Scheduled messages" },
      },
      mcpServerNames: [],
      githubAutoInjected: false,
    });

    assert.deepEqual(result.registry.scheduling, {
      alwaysLoad: false,
      description: "Scheduled messages",
    });
    assert.deepEqual(result.unmapped, []);
  });

  it("merges plugin-declared integrations into the registry", () => {
    const result = resolveEffectiveRegistry({
      configRegistry: {},
      mcpServerNames: [],
      githubAutoInjected: false,
      pluginIntegrations: [
        {
          name: "trivia:management",
          description: "Trivia management",
          alwaysLoad: false,
          pluginName: "trivia",
        },
      ],
    });

    assert.deepEqual(result.registry["trivia:management"], {
      alwaysLoad: false,
      description: "Trivia management",
    });
  });

  it("logs a warning and lets last-write-win when plugin integration name collides with config entry", () => {
    const warn = mock.method(logger, "warn", () => {});
    try {
      const result = resolveEffectiveRegistry({
        configRegistry: {
          "shared:foo": { alwaysLoad: true, description: "config" },
        },
        mcpServerNames: [],
        githubAutoInjected: false,
        pluginIntegrations: [
          {
            name: "shared:foo",
            description: "from-plugin",
            alwaysLoad: false,
            pluginName: "myplugin",
          },
        ],
      });

      assert.equal(result.registry["shared:foo"].description, "from-plugin");
      const warned = warn.mock.calls.find((call) => {
        const m = String(call.arguments[0] ?? "");
        return m.includes("shared:foo") && m.includes("myplugin");
      });
      assert.ok(warned, "expected a warning naming the colliding integration and plugin");
    } finally {
      warn.mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// loadMcpServer — fetch a single server by name
// ---------------------------------------------------------------------------

describe("loadMcpServer", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns a server from mcp.json by name", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    const cfg = await loadMcpServer("myserver", makeDeps());
    assert.ok(cfg);
    assert.equal(cfg.type, "stdio");
  });

  it("returns undefined for a name that's not in mcp.json", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    const cfg = await loadMcpServer("does-not-exist", makeDeps());
    assert.equal(cfg, undefined);
  });

  it("returns undefined when mcp.json is absent and name is not github", async () => {
    setExistingPaths([]);
    const cfg = await loadMcpServer("sentry", makeDeps());
    assert.equal(cfg, undefined);
  });

  it("builds a fresh github entry via token refresh when github is auto-injected", async () => {
    // github not in mcp.json, but credentials + binary available
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const cfg = await loadMcpServer("github", makeDeps());

    assert.ok(cfg);
    assert.equal(cfg.type, "stdio");
    // Token fetch was called — this is the proof of a fresh token.
    assert.equal(mockGetInstallationToken.mock.callCount(), 1);
  });

  it("returns a manual github entry from mcp.json without minting a token", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          github: { command: "custom-github-mcp", args: ["--stdio"], env: {} },
        },
      }),
    );

    const cfg = await loadMcpServer("github", makeDeps());

    assert.ok(cfg);
    assert.equal(mockGetInstallationToken.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// loadAlwaysOnMcpServers — filter down to alwaysLoad=true entries
// ---------------------------------------------------------------------------

describe("loadAlwaysOnMcpServers", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns only servers tagged alwaysLoad: true", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          metabase: { command: "mb", args: [] },
          monday: { command: "md", args: [] },
        },
      }),
    );

    const registry: McpServerRegistry = {
      metabase: { alwaysLoad: true, description: "x" },
      monday: { alwaysLoad: false, description: "y" },
    };

    const result = await loadAlwaysOnMcpServers(registry, makeDeps());
    assert.ok(result);
    assert.deepEqual(Object.keys(result).sort(), ["metabase"]);
  });

  it("includes auto-injected github when its registry entry is alwaysLoad: true", async () => {
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const registry: McpServerRegistry = {
      github: { alwaysLoad: true, description: "GitHub MCP" },
    };

    const result = await loadAlwaysOnMcpServers(registry, makeDeps());
    assert.ok(result);
    assert.ok("github" in result);
  });

  it("returns undefined when no server qualifies", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          metabase: { command: "mb", args: [] },
        },
      }),
    );

    const registry: McpServerRegistry = {
      metabase: { alwaysLoad: false, description: "metabase" },
    };

    const result = await loadAlwaysOnMcpServers(registry, makeDeps());
    assert.equal(result, undefined);
  });

  it("excludes servers in the MCP set that have no registry entry", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          metabase: { command: "mb", args: [] },
          untagged: { command: "other", args: [] },
        },
      }),
    );

    const registry: McpServerRegistry = {
      metabase: { alwaysLoad: true, description: "x" },
      // no entry for "untagged"
    };

    const result = await loadAlwaysOnMcpServers(registry, makeDeps());
    assert.ok(result);
    assert.deepEqual(Object.keys(result).sort(), ["metabase"]);
    // `untagged` is filtered out; the caller is expected to have run
    // `resolveEffectiveRegistry` first which would synthesize an always-load entry.
  });
});
