import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { McpDeps } from "./mcp.js";
import { loadMcpServers, resetMcpCache } from "./mcp.js";
import { mapPermissionsToToolsets } from "./mcpGithub.js";

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

function mcpConfigPath(): string {
  return `${process.cwd()}/data/mcp.json`;
}
function githubAuthPath(): string {
  return `${process.cwd()}/data/auth/github.json`;
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
// mapPermissionsToToolsets
// ---------------------------------------------------------------------------

describe("mapPermissionsToToolsets", () => {
  it("always includes context toolset", () => {
    assert.equal(mapPermissionsToToolsets({}), "context");
  });

  it("maps pull_requests to pull_requests and issues toolsets", () => {
    const toolsets = mapPermissionsToToolsets({ pull_requests: "write" }).split(",");
    assert.ok(toolsets.includes("context"));
    assert.ok(toolsets.includes("pull_requests"));
    assert.ok(toolsets.includes("issues"));
  });

  it("maps contents to repos and git toolsets", () => {
    const toolsets = mapPermissionsToToolsets({ contents: "read" }).split(",");
    assert.ok(toolsets.includes("repos"));
    assert.ok(toolsets.includes("git"));
  });

  it("maps issues to issues and labels toolsets", () => {
    const toolsets = mapPermissionsToToolsets({ issues: "read" }).split(",");
    assert.ok(toolsets.includes("issues"));
    assert.ok(toolsets.includes("labels"));
  });

  it("maps actions permission", () => {
    assert.ok(mapPermissionsToToolsets({ actions: "read" }).split(",").includes("actions"));
  });

  it("maps security_events to code_security and security_advisories", () => {
    const toolsets = mapPermissionsToToolsets({ security_events: "read" }).split(",");
    assert.ok(toolsets.includes("code_security"));
    assert.ok(toolsets.includes("security_advisories"));
  });

  it("maps secret_scanning_alerts to secret_protection", () => {
    assert.ok(
      mapPermissionsToToolsets({ secret_scanning_alerts: "read" })
        .split(",")
        .includes("secret_protection"),
    );
  });

  it("maps vulnerability_alerts to dependabot", () => {
    assert.ok(
      mapPermissionsToToolsets({ vulnerability_alerts: "read" }).split(",").includes("dependabot"),
    );
  });

  it("maps repository_projects to projects", () => {
    assert.ok(
      mapPermissionsToToolsets({ repository_projects: "read" }).split(",").includes("projects"),
    );
  });

  it("maps organization_projects to projects", () => {
    assert.ok(
      mapPermissionsToToolsets({ organization_projects: "read" }).split(",").includes("projects"),
    );
  });

  it("deduplicates toolsets when multiple permissions map to the same toolset", () => {
    const toolsets = mapPermissionsToToolsets({ pull_requests: "write", issues: "write" }).split(
      ",",
    );
    assert.equal(toolsets.filter((t: string) => t === "issues").length, 1);
  });

  it("deduplicates projects from repository_projects and organization_projects", () => {
    const toolsets = mapPermissionsToToolsets({
      repository_projects: "read",
      organization_projects: "read",
    }).split(",");
    assert.equal(toolsets.filter((t: string) => t === "projects").length, 1);
  });

  it("combines multiple permission mappings", () => {
    const toolsets = mapPermissionsToToolsets({
      pull_requests: "write",
      contents: "read",
      actions: "read",
    }).split(",");
    assert.ok(toolsets.includes("pull_requests"));
    assert.ok(toolsets.includes("repos"));
    assert.ok(toolsets.includes("git"));
    assert.ok(toolsets.includes("actions"));
    assert.ok(toolsets.includes("context"));
  });

  it("ignores unknown permission keys", () => {
    assert.equal(mapPermissionsToToolsets({ unknown_perm: "read" }), "context");
  });
});

// ---------------------------------------------------------------------------
// loadMcpServers — GitHub MCP auto-injection
// ---------------------------------------------------------------------------

describe("loadMcpServers GitHub auto-injection", () => {
  beforeEach(resetMocks);

  it("auto-injects GitHub MCP when credentials exist and binary is available", async () => {
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("/usr/local/bin/github-mcp-server"));

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("github" in result);

    const github = result.github as {
      type: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    assert.equal(github.type, "stdio");
    assert.equal(github.command, "github-mcp-server");
    assert.equal(github.args[0], "stdio");
    assert.equal(github.args[1], "--exclude-tools");
    assert.ok(github.args[2].includes("search_pull_requests"));
    assert.equal(github.env.GITHUB_PERSONAL_ACCESS_TOKEN, "ghs_test_token");
    assert.ok(github.env.GITHUB_TOOLSETS.includes("repos"));
    assert.ok(github.env.GITHUB_TOOLSETS.includes("pull_requests"));
  });

  it("skips auto-injection when GitHub credentials do not exist", async () => {
    setExistingPaths([mcpConfigPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok(!("github" in result));
  });

  it("skips auto-injection when a manual 'github' server is already configured", async () => {
    const configWithGithub = JSON.stringify({
      mcpServers: {
        github: { command: "custom-github-mcp", args: ["--custom"] },
      },
    });
    setExistingPaths([mcpConfigPath(), githubAuthPath()]);
    mockReadFileSync.mock.mockImplementation(() => configWithGithub);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.equal((result.github as { command: string }).command, "custom-github-mcp");
  });

  it("skips auto-injection when binary is not available", async () => {
    setExistingPaths([githubAuthPath()]);
    // execSync throws — binary not found (default mock behavior)

    const result = await loadMcpServers(makeDeps());
    assert.equal(result, undefined);
  });

  it("merges auto-injected GitHub MCP with existing static servers", async () => {
    setExistingPaths([mcpConfigPath(), githubAuthPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("myserver" in result);
    assert.ok("github" in result);
  });

  it("returns static config when getInstallationToken throws", async () => {
    setExistingPaths([mcpConfigPath(), githubAuthPath()]);
    mockReadFileSync.mock.mockImplementation(() => stdioMcpJson());
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));
    mockGetInstallationToken.mock.mockImplementation(async () => {
      throw new Error("token generation failed");
    });

    const result = await loadMcpServers(makeDeps());
    assert.ok(result);
    assert.ok("myserver" in result);
    assert.ok(!("github" in result));
  });

  it("uses fresh token on each call (not cached)", async () => {
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    let callCount = 0;
    mockGetInstallationToken.mock.mockImplementation(async () => {
      callCount++;
      return {
        token: `token_${callCount}`,
        permissions: { contents: "read" },
        expiresAt: new Date(),
      };
    });

    const first = await loadMcpServers(makeDeps());
    resetMcpCache();
    setExistingPaths([githubAuthPath()]);
    mockExecSync.mock.mockImplementation(() => Buffer.from("ok"));

    const second = await loadMcpServers(makeDeps());

    assert.ok(first);
    assert.ok(second);
    assert.equal(
      (first.github as { env: Record<string, string> }).env.GITHUB_PERSONAL_ACCESS_TOKEN,
      "token_1",
    );
    assert.equal(
      (second.github as { env: Record<string, string> }).env.GITHUB_PERSONAL_ACCESS_TOKEN,
      "token_2",
    );
  });
});
