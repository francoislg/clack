import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  ensureInstalled,
  installAllPinnedMcpServers,
  resolveBinPath,
  unscopedName,
  type McpInstallerDeps,
  type InstallAllDeps,
} from "./mcpInstaller.js";
import type { PinnedEntry } from "./mcp.js";

const mockExistsSync = mock.fn<(path: string) => boolean>();
const mockReadFileSync = mock.fn<(path: string, encoding: BufferEncoding) => string>();
const mockRmSync =
  mock.fn<(path: string, options: { recursive: boolean; force: boolean }) => void>();
const mockExecFileSync =
  mock.fn<
    (
      file: string,
      args: string[],
      opts: { stdio?: "pipe" | "ignore" | "inherit"; cwd?: string },
    ) => Buffer
  >();

function makeDeps(): McpInstallerDeps {
  return {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    rmSync: mockRmSync,
    execFileSync: mockExecFileSync,
  };
}

function dir(name: string): string {
  return join(process.cwd(), "data", "mcp_packages", name);
}

function pkgJsonPath(name: string, pkg: string): string {
  return join(dir(name), "node_modules", pkg, "package.json");
}

function resetMocks(): void {
  mockExistsSync.mock.resetCalls();
  mockReadFileSync.mock.resetCalls();
  mockRmSync.mock.resetCalls();
  mockExecFileSync.mock.resetCalls();
  mockExistsSync.mock.mockImplementation(() => false);
  mockReadFileSync.mock.mockImplementation(() => "");
  mockRmSync.mock.mockImplementation(() => undefined);
  mockExecFileSync.mock.mockImplementation(() => Buffer.from(""));
}

describe("unscopedName", () => {
  it("strips @scope/ prefix from scoped packages", () => {
    assert.equal(unscopedName("@roychri/mcp-server-asana"), "mcp-server-asana");
    assert.equal(unscopedName("@sentry/mcp-server"), "mcp-server");
  });

  it("returns unscoped names unchanged", () => {
    assert.equal(unscopedName("asana"), "asana");
  });

  it("handles malformed scoped names without slash", () => {
    assert.equal(unscopedName("@noslash"), "@noslash");
  });
});

describe("resolveBinPath", () => {
  beforeEach(resetMocks);

  it("uses string bin field directly", () => {
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ name: "@roychri/mcp-server-asana", bin: "dist/index.js" }),
    );

    const result = resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps());
    assert.equal(
      result,
      resolve(join(dir("asana"), "node_modules", "@roychri/mcp-server-asana", "dist/index.js")),
    );
  });

  it("matches the unscoped name when bin is an object with a matching key (scoped pkg)", () => {
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        bin: {
          "mcp-server-asana": "dist/index.js",
          "asana-cli": "dist/cli.js",
        },
      }),
    );

    const result = resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps());
    assert.equal(
      result,
      resolve(join(dir("asana"), "node_modules", "@roychri/mcp-server-asana", "dist/index.js")),
    );
  });

  it("falls back to the first entry when bin object has no matching key", () => {
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ bin: { alpha: "dist/a.js", beta: "dist/b.js" } }),
    );

    const result = resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps());
    assert.equal(
      result,
      resolve(join(dir("asana"), "node_modules", "@roychri/mcp-server-asana", "dist/a.js")),
    );
  });

  it("throws when bin field is missing", () => {
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ name: "x" }));
    assert.throws(
      () => resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps()),
      /no 'bin' field/,
    );
  });

  it("throws when bin object is empty", () => {
    mockReadFileSync.mock.mockImplementation(() => JSON.stringify({ bin: {} }));
    assert.throws(
      () => resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps()),
      /empty 'bin' object/,
    );
  });

  it("throws when bin object entry value is not a string", () => {
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ bin: { "mcp-server-asana": 42 } }),
    );
    assert.throws(
      () => resolveBinPath(dir("asana"), "@roychri/mcp-server-asana", makeDeps()),
      /is not a string/,
    );
  });
});

describe("ensureInstalled", () => {
  beforeEach(resetMocks);

  it("reuses existing install when version matches", async () => {
    const installPkgJson = pkgJsonPath("asana", "@roychri/mcp-server-asana");
    mockExistsSync.mock.mockImplementation((p: string) => p === installPkgJson);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ version: "1.8.0", bin: "dist/index.js" }),
    );

    const result = await ensureInstalled("asana", "@roychri/mcp-server-asana", "1.8.0", makeDeps());

    assert.equal(mockExecFileSync.mock.callCount(), 0, "should not invoke npm install");
    assert.equal(mockRmSync.mock.callCount(), 0, "should not wipe");
    assert.equal(
      result.binPath,
      resolve(join(dir("asana"), "node_modules", "@roychri/mcp-server-asana", "dist/index.js")),
    );
  });

  it("wipes and reinstalls when installed version drifts", async () => {
    const installPkgJson = pkgJsonPath("asana", "@roychri/mcp-server-asana");
    const installRoot = dir("asana");
    mockExistsSync.mock.mockImplementation(
      (p: string) => p === installPkgJson || p === installRoot,
    );
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ version: "1.7.0", bin: "dist/index.js" }),
    );

    await ensureInstalled("asana", "@roychri/mcp-server-asana", "1.8.0", makeDeps());

    assert.equal(mockRmSync.mock.callCount(), 1, "should wipe before reinstall");
    assert.equal(mockExecFileSync.mock.callCount(), 1, "should run npm install");
    const [file, args] = mockExecFileSync.mock.calls[0].arguments;
    assert.equal(file, "npm");
    assert.ok(args.includes("--install-strategy=nested"));
    assert.ok(args.includes("@roychri/mcp-server-asana@1.8.0"));
  });

  it("treats missing package.json as drift", async () => {
    // Install root exists but package.json doesn't (e.g., partial install)
    const installRoot = dir("asana");
    mockExistsSync.mock.mockImplementation((p: string) => p === installRoot);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ version: "1.8.0", bin: "dist/index.js" }),
    );

    await ensureInstalled("asana", "@roychri/mcp-server-asana", "1.8.0", makeDeps());

    assert.equal(mockExecFileSync.mock.callCount(), 1, "should run npm install");
  });

  it("treats malformed installed package.json as drift", async () => {
    const installPkgJson = pkgJsonPath("asana", "@roychri/mcp-server-asana");
    const installRoot = dir("asana");
    mockExistsSync.mock.mockImplementation(
      (p: string) => p === installPkgJson || p === installRoot,
    );
    let firstRead = true;
    mockReadFileSync.mock.mockImplementation(() => {
      if (firstRead) {
        firstRead = false;
        return "{ not json";
      }
      return JSON.stringify({ version: "1.8.0", bin: "dist/index.js" });
    });

    await ensureInstalled("asana", "@roychri/mcp-server-asana", "1.8.0", makeDeps());

    assert.equal(
      mockExecFileSync.mock.callCount(),
      1,
      "malformed pkg-json should trigger reinstall",
    );
  });

  it("performs a fresh install when no existing directory", async () => {
    mockExistsSync.mock.mockImplementation(() => false);
    mockReadFileSync.mock.mockImplementation(() =>
      JSON.stringify({ version: "1.8.0", bin: "dist/index.js" }),
    );

    await ensureInstalled("asana", "@roychri/mcp-server-asana", "1.8.0", makeDeps());

    assert.equal(mockRmSync.mock.callCount(), 0, "no wipe when no existing dir");
    assert.equal(mockExecFileSync.mock.callCount(), 1);
  });

  it("propagates install failure from npm with the captured stderr", async () => {
    mockExistsSync.mock.mockImplementation(() => false);
    class NpmError extends Error {
      stderr: Buffer;
      constructor(message: string, stderr: Buffer) {
        super(message);
        this.stderr = stderr;
      }
    }
    mockExecFileSync.mock.mockImplementation(() => {
      throw new NpmError(
        "Command failed: npm install ...",
        Buffer.from("npm ERR! 404 Not Found - GET https://registry.npmjs.org/..."),
      );
    });

    await assert.rejects(
      () => ensureInstalled("asana", "@roychri/mcp-server-asana", "99.99.99", makeDeps()),
      /npm install @roychri\/mcp-server-asana@99\.99\.99 failed:.*404/,
    );
  });

  it("rejects unsafe server names that would escape the install dir", async () => {
    await assert.rejects(
      () => ensureInstalled("../../../etc", "@roychri/mcp-server-asana", "1.8.0", makeDeps()),
      /Invalid MCP server name/,
    );
  });

  it("rejects unsafe package names", async () => {
    await assert.rejects(
      () => ensureInstalled("asana", "../../../etc/passwd", "1.0.0", makeDeps()),
      /Invalid npm package name/,
    );
  });
});

describe("installAllPinnedMcpServers", () => {
  function makeInstallAllDeps(
    pinned: Record<string, PinnedEntry>,
    behavior: "ok" | "fail" | "mixed" = "ok",
  ): InstallAllDeps & {
    spawnConfigs: Record<string, McpServerConfig>;
    ensureCalls: Array<{ name: string; pkg: string; version: string }>;
  } {
    const spawnConfigs: Record<string, McpServerConfig> = {};
    const ensureCalls: Array<{ name: string; pkg: string; version: string }> = [];
    return {
      spawnConfigs,
      ensureCalls,
      getPinnedEntries: () => pinned,
      ensureInstalled: async (name, pkg, version) => {
        ensureCalls.push({ name, pkg, version });
        if (behavior === "fail") throw new Error("install failed");
        if (behavior === "mixed" && name === "broken") throw new Error("install failed");
        return { binPath: `/abs/${name}/bin.js` };
      },
      setPinnedSpawnConfig: (name, config) => {
        spawnConfigs[name] = config;
      },
    };
  }

  it("does NOT call ensureInstalled for legacy npx entries (they're absent from getPinnedEntries)", async () => {
    // The boot loop iterates only pinned entries — legacy npx servers are not in the map at all.
    const deps = makeInstallAllDeps({});
    const result = await installAllPinnedMcpServers(deps);
    assert.equal(deps.ensureCalls.length, 0);
    assert.deepEqual(result.failed, []);
  });

  it("installs all pinned entries and registers their spawn configs", async () => {
    const deps = makeInstallAllDeps({
      asana: { package: "@roychri/mcp-server-asana", version: "1.8.0", env: { TOKEN: "x" } },
      sentry: { package: "@sentry/mcp-server", version: "0.33.0" },
    });

    const result = await installAllPinnedMcpServers(deps);

    assert.deepEqual(result.failed, []);
    assert.equal(deps.ensureCalls.length, 2);
    assert.deepEqual(deps.spawnConfigs.asana, {
      type: "stdio",
      command: "node",
      args: ["/abs/asana/bin.js"],
      env: { TOKEN: "x" },
    });
    assert.deepEqual(deps.spawnConfigs.sentry, {
      type: "stdio",
      command: "node",
      args: ["/abs/sentry/bin.js"],
      env: undefined,
    });
  });

  it("collects names of failed installs and continues with the rest", async () => {
    const deps = makeInstallAllDeps(
      {
        asana: { package: "@roychri/mcp-server-asana", version: "1.8.0" },
        broken: { package: "@bad/pkg", version: "0.0.0" },
        sentry: { package: "@sentry/mcp-server", version: "0.33.0" },
      },
      "mixed",
    );

    const result = await installAllPinnedMcpServers(deps);

    assert.deepEqual(result.failed, ["broken"]);
    // Successful entries still got registered
    assert.ok("asana" in deps.spawnConfigs);
    assert.ok("sentry" in deps.spawnConfigs);
    assert.ok(!("broken" in deps.spawnConfigs));
  });
});
