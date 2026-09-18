import { beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  McpServerManager,
  prepareMcpSession,
  completeSessionStart,
  type McpSessionSetupDeps,
} from "./mcpServerManager.js";
import type { McpServerStatusFn, SetMcpServersFn } from "../tools/types.js";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import type { Config, McpServerRegistry } from "../config.js";
import { resolveEffectiveRegistry } from "../mcp.js";
import { getLoadedPluginIntegrations } from "../plugins-core/state.js";
import { logger } from "../logger.js";
import type { SessionContext } from "../sessions.js";

vi.mock("../mcp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp.js")>()),
  resolveEffectiveRegistry: vi.fn(),
}));
vi.mock("../plugins-core/state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins-core/state.js")>()),
  getLoadedPluginIntegrations: vi.fn(),
}));

const BASELINE_CLACK: McpServerConfig = {
  type: "stdio",
  command: "clack-mcp",
  args: [],
  env: {},
};

const METABASE_CFG: McpServerConfig = {
  type: "stdio",
  command: "metabase-mcp",
  args: [],
  env: {},
};

function makeRegistry(): McpServerRegistry {
  return {
    metabase: { alwaysLoad: false, description: "Metabase" },
    monday: { alwaysLoad: false, description: "Monday" },
  };
}

function okSetMcpServers(): ReturnType<typeof vi.fn<SetMcpServersFn>> {
  return vi.fn<SetMcpServersFn>(async () => ({ added: [], removed: [], errors: {} }));
}

describe("McpServerManager", () => {
  describe("seedAttached", () => {
    it("marks a name as attached without calling setMcpServers", () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers);

      manager.seedAttached("metabase", METABASE_CFG);

      assert.equal(manager.isAttached("metabase"), true);
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
      assert.equal(setMcpServers.mock.calls.length, 0);
    });

    it("is safe to call before bind(…)", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      assert.equal(manager.isAttached("metabase"), true);
    });

    it("subsequent attach() of the same name is idempotent", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers);
      manager.seedAttached("metabase", METABASE_CFG);

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, true);
      assert.equal(setMcpServers.mock.calls.length, 0);
    });
  });

  describe("attach", () => {
    it("passes sessionStart + attached + new to setMcpServers", async () => {
      let received: Record<string, McpServerConfig> | undefined;
      const setMcpServers = vi.fn<SetMcpServersFn>(async (servers) => {
        received = servers;
        return { added: [], removed: [], errors: {} };
      });
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers);
      manager.seedAttached("monday", {
        type: "stdio",
        command: "monday-mcp",
        args: [],
        env: {},
      });

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, true);
      assert.ok(received);
      assert.deepEqual(Object.keys(received ?? {}).sort(), ["clack", "metabase", "monday"]);
      assert.deepEqual(manager.attachedNames().sort(), ["metabase", "monday"]);
    });

    it("returns error when the connection fails, and does not update attached set", async () => {
      const setMcpServers = vi.fn<SetMcpServersFn>(async () => ({
        added: [],
        removed: [],
        errors: { metabase: "connection refused" },
      }));
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers);

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /connection refused/);
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("returns error when the manager hasn't been bound", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /not yet bound/);
    });

    it("returns ok without a setMcpServers call when already attached (idempotent)", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers);
      await manager.attach("metabase", METABASE_CFG);
      const callsBefore = setMcpServers.mock.calls.length;

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, true);
      assert.equal(setMcpServers.mock.calls.length, callsBefore);
    });
  });

  describe("isInSessionStart", () => {
    it("is true for names in the session-start baseline and false otherwise", () => {
      const manager = new McpServerManager(
        { clack: BASELINE_CLACK, "mongodb-prod": METABASE_CFG },
        makeRegistry(),
      );
      assert.equal(manager.isInSessionStart("clack"), true);
      assert.equal(manager.isInSessionStart("mongodb-prod"), true);
      assert.equal(manager.isInSessionStart("metabase"), false);
    });

    it("reflects servers added via hydrateSessionStart", () => {
      const manager = new McpServerManager({}, makeRegistry());
      manager.hydrateSessionStart({ clack: BASELINE_CLACK });
      assert.equal(manager.isInSessionStart("clack"), true);
    });
  });

  describe("isLiveInBaseline", () => {
    function statusFn(statuses: McpServerStatus[]): McpServerStatusFn {
      return vi.fn<McpServerStatusFn>(async () => statuses);
    }

    it("returns true when the SDK reports the server as connected", async () => {
      const manager = new McpServerManager({ "mongodb-prod": METABASE_CFG }, makeRegistry());
      manager.bind(okSetMcpServers(), statusFn([{ name: "mongodb-prod", status: "connected" }]));
      assert.equal(await manager.isLiveInBaseline("mongodb-prod"), true);
    });

    it("returns false for non-connected statuses", async () => {
      const manager = new McpServerManager({ "mongodb-prod": METABASE_CFG }, makeRegistry());
      manager.bind(
        okSetMcpServers(),
        statusFn([{ name: "mongodb-prod", status: "failed", error: "boom" }]),
      );
      assert.equal(await manager.isLiveInBaseline("mongodb-prod"), false);
    });

    it("returns false when the server is not in the status list", async () => {
      const manager = new McpServerManager({ "mongodb-prod": METABASE_CFG }, makeRegistry());
      manager.bind(okSetMcpServers(), statusFn([]));
      assert.equal(await manager.isLiveInBaseline("mongodb-prod"), false);
    });

    it("returns false when the status fn isn't bound (defensive default)", async () => {
      const manager = new McpServerManager({ "mongodb-prod": METABASE_CFG }, makeRegistry());
      manager.bind(okSetMcpServers());
      assert.equal(await manager.isLiveInBaseline("mongodb-prod"), false);
    });

    it("returns false when the status probe throws", async () => {
      const manager = new McpServerManager({ "mongodb-prod": METABASE_CFG }, makeRegistry());
      manager.bind(
        okSetMcpServers(),
        vi.fn<McpServerStatusFn>(async () => {
          throw new Error("transport closed");
        }),
      );
      assert.equal(await manager.isLiveInBaseline("mongodb-prod"), false);
    });
  });

  describe("registry queries", () => {
    it("knowsServer reflects registry entries", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      assert.equal(manager.knowsServer("metabase"), true);
      assert.equal(manager.knowsServer("nonexistent"), false);
    });

    it("knownNames returns sorted registry keys", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      assert.deepEqual(manager.knownNames(), ["metabase", "monday"]);
    });
  });
});

describe("prepareMcpSession + completeSessionStart — pre-attached topic servers", () => {
  const REGISTRY: McpServerRegistry = {
    metabase: { alwaysLoad: false, description: "Metabase" },
    sentry: { alwaysLoad: false, description: "Sentry" },
    "trivia:management": { alwaysLoad: false, description: "Trivia admin" },
  };

  function stdioCfg(name: string): McpServerConfig {
    return { type: "stdio", command: `${name}-mcp`, args: [], env: {} };
  }

  function makeSetupSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      sessionId: "s1",
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

  function makeDeps(overrides: Partial<McpSessionSetupDeps> = {}): McpSessionSetupDeps {
    return {
      getConfiguredMcpServerNames: vi.fn(() => []),
      loadAlwaysOnMcpServers: vi.fn(async () => undefined),
      updateSession: vi.fn(async () => null),
      loadMcpServer: vi.fn(async (name: string) =>
        name === "metabase" || name === "sentry" ? stdioCfg(name) : undefined,
      ),
      ...overrides,
    };
  }

  const config = { mcpServers: {} } as Config;

  beforeEach(() => {
    vi.mocked(getLoadedPluginIntegrations).mockReturnValue([]);
    vi.mocked(resolveEffectiveRegistry).mockReturnValue({ registry: REGISTRY, unmapped: [] });
  });

  it("loads the server behind a pre-attached registry name into the session-start map", async () => {
    const deps = makeDeps();
    const setup = await prepareMcpSession(
      makeSetupSession(),
      config,
      ["response-rendering", "metabase"],
      deps,
    );
    const result = completeSessionStart(setup, { clack: BASELINE_CLACK });

    assert.ok("metabase" in result);
    assert.equal(setup.manager.isInSessionStart("metabase"), true);
    const loadedNames = vi.mocked(deps.loadMcpServer).mock.calls.map((c) => c[0]);
    assert.ok(loadedNames.includes("metabase"));
    assert.ok(!loadedNames.includes("response-rendering"));
  });

  it("skips a registry name with no mcp.json server (plugin on-demand / instructions-only)", async () => {
    const deps = makeDeps();
    const setup = await prepareMcpSession(makeSetupSession(), config, ["trivia:management"], deps);

    assert.deepEqual(setup.preAttached, {});
    const loadedNames = vi.mocked(deps.loadMcpServer).mock.calls.map((c) => c[0]);
    assert.ok(loadedNames.includes("trivia:management"));
  });

  it("logs and skips a server whose config fails to load", async () => {
    const deps = makeDeps({
      loadMcpServer: vi.fn(async (name: string) => {
        if (name === "metabase") throw new Error("boom");
        return undefined;
      }),
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const setup = await prepareMcpSession(makeSetupSession(), config, ["metabase"], deps);

    assert.deepEqual(setup.preAttached, {});
    assert.ok(warn.mock.calls.some((c) => String(c[0]).includes("pre-attached topic 'metabase'")));
  });

  it("does not load a pre-attached name twice when it is already resumed", async () => {
    const deps = makeDeps();
    const setup = await prepareMcpSession(
      makeSetupSession({ attachedIntegrations: ["metabase"] }),
      config,
      ["metabase"],
      deps,
    );

    assert.equal(vi.mocked(deps.loadMcpServer).mock.calls.length, 1);
    assert.deepEqual(setup.preAttached, {});
    assert.ok("metabase" in setup.resumedAttached);
  });

  it("does not load a pre-attached name that is already an always-on external", async () => {
    vi.mocked(resolveEffectiveRegistry).mockReturnValue({
      registry: { ...REGISTRY, github: { alwaysLoad: true, description: "GitHub" } },
      unmapped: [],
    });
    const deps = makeDeps({
      loadAlwaysOnMcpServers: vi.fn(async () => ({ github: stdioCfg("github") })),
    });
    const setup = await prepareMcpSession(makeSetupSession(), config, ["github"], deps);

    assert.deepEqual(setup.preAttached, {});
    assert.equal(vi.mocked(deps.loadMcpServer).mock.calls.length, 0);
  });

  it("orders pre-attached servers by the topic list, after always-on externals and before clack/plugin servers", async () => {
    const deps = makeDeps({
      loadAlwaysOnMcpServers: vi.fn(async () => ({ github: stdioCfg("github") })),
    });
    const setup = await prepareMcpSession(makeSetupSession(), config, ["sentry", "metabase"], deps);
    const result = completeSessionStart(setup, { clack: BASELINE_CLACK });

    assert.deepEqual(Object.keys(result), ["github", "sentry", "metabase", "clack"]);
  });
});
