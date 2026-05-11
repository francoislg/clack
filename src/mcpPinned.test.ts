import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { McpDeps } from "./mcp.js";
import {
  loadMcpServer,
  loadMcpServers,
  getConfiguredMcpServerNames,
  getPinnedEntries,
  setPinnedSpawnConfig,
  resetMcpCache,
} from "./mcp.js";

// ---------------------------------------------------------------------------
// Mock setup (mirrors mcp.test.ts's pattern)
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

function mcpConfigPath(): string {
  return join(process.cwd(), "data", "mcp.json");
}

function makeDeps(): McpDeps {
  return {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    execSync: mockExecSync,
    getInstallationToken: mockGetInstallationToken,
  };
}

function setExistingPaths(paths: string[]): void {
  mockExistsSync.mock.mockImplementation((p: string) => paths.includes(p));
}

function resetMocks(): void {
  resetMcpCache();
  mockExistsSync.mock.resetCalls();
  mockReadFileSync.mock.resetCalls();
  mockExecSync.mock.resetCalls();
  mockGetInstallationToken.mock.resetCalls();
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

describe("Pinned MCP schema", () => {
  beforeEach(resetMocks);

  function pinnedMcpJson(): string {
    return JSON.stringify({
      mcpServers: {
        asana: {
          package: "@roychri/mcp-server-asana",
          version: "1.8.0",
          env: { ASANA_ACCESS_TOKEN: "fake" },
        },
      },
    });
  }

  it("accepts an entry with both package and version, omits it from staticServers until install resolves", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => pinnedMcpJson());

    const result = await loadMcpServers(makeDeps());
    // Pinned entries are not in cachedStaticServers until ensurePinnedInstalls populates them,
    // so the returned map (without GitHub auto-inject) has no `asana` key.
    assert.ok(result);
    assert.equal("asana" in result, false);

    const pinned = getPinnedEntries(makeDeps());
    assert.deepEqual(pinned, {
      asana: {
        package: "@roychri/mcp-server-asana",
        version: "1.8.0",
        env: { ASANA_ACCESS_TOKEN: "fake" },
      },
    });
  });

  it("captures args on a pinned entry so they reach the spawn config", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          mongo: {
            package: "mongodb-mcp-server",
            version: "1.10.0",
            args: ["--readOnly"],
            env: { MDB_MCP_CONNECTION_STRING: "mongodb://x" },
          },
        },
      }),
    );

    await loadMcpServers(makeDeps());
    const pinned = getPinnedEntries(makeDeps());
    assert.deepEqual(pinned.mongo.args, ["--readOnly"]);
  });

  it("throws when package is set but version is missing", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: { asana: { package: "@roychri/mcp-server-asana", env: {} } },
      }),
    );

    await assert.rejects(() => loadMcpServers(makeDeps()), /asana.*package.*version.*missing/);
  });

  it("throws when version is set but package is missing", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: { asana: { version: "1.8.0", env: {} } },
      }),
    );

    await assert.rejects(() => loadMcpServers(makeDeps()), /asana.*version.*package.*missing/);
  });

  it("throws when neither package nor command is set on a stdio entry", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: { broken: { args: ["--flag"] } },
      }),
    );

    await assert.rejects(
      () => loadMcpServers(makeDeps()),
      /broken.*must declare either 'command' or 'package'\+'version'/,
    );
  });

  it("getConfiguredMcpServerNames includes pinned entries even before install", () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => pinnedMcpJson());

    const names = getConfiguredMcpServerNames(makeDeps());
    assert.ok(names.includes("asana"), "asana should be in configured names");
  });

  it("substitutes environment variables in a pinned entry's env block", () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          asana: {
            package: "@roychri/mcp-server-asana",
            version: "1.8.0",
            env: { ASANA_ACCESS_TOKEN: "${MCP_TEST_TOKEN}" },
          },
        },
      }),
    );

    const previous = process.env.MCP_TEST_TOKEN;
    process.env.MCP_TEST_TOKEN = "secret-value";
    try {
      const pinned = getPinnedEntries(makeDeps());
      assert.equal(pinned.asana.env?.ASANA_ACCESS_TOKEN, "secret-value");
    } finally {
      if (previous === undefined) {
        delete process.env.MCP_TEST_TOKEN;
      } else {
        process.env.MCP_TEST_TOKEN = previous;
      }
    }
  });

  it("setPinnedSpawnConfig populates the cache so loadMcpServer returns the resolved config", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => pinnedMcpJson());
    await loadMcpServers(makeDeps());

    setPinnedSpawnConfig("asana", {
      type: "stdio",
      command: "node",
      args: ["/abs/path/to/bin.js"],
      env: { ASANA_ACCESS_TOKEN: "fake" },
    });

    const entry = await loadMcpServer("asana", makeDeps());
    assert.ok(entry);
    assert.equal((entry as { command: string }).command, "node");
    assert.deepEqual((entry as { args: string[] }).args, ["/abs/path/to/bin.js"]);
  });
});

describe("Legacy npx migration warning", () => {
  beforeEach(resetMocks);

  it("does not throw for legacy npx entries (warning is best-effort, side-effect only)", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: {
          metabase: {
            command: "npx",
            args: ["-y", "@jerichosequitin/metabase-mcp"],
            env: {},
          },
        },
      }),
    );

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("metabase" in result);
    assert.equal((result.metabase as { command: string }).command, "npx");
  });

  it("non-npx legacy command passes through silently", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        mcpServers: { local: { command: "/usr/local/bin/foo-mcp", args: [] } },
      }),
    );

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.equal((result.local as { command: string }).command, "/usr/local/bin/foo-mcp");
  });
});
