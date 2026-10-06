import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import assert from "node:assert/strict";
import type { McpServerConfig, McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  McpServerManager,
  prepareMcpSession,
  completeSessionStart,
  type McpSessionSetupDeps,
} from "./mcpServerManager.js";
import type { McpServerStatusFn, ReconnectMcpServerFn, SetMcpServersFn } from "../tools/types.js";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { getDownloadsDir, type Config, type McpServerRegistry } from "../config.js";
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

      assert.equal(manager.isRegistered("metabase"), true);
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
      assert.equal(setMcpServers.mock.calls.length, 0);
    });

    it("is safe to call before bind(…)", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
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
      assert.equal(result.ok ? undefined : result.retryable, true);
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

  describe("attach — session downloads placeholder", () => {
    const PLACEHOLDER_CFG: McpServerConfig = {
      type: "stdio",
      command: "files-mcp",
      args: [],
      env: { OUT: "${CLACK_SESSION_DOWNLOADS_DIR}/out" },
    };

    it("sends and stores the config resolved against the session downloads dir", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({}, makeRegistry(), "/dl/s1");
      manager.bind(setMcpServers);

      await manager.attach("metabase", PLACEHOLDER_CFG);

      const expected = { ...PLACEHOLDER_CFG, env: { OUT: "/dl/s1/out" } };
      assert.deepEqual(setMcpServers.mock.calls[0]?.[0], { metabase: expected });

      await manager.attach("monday", METABASE_CFG);
      assert.deepEqual(setMcpServers.mock.calls[1]?.[0].metabase, expected);
    });

    it("resolves differently for managers with different downloads dirs", async () => {
      const setA = okSetMcpServers();
      const setB = okSetMcpServers();
      const a = new McpServerManager({}, makeRegistry(), "/dl/a");
      const b = new McpServerManager({}, makeRegistry(), "/dl/b");
      a.bind(setA);
      b.bind(setB);

      await a.attach("metabase", PLACEHOLDER_CFG);
      await b.attach("metabase", PLACEHOLDER_CFG);

      assert.deepEqual(setA.mock.calls[0]?.[0].metabase, {
        ...PLACEHOLDER_CFG,
        env: { OUT: "/dl/a/out" },
      });
      assert.deepEqual(setB.mock.calls[0]?.[0].metabase, {
        ...PLACEHOLDER_CFG,
        env: { OUT: "/dl/b/out" },
      });
    });

    it("leaves the placeholder untouched when no downloads dir is set", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({}, makeRegistry());
      manager.bind(setMcpServers);

      await manager.attach("metabase", PLACEHOLDER_CFG);

      assert.equal(setMcpServers.mock.calls[0]?.[0].metabase, PLACEHOLDER_CFG);
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

  describe("isRegistered", () => {
    it("is true for session-start and attached servers and false otherwise", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      assert.equal(manager.isRegistered("clack"), true);
      assert.equal(manager.isRegistered("metabase"), true);
      assert.equal(manager.isRegistered("monday"), false);
    });
  });

  describe("topic tracking", () => {
    it("reports only topics recorded as attached", () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.recordTopicAttached("response-rendering");
      assert.equal(manager.isTopicAttached("response-rendering"), true);
      assert.equal(manager.isTopicAttached("metabase"), false);
    });

    it("is independent of server registration", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(okSetMcpServers());
      vi.spyOn(logger, "warn").mockImplementation(() => {});
      await manager.attach("metabase", METABASE_CFG);
      assert.equal(manager.isRegistered("metabase"), true);
      assert.equal(manager.isTopicAttached("metabase"), false);
    });
  });

  describe("attach — liveness", () => {
    const connected = (name: string): McpServerStatus => ({ name, status: "connected" });
    const failed = (name: string, error?: string): McpServerStatus => ({
      name,
      status: "failed",
      error,
    });
    const pending = (name: string): McpServerStatus => ({ name, status: "pending" });

    function statusSequence(...reads: McpServerStatus[][]): Mock<McpServerStatusFn> {
      const fn = vi.fn<McpServerStatusFn>();
      for (const read of reads) fn.mockResolvedValueOnce(read);
      return fn;
    }

    function okReconnect(): Mock<ReconnectMcpServerFn> {
      return vi.fn<ReconnectMcpServerFn>(async () => {});
    }

    let warn: MockInstance<typeof logger.warn>;
    beforeEach(() => {
      warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    });

    it("connected registered server: no SDK call, alreadyLive", async () => {
      const setMcpServers = okSetMcpServers();
      const reconnect = okReconnect();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      manager.bind(setMcpServers, statusSequence([connected("metabase")]), reconnect);

      const result = await manager.attach("metabase");

      assert.deepEqual(result, { ok: true, alreadyLive: true });
      expect(setMcpServers).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();
    });

    it("connected server the manager doesn't hold: records the given config, no SDK call", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers, statusSequence([connected("metabase")]), okReconnect());

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: true, alreadyLive: true });
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
      expect(setMcpServers).not.toHaveBeenCalled();
    });

    it("absent → setMcpServers → connected: records and succeeds", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers, statusSequence([], [connected("metabase")]), okReconnect());

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: true, alreadyLive: false });
      expect(setMcpServers).toHaveBeenCalledWith({ clack: BASELINE_CLACK, metabase: METABASE_CFG });
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
    });

    it("absent → setMcpServers with no error → failed: retryable failure, not recorded", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(
        okSetMcpServers(),
        statusSequence([], [failed("metabase", "connect timeout")]),
        okReconnect(),
      );

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: false, error: "failed: connect timeout", retryable: true });
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("absent → setMcpServers error → needs-auth: names the status with the SDK error, not retryable", async () => {
      const setMcpServers = vi.fn<SetMcpServersFn>(async () => ({
        added: [],
        removed: [],
        errors: { monday: "auth failed" },
      }));
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(
        setMcpServers,
        statusSequence([], [{ name: "monday", status: "needs-auth" }]),
        okReconnect(),
      );

      const result = await manager.attach("monday", METABASE_CFG);

      assert.deepEqual(result, { ok: false, error: "needs-auth: auth failed", retryable: false });
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("absent with no config anywhere: not-retryable failure, no SDK call", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers, statusSequence([]), okReconnect());

      const result = await manager.attach("metabase");

      assert.deepEqual(result, {
        ok: false,
        error: "no server config for 'metabase'",
        retryable: false,
      });
      expect(setMcpServers).not.toHaveBeenCalled();
    });

    it("absent → setMcpServers ok → still absent: retryable failure, not recorded", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(okSetMcpServers(), statusSequence([], []), okReconnect());

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: false, error: "absent", retryable: true });
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("absent seeded server with no config: re-sends its remembered config and succeeds", async () => {
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      manager.bind(setMcpServers, statusSequence([], [connected("metabase")]), okReconnect());

      const result = await manager.attach("metabase");

      assert.deepEqual(result, { ok: true, alreadyLive: false });
      expect(setMcpServers).toHaveBeenCalledWith({ clack: BASELINE_CLACK, metabase: METABASE_CFG });
      assert.ok(manager.attachedNames().includes("metabase"));
    });

    it("setMcpServers throwing is a retryable failure", async () => {
      const setMcpServers = vi.fn<SetMcpServersFn>(async () => {
        throw new Error("transport closed");
      });
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers, statusSequence([]), okReconnect());

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: false, error: "transport closed", retryable: true });
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("failed → reconnect → connected: succeeds without setMcpServers", async () => {
      const setMcpServers = okSetMcpServers();
      const reconnect = okReconnect();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      manager.bind(
        setMcpServers,
        statusSequence([failed("metabase", "boom")], [connected("metabase")]),
        reconnect,
      );

      const result = await manager.attach("metabase");

      assert.deepEqual(result, { ok: true, alreadyLive: false });
      expect(reconnect).toHaveBeenCalledWith("metabase");
      expect(setMcpServers).not.toHaveBeenCalled();
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
    });

    it("failed → reconnect → still failed: retryable failure; an attached server stays attached", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.seedAttached("metabase", METABASE_CFG);
      manager.bind(
        okSetMcpServers(),
        statusSequence([failed("metabase", "boom")], [failed("metabase", "still down")]),
        okReconnect(),
      );

      const result = await manager.attach("metabase");

      assert.deepEqual(result, { ok: false, error: "failed: still down", retryable: true });
      assert.deepEqual(manager.attachedNames(), ["metabase"]);
    });

    it("failed → reconnect throws: retryable failure carrying the thrown error", async () => {
      const reconnect = vi.fn<ReconnectMcpServerFn>(async () => {
        throw new Error("reconnect exploded");
      });
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(okSetMcpServers(), statusSequence([failed("metabase", "boom")]), reconnect);

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, { ok: false, error: "reconnect exploded", retryable: true });
      assert.deepEqual(manager.attachedNames(), []);
    });

    it("failed with no reconnect fn bound: retryable failure", async () => {
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(okSetMcpServers(), statusSequence([failed("metabase")]));

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.deepEqual(result, {
        ok: false,
        error: "reconnect not available for 'metabase'",
        retryable: true,
      });
    });

    it.each(["needs-auth", "disabled"] as const)(
      "%s: not-retryable failure with no SDK call",
      async (status) => {
        const setMcpServers = okSetMcpServers();
        const reconnect = okReconnect();
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(setMcpServers, statusSequence([{ name: "monday", status }]), reconnect);

        const result = await manager.attach("monday", METABASE_CFG);

        assert.deepEqual(result, { ok: false, error: status, retryable: false });
        expect(setMcpServers).not.toHaveBeenCalled();
        expect(reconnect).not.toHaveBeenCalled();
      },
    );

    describe("pending settle", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("settles a pending server to connected", async () => {
        const status = statusSequence(
          [pending("metabase")],
          [pending("metabase")],
          [connected("metabase")],
        );
        const manager = new McpServerManager({ metabase: METABASE_CFG }, makeRegistry());
        manager.bind(okSetMcpServers(), status, okReconnect());

        const promise = manager.attach("metabase");
        await vi.advanceTimersByTimeAsync(1000);

        assert.deepEqual(await promise, { ok: true, alreadyLive: true });
        expect(status).toHaveBeenCalledTimes(3);
      });

      it("times out a server still pending after 10 re-reads as a retryable failure", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status.mockResolvedValue([pending("metabase")]);
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(okSetMcpServers(), status, okReconnect());

        const promise = manager.attach("metabase", METABASE_CFG);
        await vi.advanceTimersByTimeAsync(5000);

        assert.deepEqual(await promise, { ok: false, error: "pending", retryable: true });
        expect(status).toHaveBeenCalledTimes(11);
        assert.deepEqual(manager.attachedNames(), []);
      });

      it("settles after setMcpServers before deciding", async () => {
        const status = statusSequence([], [pending("metabase")], [connected("metabase")]);
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(okSetMcpServers(), status, okReconnect());

        const promise = manager.attach("metabase", METABASE_CFG);
        await vi.advanceTimersByTimeAsync(500);

        assert.deepEqual(await promise, { ok: true, alreadyLive: false });
        assert.deepEqual(manager.attachedNames(), ["metabase"]);
      });

      it("reconnects a pending server that settles to failed", async () => {
        const status = statusSequence(
          [pending("metabase")],
          [failed("metabase", "boom")],
          [connected("metabase")],
        );
        const setMcpServers = okSetMcpServers();
        const reconnect = okReconnect();
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.seedAttached("metabase", METABASE_CFG);
        manager.bind(setMcpServers, status, reconnect);

        const promise = manager.attach("metabase");
        await vi.advanceTimersByTimeAsync(500);

        assert.deepEqual(await promise, { ok: true, alreadyLive: false });
        expect(reconnect).toHaveBeenCalledWith("metabase");
        expect(setMcpServers).not.toHaveBeenCalled();
      });

      it("a registered pending server whose status read throws mid-settle succeeds with no SDK call", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status
          .mockResolvedValueOnce([pending("metabase")])
          .mockRejectedValueOnce(new Error("status transport closed"));
        const setMcpServers = okSetMcpServers();
        const reconnect = okReconnect();
        const manager = new McpServerManager({ metabase: METABASE_CFG }, makeRegistry());
        manager.bind(setMcpServers, status, reconnect);

        const promise = manager.attach("metabase");
        await vi.advanceTimersByTimeAsync(500);

        assert.deepEqual(await promise, { ok: true, alreadyLive: true });
        expect(setMcpServers).not.toHaveBeenCalled();
        expect(reconnect).not.toHaveBeenCalled();
      });
    });

    describe("status known before, unknown after setMcpServers", () => {
      it("a no-error setMcpServers succeeds and records", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status
          .mockResolvedValueOnce([])
          .mockRejectedValueOnce(new Error("status transport closed"));
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(okSetMcpServers(), status, okReconnect());

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: true, alreadyLive: false });
        assert.deepEqual(manager.attachedNames(), ["metabase"]);
      });

      it("a setMcpServers error for the name is a retryable failure, not recorded", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status
          .mockResolvedValueOnce([])
          .mockRejectedValueOnce(new Error("status transport closed"));
        const setMcpServers = vi.fn<SetMcpServersFn>(async () => ({
          added: [],
          removed: [],
          errors: { metabase: "connection refused" },
        }));
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(setMcpServers, status, okReconnect());

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: false, error: "connection refused", retryable: true });
        assert.deepEqual(manager.attachedNames(), []);
      });
    });

    it("serializes concurrent attaches so the second payload keeps the first server", async () => {
      const MONDAY_CFG: McpServerConfig = {
        type: "stdio",
        command: "monday-mcp",
        args: [],
        env: {},
      };
      const status = statusSequence([], [connected("metabase")], [], [connected("monday")]);
      const setMcpServers = okSetMcpServers();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(setMcpServers, status, okReconnect());

      const first = manager.attach("metabase", METABASE_CFG);
      const second = manager.attach("monday", MONDAY_CFG);

      assert.deepEqual(await first, { ok: true, alreadyLive: false });
      assert.deepEqual(await second, { ok: true, alreadyLive: false });
      assert.deepEqual(setMcpServers.mock.calls[1]?.[0], {
        clack: BASELINE_CLACK,
        metabase: METABASE_CFG,
        monday: MONDAY_CFG,
      });
      assert.deepEqual(manager.attachedNames().sort(), ["metabase", "monday"]);
    });

    describe("status unknown before acting", () => {
      function throwingStatus(): Mock<McpServerStatusFn> {
        return vi.fn<McpServerStatusFn>(async () => {
          throw new Error("status transport closed");
        });
      }

      it("registered server succeeds with no SDK call and a warning", async () => {
        const setMcpServers = okSetMcpServers();
        const reconnect = okReconnect();
        const manager = new McpServerManager({ metabase: METABASE_CFG }, makeRegistry());
        manager.bind(setMcpServers, throwingStatus(), reconnect);

        const result = await manager.attach("metabase");

        assert.deepEqual(result, { ok: true, alreadyLive: true });
        expect(setMcpServers).not.toHaveBeenCalled();
        expect(reconnect).not.toHaveBeenCalled();
        assert.ok(warn.mock.calls.some((c) => String(c[0]).includes("'metabase'")));
      });

      it("unregistered server: setMcpServers with no error succeeds and records", async () => {
        const setMcpServers = okSetMcpServers();
        const status = throwingStatus();
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(setMcpServers, status, okReconnect());

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: true, alreadyLive: false });
        expect(setMcpServers).toHaveBeenCalledTimes(1);
        assert.deepEqual(manager.attachedNames(), ["metabase"]);
        expect(status).toHaveBeenCalledTimes(1);
      });

      it("unregistered server: setMcpServers error is a retryable failure with its text", async () => {
        const setMcpServers = vi.fn<SetMcpServersFn>(async () => ({
          added: [],
          removed: [],
          errors: { metabase: "connection refused" },
        }));
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(setMcpServers, throwingStatus(), okReconnect());

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: false, error: "connection refused", retryable: true });
        assert.deepEqual(manager.attachedNames(), []);
      });
    });

    describe("status known before, unknown after a reconnect", () => {
      it("a resolved reconnect succeeds with a warning", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status
          .mockResolvedValueOnce([failed("metabase", "boom")])
          .mockRejectedValueOnce(new Error("status transport closed"));
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(okSetMcpServers(), status, okReconnect());

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: true, alreadyLive: false });
        assert.deepEqual(manager.attachedNames(), ["metabase"]);
        assert.ok(warn.mock.calls.some((c) => String(c[0]).includes("unreadable after")));
      });

      it("a thrown reconnect is a retryable failure", async () => {
        const status = vi.fn<McpServerStatusFn>();
        status.mockResolvedValueOnce([failed("metabase", "boom")]);
        const reconnect = vi.fn<ReconnectMcpServerFn>(async () => {
          throw new Error("reconnect exploded");
        });
        const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
        manager.bind(okSetMcpServers(), status, reconnect);

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: false, error: "reconnect exploded", retryable: true });
        assert.deepEqual(manager.attachedNames(), []);
      });
    });

    describe("session-start servers", () => {
      it("are never added to attached after a reconnect", async () => {
        const manager = new McpServerManager({ metabase: METABASE_CFG }, makeRegistry());
        manager.bind(
          okSetMcpServers(),
          statusSequence([failed("metabase")], [connected("metabase")]),
          okReconnect(),
        );

        const result = await manager.attach("metabase", METABASE_CFG);

        assert.deepEqual(result, { ok: true, alreadyLive: false });
        assert.deepEqual(manager.attachedNames(), []);
      });

      it("are re-sent with their held config and never added to attached when absent", async () => {
        const setMcpServers = okSetMcpServers();
        const manager = new McpServerManager({ metabase: METABASE_CFG }, makeRegistry());
        manager.bind(setMcpServers, statusSequence([], [connected("metabase")]), okReconnect());

        const result = await manager.attach("metabase");

        assert.deepEqual(result, { ok: true, alreadyLive: false });
        expect(setMcpServers).toHaveBeenCalledWith({ metabase: METABASE_CFG });
        assert.deepEqual(manager.attachedNames(), []);
      });
    });

    it("incident sequence: a timeout then a no-error resend that stays failed never succeeds", async () => {
      const setMcpServers = vi.fn<SetMcpServersFn>();
      setMcpServers.mockResolvedValueOnce({
        added: [],
        removed: [],
        errors: { metabase: "connect timeout" },
      });
      const reconnect = okReconnect();
      const manager = new McpServerManager({ clack: BASELINE_CLACK }, makeRegistry());
      manager.bind(
        setMcpServers,
        statusSequence(
          [],
          [failed("metabase", "connect timeout")],
          [failed("metabase", "connect timeout")],
          [failed("metabase", "connect timeout")],
        ),
        reconnect,
      );

      const first = await manager.attach("metabase", METABASE_CFG);
      const second = await manager.attach("metabase", METABASE_CFG);

      const expected = { ok: false, error: "failed: connect timeout", retryable: true };
      assert.deepEqual(first, expected);
      assert.deepEqual(second, expected);
      expect(setMcpServers).toHaveBeenCalledTimes(1);
      expect(reconnect).toHaveBeenCalledWith("metabase");
      assert.deepEqual(manager.attachedNames(), []);
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
      ensureSessionDownloadsDir: vi.fn(async (id: string) => `/downloads/${id}`),
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

  it("keeps a persisted name whose load throws when rewriting out a stale one", async () => {
    const deps = makeDeps({
      loadMcpServer: vi.fn(async (name: string) => {
        if (name === "metabase") throw new Error("boom");
        return undefined;
      }),
    });
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    await prepareMcpSession(
      makeSetupSession({ attachedIntegrations: ["gone", "metabase"] }),
      config,
      [],
      deps,
    );

    expect(deps.updateSession).toHaveBeenCalledWith("s1", { attachedIntegrations: ["metabase"] });
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

  it("resolves the session downloads placeholder in always-on, resumed and pre-attached configs", async () => {
    function placeholderCfg(name: string): McpStdioServerConfig {
      return {
        type: "stdio",
        command: `${name}-mcp`,
        args: [],
        env: { OUT: "${CLACK_SESSION_DOWNLOADS_DIR}" },
      };
    }
    const deps = makeDeps({
      loadAlwaysOnMcpServers: vi.fn(async () => ({ github: placeholderCfg("github") })),
      loadMcpServer: vi.fn(async (name: string) => placeholderCfg(name)),
    });
    const setup = await prepareMcpSession(
      makeSetupSession({ sessionId: "sess-9", attachedIntegrations: ["sentry"] }),
      config,
      ["metabase"],
      deps,
    );

    expect(deps.ensureSessionDownloadsDir).toHaveBeenCalledWith("sess-9");
    const resolved = (name: string): McpServerConfig => ({
      ...placeholderCfg(name),
      env: { OUT: "/downloads/sess-9" },
    });
    assert.deepEqual(setup.alwaysOnExternals, { github: resolved("github") });
    assert.deepEqual(setup.resumedAttached, { sentry: resolved("sentry") });
    assert.deepEqual(setup.preAttached, { metabase: resolved("metabase") });
  });

  it("still resolves the placeholder, with a warning, when the session folder can't be created", async () => {
    const deps = makeDeps({
      loadAlwaysOnMcpServers: vi.fn(async () => ({
        github: { ...stdioCfg("github"), env: { OUT: "${CLACK_SESSION_DOWNLOADS_DIR}" } },
      })),
      ensureSessionDownloadsDir: vi.fn(async () => {
        throw new Error("ENOSPC");
      }),
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const setup = await prepareMcpSession(
      makeSetupSession({ sessionId: "sess-9" }),
      config,
      [],
      deps,
    );

    const expected = join(getDownloadsDir(), "sess-9");
    assert.deepEqual(setup.alwaysOnExternals, {
      github: { ...stdioCfg("github"), env: { OUT: expected } },
    });
    assert.ok(warn.mock.calls.some((c) => String(c[0]).includes("ENOSPC")));
  });

  it("gives the manager the session downloads dir for later attaches", async () => {
    const deps = makeDeps();
    const setup = await prepareMcpSession(
      makeSetupSession({ sessionId: "sess-2" }),
      config,
      [],
      deps,
    );
    const setMcpServers = okSetMcpServers();
    setup.manager.bind(setMcpServers);

    await setup.manager.attach("metabase", {
      type: "http",
      url: "https://x",
      headers: { "X-Dir": "${CLACK_SESSION_DOWNLOADS_DIR}" },
    });

    assert.deepEqual(setMcpServers.mock.calls[0]?.[0].metabase, {
      type: "http",
      url: "https://x",
      headers: { "X-Dir": "/downloads/sess-2" },
    });
  });
});
