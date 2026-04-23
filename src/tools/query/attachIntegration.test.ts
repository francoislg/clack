import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { createAttachIntegrationTool, type AttachIntegrationDeps } from "./attachIntegration.js";
import { toolResultText } from "../testHelpers.js";
import type { QueryToolContext, SetMcpServersFn } from "../types.js";
import type { McpServerRegistry, RepositoryConfig } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import { McpServerManager } from "../../claude/mcpServerManager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    channelId: "C1",
    messageTs: "1.0",
    threadTs: "1.0",
    userId: "U123",
    trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeRegistry(): McpServerRegistry {
  return {
    metabase: { alwaysLoad: false, description: "Metabase dashboards and questions" },
    "scheduling-only": { alwaysLoad: false, description: "Scheduling topic (no server)" },
  };
}

const BASELINE_CLACK: McpServerConfig = {
  type: "stdio",
  command: "clack-mcp-stub",
  args: [],
  env: {},
};

interface ManagerOptions {
  sessionStart?: Record<string, McpServerConfig>;
  registry?: McpServerRegistry;
  setMcpServers?: SetMcpServersFn;
  attachedUpfront?: Record<string, McpServerConfig>;
}

function makeManager(opts: ManagerOptions = {}): McpServerManager {
  const sessionStart = opts.sessionStart ?? { clack: BASELINE_CLACK };
  const registry = opts.registry ?? makeRegistry();
  const manager = new McpServerManager(sessionStart, registry);
  if (opts.setMcpServers) manager.bind(opts.setMcpServers);
  // Seed `attached` for duplicate-attach test via a benign attach through the
  // setMcpServers mock. Simpler: test the idempotent path by first attaching.
  if (opts.attachedUpfront && opts.setMcpServers) {
    for (const [name, cfg] of Object.entries(opts.attachedUpfront)) {
      // synchronously nothing, but we need the attach to populate. Use a wrapper.
      void manager.attach(name, cfg);
    }
  }
  return manager;
}

function makeCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "dev",
    session: makeSession(),
    config: { repositories: [] as RepositoryConfig[] } as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    mcpManager: makeManager(),
    ...overrides,
  };
}

type LoadMcpServerFn = AttachIntegrationDeps["loadMcpServer"];
type ResolveInstructionsFn = AttachIntegrationDeps["resolveInstructions"];
type UpdateSessionFn = AttachIntegrationDeps["updateSession"];

interface DepMocks {
  deps: AttachIntegrationDeps;
  loadMcpServer: ReturnType<typeof mock.fn<LoadMcpServerFn>>;
  resolveInstructions: ReturnType<typeof mock.fn<ResolveInstructionsFn>>;
  updateSession: ReturnType<typeof mock.fn<UpdateSessionFn>>;
}

function makeDepMocks(overrides: Partial<AttachIntegrationDeps> = {}): DepMocks {
  const loadMcpServer = mock.fn<LoadMcpServerFn>(async (name: string) => {
    if (name === "metabase") {
      const cfg: McpServerConfig = {
        type: "stdio",
        command: "metabase-mcp",
        args: [],
        env: {},
      };
      return cfg;
    }
    return undefined;
  });
  const resolveInstructions = mock.fn<ResolveInstructionsFn>((_roleChain, activeTopics) => {
    if (activeTopics && activeTopics.size > 0) {
      return `Topic instructions for ${[...activeTopics].join(",")}`;
    }
    return "";
  });
  const updateSession = mock.fn<UpdateSessionFn>(async () => null);
  const deps: AttachIntegrationDeps = {
    loadMcpServer,
    resolveInstructions,
    updateSession,
    ...overrides,
  };
  return { deps, loadMcpServer, resolveInstructions, updateSession };
}

function okSetMcpServers(): ReturnType<typeof mock.fn<SetMcpServersFn>> {
  return mock.fn<SetMcpServersFn>(async () => ({ added: [], removed: [], errors: {} }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attach_integration tool", () => {
  it("successfully attaches an MCP-backed integration", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });
    const text = toolResultText(result);

    assert.ok(text.includes("Attached integration: metabase"));
    assert.ok(text.includes("New tools may now be available"));
    assert.ok(text.includes("Topic instructions for metabase"));
    assert.equal(setMcpServers.mock.callCount(), 1);
    assert.deepEqual(manager.attachedNames(), ["metabase"]);
    assert.equal(depMocks.updateSession.mock.callCount(), 1);
  });

  it("returns idempotent success on duplicate attach without calling setMcpServers again", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const existingConfig: McpServerConfig = {
      type: "stdio",
      command: "metabase-mcp",
      args: [],
      env: {},
    };
    // First attach through the manager primes the attached set.
    await manager.attach("metabase", existingConfig);

    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const callCountBefore = setMcpServers.mock.callCount();
    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });
    const text = toolResultText(result);

    assert.ok(text.includes("already attached"));
    // No additional setMcpServers call triggered by the duplicate.
    assert.equal(setMcpServers.mock.callCount(), callCountBefore);
    // loadMcpServer wasn't called on the duplicate path.
    assert.equal(depMocks.loadMcpServer.mock.callCount(), 0);
  });

  it("returns error for unknown integration name and lists available ones", async () => {
    const manager = makeManager({ setMcpServers: okSetMcpServers() });
    const ctx = makeCtx({ mcpManager: manager });
    const toolDef = createAttachIntegrationTool(ctx, makeDepMocks().deps);

    const result = await toolDef.handler({ name: "nonexistent" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("Unknown integration: nonexistent"));
    assert.ok(text.includes("metabase"));
    assert.ok(text.includes("scheduling-only"));
  });

  it("attaches an instructions-only integration without calling setMcpServers", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "scheduling-only" }, { sessionId: "test" });
    const text = toolResultText(result);

    assert.ok(text.includes("Attached integration: scheduling-only"));
    assert.ok(text.includes("This integration has no MCP server"));
    assert.ok(text.includes("Topic instructions for scheduling-only"));
    assert.equal(setMcpServers.mock.callCount(), 0);
    assert.deepEqual(manager.attachedNames(), []);
    assert.equal(depMocks.updateSession.mock.callCount(), 1);
  });

  it("returns error and does not record attach when setMcpServers reports a connection error", async () => {
    const setMcpServers = mock.fn<SetMcpServersFn>(async () => ({
      added: [],
      removed: [],
      errors: { metabase: "connection refused" },
    }));
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("Failed to attach metabase"));
    assert.ok(text.includes("connection refused"));
    assert.deepEqual(manager.attachedNames(), []);
    // updateSession is called once to append a 'failed' entry to mcpAttachHistory
    // (attachedIntegrations is NOT updated — the attach didn't succeed).
    assert.equal(depMocks.updateSession.mock.callCount(), 1);
    const call = depMocks.updateSession.mock.calls[0];
    const updates = call.arguments[1];
    assert.equal(updates.attachedIntegrations, undefined);
    assert.equal(updates.mcpAttachHistory?.[0]?.outcome, "failed");
    assert.equal(updates.mcpAttachHistory?.[0]?.error, "connection refused");
  });

  it("returns error and does not record attach when setMcpServers throws", async () => {
    const setMcpServers = mock.fn<SetMcpServersFn>(async () => {
      throw new Error("network blew up");
    });
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("Failed to attach metabase"));
    assert.ok(text.includes("network blew up"));
    assert.deepEqual(manager.attachedNames(), []);
  });

  it("merges session-start + previously-attached + new server in setMcpServers call", async () => {
    let received: Record<string, McpServerConfig> | undefined;
    const setMcpServers = mock.fn<SetMcpServersFn>(async (servers) => {
      received = servers;
      return { added: [], removed: [], errors: {} };
    });
    // Registry includes 'other' so we can pre-attach it through the manager.
    const registryWithOther: McpServerRegistry = {
      ...makeRegistry(),
      other: { alwaysLoad: false, description: "other" },
    };
    const manager = new McpServerManager({ clack: BASELINE_CLACK }, registryWithOther);
    manager.bind(setMcpServers);
    await manager.attach("other", {
      type: "stdio",
      command: "other-mcp",
      args: [],
      env: {},
    });

    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.ok(received);
    assert.deepEqual(Object.keys(received ?? {}).sort(), ["clack", "metabase", "other"]);
    assert.deepEqual(manager.attachedNames().sort(), ["metabase", "other"]);
  });

  it("always preserves session-start servers (clack MCP) when calling setMcpServers", async () => {
    let received: Record<string, McpServerConfig> | undefined;
    const setMcpServers = mock.fn<SetMcpServersFn>(async (servers) => {
      received = servers;
      return { added: [], removed: [], errors: {} };
    });
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.ok(received);
    assert.ok(
      "clack" in (received ?? {}),
      "clack session-start server missing from setMcpServers arg",
    );
    assert.ok("metabase" in (received ?? {}), "metabase missing from setMcpServers arg");
  });

  it("persists attachedIntegrations on the session on successful attach", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const session = makeSession({ attachedIntegrations: ["already-there"] });
    const ctx = makeCtx({ mcpManager: manager, session });
    let observedUpdate: Partial<SessionContext> | undefined;
    const updateSession = mock.fn<UpdateSessionFn>(async (_id, updates) => {
      observedUpdate = updates;
      return null;
    });
    const depMocks = makeDepMocks({ updateSession });
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.ok(observedUpdate, "updateSession should have been called");
    assert.deepEqual(observedUpdate?.attachedIntegrations, ["already-there", "metabase"]);
  });

  it("does not duplicate attachedIntegrations if the integration is already recorded", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const session = makeSession({ attachedIntegrations: ["metabase"] });
    const ctx = makeCtx({ mcpManager: manager, session });
    const depMocks = makeDepMocks();
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    // updateSession is still called (to append the history entry), but the
    // attachedIntegrations list must not duplicate 'metabase'.
    const calls = depMocks.updateSession.mock.calls;
    const lastUpdate = calls[calls.length - 1].arguments[1];
    assert.deepEqual(lastUpdate.attachedIntegrations, ["metabase"]);
  });

  it("still returns success when persistence throws — attach itself succeeded", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const updateSession = mock.fn<UpdateSessionFn>(async () => {
      throw new Error("disk full");
    });
    const depMocks = makeDepMocks({ updateSession });
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.notEqual(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("Attached integration: metabase"));
  });

  it("returns error when mcpManager is absent (bug guard)", async () => {
    const ctx = makeCtx({ mcpManager: undefined });
    const toolDef = createAttachIntegrationTool(ctx, makeDepMocks().deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("not available"));
  });

  it("returns error when the manager hasn't been bound to setMcpServers yet", async () => {
    const manager = makeManager({ setMcpServers: undefined });
    const ctx = makeCtx({ mcpManager: manager });
    const toolDef = createAttachIntegrationTool(ctx, makeDepMocks().deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    assert.equal(result.isError, true);
    const text = toolResultText(result);
    assert.ok(text.includes("setMcpServers not yet bound"));
  });

  it("falls back to a placeholder body when no topic instructions are resolved", async () => {
    const setMcpServers = okSetMcpServers();
    const manager = makeManager({ setMcpServers });
    const ctx = makeCtx({ mcpManager: manager });
    const resolveInstructions = mock.fn<ResolveInstructionsFn>(() => "");
    const depMocks = makeDepMocks({ resolveInstructions });
    const toolDef = createAttachIntegrationTool(ctx, depMocks.deps);

    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });
    const text = toolResultText(result);

    assert.ok(text.includes("No topic instructions were resolved"));
  });
});
