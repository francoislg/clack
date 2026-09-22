import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { OwnerNotifierDeps } from "../slack/ownerDm.js";
import {
  findUnlistableToolServers,
  reportUnlistableToolServers,
  type ToolServer,
} from "./servedToolsCheck.js";

function toolServer(name: string): ToolServer {
  return { name, server: createSdkMcpServer({ name, version: "1.0.0", tools: [] }) };
}

describe("findUnlistableToolServers", () => {
  it("reports only the servers whose listing throws, with the error", async () => {
    const healthy = toolServer("clack");
    const broken = toolServer("trivia:management");
    const list = vi.fn<(server: McpSdkServerConfigWithInstance) => Promise<void>>(async (s) => {
      if (s === broken.server) throw new Error("Cannot read properties of undefined");
    });

    const failures = await findUnlistableToolServers([healthy, broken], list);

    assert.deepEqual(failures, [
      { name: "trivia:management", error: "Cannot read properties of undefined" },
    ]);
    assert.deepEqual(
      list.mock.calls.map(([server]) => server),
      [healthy.server, broken.server],
    );
  });
});

describe("reportUnlistableToolServers", () => {
  let deps: {
    getOwnerUserId: ReturnType<typeof vi.fn<OwnerNotifierDeps["getOwnerUserId"]>>;
    sendOwnerDm: ReturnType<typeof vi.fn<OwnerNotifierDeps["sendOwnerDm"]>>;
  };

  beforeEach(() => {
    deps = {
      getOwnerUserId: vi.fn<OwnerNotifierDeps["getOwnerUserId"]>(async () => "U_OWNER"),
      sendOwnerDm: vi.fn<OwnerNotifierDeps["sendOwnerDm"]>(async () => true),
    };
  });

  it("does nothing when every server lists", async () => {
    await reportUnlistableToolServers([], deps);

    assert.equal(deps.getOwnerUserId.mock.calls.length, 0);
    assert.equal(deps.sendOwnerDm.mock.calls.length, 0);
  });

  it("DMs the owner once, naming each broken server and its error", async () => {
    await reportUnlistableToolServers(
      [
        { name: "trivia:management", error: "boom" },
        { name: "idler", error: "bang" },
      ],
      deps,
    );

    assert.equal(deps.sendOwnerDm.mock.calls.length, 1);
    const [owner, text, options] = deps.sendOwnerDm.mock.calls[0];
    assert.equal(owner, "U_OWNER");
    assert.match(text, /2 tool server\(s\) cannot list their tools/);
    assert.match(text, /`trivia:management`: boom/);
    assert.match(text, /`idler`: bang/);
    assert.deepEqual(options, { suppressUnfurls: true });
  });

  it("skips the DM when no owner is configured", async () => {
    deps.getOwnerUserId.mockResolvedValue(null);

    await reportUnlistableToolServers([{ name: "idler", error: "bang" }], deps);

    assert.equal(deps.sendOwnerDm.mock.calls.length, 0);
  });

  it("swallows an owner-lookup failure", async () => {
    deps.getOwnerUserId.mockRejectedValue(new Error("roles unreadable"));

    await reportUnlistableToolServers([{ name: "idler", error: "bang" }], deps);

    assert.equal(deps.sendOwnerDm.mock.calls.length, 0);
  });
});
