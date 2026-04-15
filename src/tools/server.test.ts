import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition, AnyZodRawShape } from "@anthropic-ai/claude-agent-sdk";
import { buildClackTools, createToolCallRecorder, wrapToolForRecording } from "./server.js";
import type { QueryToolContext } from "./types.js";
import type { Config } from "../config.js";
import type { SessionContext } from "../sessions.js";
import { setLoadedPlugins } from "../plugins/state.js";
import type { PluginLoadResult, RegisteredTool } from "../plugins/sdk.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegisteredPluginTool<T extends AnyZodRawShape>(
  toolDef: SdkMcpToolDefinition<T>,
): RegisteredTool {
  return {
    name: toolDef.name,
    minRole: "member",
    pushTo: (target) => target.push(toolDef as SdkMcpToolDefinition<AnyZodRawShape>),
  };
}

function stubPlugin(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: SdkMcpToolDefinition<any>[],
): PluginLoadResult {
  return {
    name,
    instructions: [],
    tools: tools.map((t) => makeRegisteredPluginTool(t)),
    toolMappings: new Map(),
    mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools }),
    scheduledRequiredTools: [],
  };
}

function makeQueryCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  const session: SessionContext = {
    sessionId: "sess-1",
    channelId: "C1",
    messageTs: "1",
    threadTs: "1",
    userId: "U1",
    originalQuestion: "q",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    triggerType: "scheduled",
    ...overrides.session,
  };
  return {
    mode: "query",
    userId: "U1",
    role: "member",
    session,
    config: {} as Config,
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// wrapToolForRecording
// ---------------------------------------------------------------------------

describe("wrapToolForRecording", () => {
  it("records success under the full MCP-visible name and forwards the return value", async () => {
    const recorder = createToolCallRecorder();
    const inner = tool("ping", "ping test", { msg: z.string() }, async (args) => ({
      content: [{ type: "text" as const, text: `echo:${args.msg}` }],
    }));
    const wrapped = wrapToolForRecording(inner, "mcp__trivia__ping", recorder);

    const out = await wrapped.handler({ msg: "hi" }, {});
    const firstBlock = out.content[0];
    assert.equal(firstBlock.type, "text");
    if (firstBlock.type === "text") {
      assert.equal(firstBlock.text, "echo:hi");
    }

    const history = recorder.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].tool, "mcp__trivia__ping");
    assert.equal((history[0].args as { msg: string }).msg, "hi");
  });

  it("records error outcome and rethrows when the inner handler throws", async () => {
    const recorder = createToolCallRecorder();
    const inner = tool("boom", "fails", { msg: z.string() }, async () => {
      throw new Error("kaboom");
    });
    const wrapped = wrapToolForRecording(inner, "mcp__trivia__boom", recorder);

    await assert.rejects(() => wrapped.handler({ msg: "x" }, {}), /kaboom/);

    const history = recorder.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].tool, "mcp__trivia__boom");
    assert.equal((history[0].result as { error: string }).error, "kaboom");
  });

  it("does not swallow non-Error throws — records stringified value and rethrows", async () => {
    const recorder = createToolCallRecorder();
    const inner = tool("weird", "throws non-error", { msg: z.string() }, async () => {
      throw "string-throw";
    });
    const wrapped = wrapToolForRecording(inner, "mcp__x__weird", recorder);

    await assert.rejects(() => wrapped.handler({ msg: "x" }, {}));
    assert.equal((recorder.getHistory()[0].result as { error: string }).error, "string-throw");
  });
});

// ---------------------------------------------------------------------------
// buildClackTools — query mode
// ---------------------------------------------------------------------------

describe("buildClackTools — query mode", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });

  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  it("returns mcpServers with a `clack` entry", () => {
    const result = buildClackTools(makeQueryCtx());
    assert.ok(result.mcpServers.clack, "clack core server should be present");
    assert.equal(result.mcpServers.clack.name, "clack");
  });

  it("returns one mcpServers entry per loaded plugin", () => {
    const triviaTool = tool("ping", "ping", { msg: z.string() }, async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }));
    setLoadedPlugins({ results: [stubPlugin("trivia", [triviaTool])] });

    const result = buildClackTools(makeQueryCtx());
    assert.ok(result.mcpServers.clack);
    assert.ok(result.mcpServers.trivia, "plugin MCP server should be present");
    assert.equal(result.mcpServers.trivia.name, "trivia");
  });

  it("does not create an MCP server for a plugin with no tools passing the role gate", () => {
    // Plugin registers a tool with higher minRole — a member-role session should drop it.
    const devOnlyTool = tool("dev_tool", "dev only", { msg: z.string() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const plugin = stubPlugin("trivia", [devOnlyTool]);
    // Override the auto-generated registered tool to use a higher role than `member`
    plugin.tools = plugin.tools.map((t) => ({ ...t, minRole: "dev" }));
    setLoadedPlugins({ results: [plugin] });

    const result = buildClackTools(makeQueryCtx({ role: "member" }));
    assert.equal(result.mcpServers.trivia, undefined);
  });

  it("exposes plugin tools in toolNames under the full mcp__<plugin>__<tool> form", () => {
    const triviaTool = tool("submit_answers", "submit", { id: z.string() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    setLoadedPlugins({ results: [stubPlugin("trivia", [triviaTool])] });

    const result = buildClackTools(makeQueryCtx());
    assert.ok(result.toolNames.includes("mcp__trivia__submit_answers"));
  });

  it("logs a warning when requiredTools references unknown tool name(s)", () => {
    const warnFn = mock.method(logger, "warn", () => {});
    try {
      const ctx = makeQueryCtx({ requiredTools: ["mcp__typo__nope"] });
      buildClackTools(ctx);

      const warnings = warnFn.mock.calls.map((c) => String(c.arguments[0] ?? ""));
      const match = warnings.find((w) => w.includes("mcp__typo__nope"));
      assert.ok(match, "expected a warning mentioning the unknown required tool name");
    } finally {
      warnFn.mock.restore();
    }
  });

  it("does NOT warn when every requiredTools name maps to an available tool", () => {
    const submitAnswers = tool("submit_answers", "submit", { id: z.string() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    setLoadedPlugins({ results: [stubPlugin("trivia", [submitAnswers])] });

    const warnFn = mock.method(logger, "warn", () => {});
    try {
      const ctx = makeQueryCtx({ requiredTools: ["mcp__trivia__submit_answers"] });
      buildClackTools(ctx);

      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c.arguments[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(unknownWarnings.length, 0, "no unknown-required-tool warning expected");
    } finally {
      warnFn.mock.restore();
    }
  });

  it("recognizes clack core tool names as valid requiredTools (no unknown warning)", () => {
    // Regression: built-in clack tools (e.g., list_repositories, fetch_channel_messages) were
    // not recorded by the recorder before wrapToolForRecording was applied to every core tool.
    // The diagnostic warning path still needs to treat their full `mcp__clack__<name>` names
    // as known.
    const warnFn = mock.method(logger, "warn", () => {});
    try {
      const ctx = makeQueryCtx({
        requiredTools: ["mcp__clack__list_repositories"],
      });
      buildClackTools(ctx);

      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c.arguments[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(
        unknownWarnings.length,
        0,
        "mcp__clack__list_repositories should be a recognized tool name",
      );
    } finally {
      warnFn.mock.restore();
    }
  });

  it("does NOT warn when requiredTools is undefined or empty", () => {
    const warnFn = mock.method(logger, "warn", () => {});
    try {
      buildClackTools(makeQueryCtx());
      buildClackTools(makeQueryCtx({ requiredTools: [] }));
      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c.arguments[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(unknownWarnings.length, 0);
    } finally {
      warnFn.mock.restore();
    }
  });
});
