import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { Config } from "../config.js";
import type { McpServerConfig, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { testMCP, type TestMcpDeps, defaultTestMcpDeps } from "./testMcp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async iterable from an array of fake SDK messages. */
function asyncIterableOf(items: object[]): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item as SDKMessage;
      }
    },
  };
}

/** Minimal config object for tests */
function fakeConfig(): Config {
  return {
    repositories: [
      { name: "test-repo", url: "https://github.com/org/test.git", description: "Test" },
    ],
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
  } as never as Config;
}

const mockClackQuery = vi.fn<TestMcpDeps["clackQuery"]>();
const mockGetConfig = vi.fn<TestMcpDeps["getConfig"]>();
const mockLoadMcpServers = vi.fn<TestMcpDeps["loadMcpServers"]>();
const mockGetConfiguredMcpServerNames = vi.fn<TestMcpDeps["getConfiguredMcpServerNames"]>();
const mockBuildQueryContext = vi.fn<TestMcpDeps["buildQueryContext"]>();
const mockBuildClackTools = vi.fn<TestMcpDeps["buildClackTools"]>();

function makeDeps(): TestMcpDeps {
  return {
    ...defaultTestMcpDeps,
    clackQuery: mockClackQuery,
    getConfig: mockGetConfig,
    loadMcpServers: mockLoadMcpServers,
    getConfiguredMcpServerNames: mockGetConfiguredMcpServerNames,
    buildQueryContext: mockBuildQueryContext,
    buildClackTools: mockBuildClackTools,
  };
}

function resetMocks(): void {
  mockClackQuery.mockClear();
  mockGetConfig.mockClear();
  mockLoadMcpServers.mockClear();
  mockGetConfiguredMcpServerNames.mockClear();
  mockBuildQueryContext.mockClear();
  mockBuildClackTools.mockClear();

  // Defaults
  mockGetConfig.mockImplementation(() => fakeConfig());
  mockLoadMcpServers.mockImplementation(async () => undefined);
  mockGetConfiguredMcpServerNames.mockImplementation(() => []);
  mockBuildQueryContext.mockImplementation(
    () => ({ mode: "query" }) as never as ReturnType<TestMcpDeps["buildQueryContext"]>,
  );
  mockBuildClackTools.mockImplementation(
    () =>
      ({
        toolNames: ["list_repositories", "submit_response"],
        mcpServer: { type: "sdk-mcp" },
      }) as never as ReturnType<TestMcpDeps["buildClackTools"]>,
  );
}

// ---------------------------------------------------------------------------
// testMCP — clack tool server build failure
// ---------------------------------------------------------------------------

describe("testMCP", () => {
  beforeEach(resetMocks);

  describe("when clack tool server fails to build", () => {
    it("returns failure with error message", async () => {
      mockBuildClackTools.mockImplementation(() => {
        throw new Error("Tool registration blew up");
      });

      const result = await testMCP(makeDeps());

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Clack tool server failed to build"));
      assert.ok(result.error?.includes("Tool registration blew up"));
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
      assert.deepEqual(result.tools, []);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, []);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — no external MCP servers configured
  // ---------------------------------------------------------------------------

  describe("when no external MCP servers are configured", () => {
    it("returns success with only clack tools", async () => {
      // loadMcpServers returns undefined, configuredServers is empty
      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.configuredServers, []);
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
      assert.deepEqual(result.tools, ["list_repositories", "submit_response"]);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, ["list_repositories", "submit_response"]);
    });

    it("does not call query when no external servers", async () => {
      await testMCP(makeDeps());

      assert.equal(mockClackQuery.mock.calls.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — no external MCP servers but configuredServers has names
  // (loadMcpServers returns undefined but getConfiguredMcpServerNames returns names)
  // This covers the case where loadMcpServers returns falsy but configuredServers is non-empty
  // ---------------------------------------------------------------------------

  describe("when configuredServers is non-empty but loadMcpServers returns undefined", () => {
    it("returns success with only clack tools", async () => {
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
      // loadMcpServers still returns undefined

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.configuredServers, []);
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
      assert.deepEqual(result.tools, ["list_repositories", "submit_response"]);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, ["list_repositories", "submit_response"]);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — external MCP servers configured, query returns init message
  // ---------------------------------------------------------------------------

  describe("when external MCP servers are configured", () => {
    beforeEach(() => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
    });

    it("returns connected servers from init message", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            tools: [
              "mcp__github__create_issue",
              "mcp__github__list_prs",
              "mcp__clack__list_repositories",
              "mcp__clack__submit_response",
            ],
            mcp_servers: [
              { name: "github", status: "connected" },
              { name: "clack", status: "connected" },
            ],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.configuredServers, ["github"]);
      assert.deepEqual(result.connectedServers, [
        { name: "github", status: "connected" },
        { name: "clack", status: "connected" },
      ]);
      assert.deepEqual(result.failedServers, []);
    });

    it("separates MCP tools from clack tools", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            tools: [
              "mcp__github__create_issue",
              "mcp__github__list_prs",
              "mcp__clack__list_repositories",
              "mcp__clack__submit_response",
            ],
            mcp_servers: [
              { name: "github", status: "connected" },
              { name: "clack", status: "connected" },
            ],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.deepEqual(result.mcpTools, ["mcp__github__create_issue", "mcp__github__list_prs"]);
      assert.deepEqual(result.clackTools, [
        "mcp__clack__list_repositories",
        "mcp__clack__submit_response",
      ]);
    });

    it("reports failed servers separately from connected ones", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            tools: ["mcp__clack__list_repositories"],
            mcp_servers: [
              { name: "github", status: "error" },
              { name: "clack", status: "connected" },
            ],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.connectedServers, [{ name: "clack", status: "connected" }]);
      assert.deepEqual(result.failedServers, [{ name: "github", status: "error" }]);
    });

    it("handles init message with no tools or mcp_servers fields", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            // tools and mcp_servers omitted
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.tools, []);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, []);
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
    });

    it("ignores non-init messages", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello" }] },
          },
          {
            type: "system",
            subtype: "init",
            tools: ["mcp__github__list_prs"],
            mcp_servers: [{ name: "github", status: "connected" }],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.mcpTools, ["mcp__github__list_prs"]);
    });

    it("includes all tools in the tools array", async () => {
      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            tools: ["mcp__github__create_issue", "mcp__clack__submit_response", "Read", "Write"],
            mcp_servers: [],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.deepEqual(result.tools, [
        "mcp__github__create_issue",
        "mcp__clack__submit_response",
        "Read",
        "Write",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — query throws AbortError
  // ---------------------------------------------------------------------------

  describe("when query throws AbortError", () => {
    beforeEach(() => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
    });

    it("returns success with clack tools on AbortError", async () => {
      mockClackQuery.mockImplementation(() => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      });

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.configuredServers, ["github"]);
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
      assert.deepEqual(result.tools, []);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, ["list_repositories", "submit_response"]);
      assert.equal(result.error, undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — query throws non-AbortError
  // ---------------------------------------------------------------------------

  describe("when query throws a non-AbortError", () => {
    beforeEach(() => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
    });

    it("returns failure with error message", async () => {
      mockClackQuery.mockImplementation(() => {
        throw new Error("Connection refused");
      });

      const result = await testMCP(makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "Connection refused");
      assert.deepEqual(result.configuredServers, ["github"]);
      assert.deepEqual(result.connectedServers, []);
      assert.deepEqual(result.failedServers, []);
      assert.deepEqual(result.tools, []);
      assert.deepEqual(result.mcpTools, []);
      assert.deepEqual(result.clackTools, ["list_repositories", "submit_response"]);
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — query throws non-Error value
  // ---------------------------------------------------------------------------

  describe("when query throws a non-Error value", () => {
    beforeEach(() => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
    });

    it("returns failure and stringifies the thrown value", async () => {
      mockClackQuery.mockImplementation(() => {
        throw "string error";
      });

      const result = await testMCP(makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "string error");
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — async iterator throws mid-stream
  // ---------------------------------------------------------------------------

  describe("when query async iterator throws mid-stream", () => {
    beforeEach(() => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github"]);
    });

    it("returns failure with error message", async () => {
      mockClackQuery.mockImplementation(() => {
        throw new Error("stream interrupted");
      });

      const result = await testMCP(makeDeps());

      assert.equal(result.success, false);
      assert.equal(result.error, "stream interrupted");
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — buildQueryContext is called with correct parameters
  // ---------------------------------------------------------------------------

  describe("buildQueryContext invocation", () => {
    it("passes owner role, dummy session, and changesWorkflowEnabled=true", async () => {
      await testMCP(makeDeps());

      assert.equal(mockBuildQueryContext.mock.calls.length, 1);
      const args = mockBuildQueryContext.mock.calls[0]![0];
      assert.equal(args.userId, "test");
      assert.equal(args.role, "owner");
      assert.equal(args.changesWorkflowEnabled, true);
      assert.ok(args.config);
      assert.ok(args.session);
      const session = args.session;
      assert.equal(session.sessionId, "test");
      assert.equal(session.channelId, "test");
    });
  });

  // ---------------------------------------------------------------------------
  // testMCP — multiple external servers
  // ---------------------------------------------------------------------------

  describe("when multiple external servers are configured", () => {
    it("reports all configured server names", async () => {
      mockLoadMcpServers.mockImplementation(async () => ({
        github: {
          type: "stdio",
          command: "github-mcp-server",
          args: ["stdio"],
        } as never as McpServerConfig,
        linear: { type: "stdio", command: "linear-mcp", args: [] } as never as McpServerConfig,
      }));
      mockGetConfiguredMcpServerNames.mockImplementation(() => ["github", "linear"]);

      mockClackQuery.mockImplementation(() =>
        asyncIterableOf([
          {
            type: "system",
            subtype: "init",
            tools: [
              "mcp__github__create_issue",
              "mcp__linear__list_issues",
              "mcp__clack__submit_response",
            ],
            mcp_servers: [
              { name: "github", status: "connected" },
              { name: "linear", status: "connected" },
              { name: "clack", status: "connected" },
            ],
          },
        ]),
      );

      const result = await testMCP(makeDeps());

      assert.equal(result.success, true);
      assert.deepEqual(result.configuredServers, ["github", "linear"]);
      assert.equal(result.connectedServers.length, 3);
      assert.deepEqual(result.mcpTools, ["mcp__github__create_issue", "mcp__linear__list_issues"]);
    });
  });
});
