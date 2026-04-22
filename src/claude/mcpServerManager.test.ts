import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { McpServerManager } from "./mcpServerManager.js";
import type { SetMcpServersFn } from "../tools/types.js";
import type { McpServerRegistry } from "../config.js";

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

function okSetMcpServers(): ReturnType<typeof mock.fn<SetMcpServersFn>> {
  return mock.fn<SetMcpServersFn>(async () => ({ added: [], removed: [], errors: {} }));
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
      assert.equal(setMcpServers.mock.callCount(), 0);
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
      assert.equal(setMcpServers.mock.callCount(), 0);
    });
  });

  describe("attach", () => {
    it("passes sessionStart + attached + new to setMcpServers", async () => {
      let received: Record<string, McpServerConfig> | undefined;
      const setMcpServers = mock.fn<SetMcpServersFn>(async (servers) => {
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
      const setMcpServers = mock.fn<SetMcpServersFn>(async () => ({
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
      const callsBefore = setMcpServers.mock.callCount();

      const result = await manager.attach("metabase", METABASE_CFG);

      assert.equal(result.ok, true);
      assert.equal(setMcpServers.mock.callCount(), callsBefore);
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
