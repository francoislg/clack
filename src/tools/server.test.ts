import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { toJSONSchema } from "zod/v4/core";
import { WebClient } from "@slack/web-api";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition, AnyZodRawShape } from "@anthropic-ai/claude-agent-sdk";
import {
  buildClackTools,
  createToolCallRecorder,
  wrapToolForRecording,
  shouldAllowSkip,
  shouldAllowAttentionLevel,
  shouldAllowPostTopLevel,
  shouldAllowThreadTitle,
  computeAllowSkip,
  allowsUnacknowledgedSkip,
  isResponseRenderingAttached,
} from "./server.js";
import { McpServerManager } from "../claude/mcpServerManager.js";
import type { QueryToolContext } from "./types.js";
import { makeWorkerCtx } from "./worker/testCtx.js";
import type { Config } from "../config.js";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { SlackRef } from "../slack/slackRefs.js";
import { setLoadedPlugins } from "../plugins-core/state.js";
import type { PluginLoadResult, RegisteredTool } from "../plugins-sdk/sdk.js";
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
    mcpServers: [],
    toolMappings: new Map(),
    mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools }),
    actionHandlers: [],
    viewHandlers: [],
    errors: [],
  };
}

function makeQueryCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  const session: SessionContext = {
    sessionId: "sess-1",
    channelId: "C1",
    messageTs: "1",
    threadTs: "1",
    userId: "U1",
    trigger: { type: "scheduled", prompt: "q" },
    messages: [],
    threadContext: [],
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
    cronUserSchedules: false,
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
    const warnFn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const ctx = makeQueryCtx({ requiredTools: ["mcp__typo__nope"] });
      buildClackTools(ctx);

      const warnings = warnFn.mock.calls.map((c) => String(c[0] ?? ""));
      const match = warnings.find((w) => w.includes("mcp__typo__nope"));
      assert.ok(match, "expected a warning mentioning the unknown required tool name");
    } finally {
      warnFn.mockRestore();
    }
  });

  it("does NOT warn when every requiredTools name maps to an available tool", () => {
    const submitAnswers = tool("submit_answers", "submit", { id: z.string() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    setLoadedPlugins({ results: [stubPlugin("trivia", [submitAnswers])] });

    const warnFn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const ctx = makeQueryCtx({ requiredTools: ["mcp__trivia__submit_answers"] });
      buildClackTools(ctx);

      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(unknownWarnings.length, 0, "no unknown-required-tool warning expected");
    } finally {
      warnFn.mockRestore();
    }
  });

  it("recognizes clack core tool names as valid requiredTools (no unknown warning)", () => {
    // Regression: built-in clack tools (e.g., list_repositories, fetch_channel_messages) were
    // not recorded by the recorder before wrapToolForRecording was applied to every core tool.
    // The diagnostic warning path still needs to treat their full `mcp__clack__<name>` names
    // as known.
    const warnFn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const ctx = makeQueryCtx({
        requiredTools: ["mcp__clack__list_repositories"],
      });
      buildClackTools(ctx);

      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(
        unknownWarnings.length,
        0,
        "mcp__clack__list_repositories should be a recognized tool name",
      );
    } finally {
      warnFn.mockRestore();
    }
  });

  // Regression: a `z.custom(...)` schema inside `submit_response`'s blocks union
  // made Zod v4's `toJSONSchema` throw "Custom types cannot be represented in
  // JSON Schema". Inside the agent SDK that throw bubbles out of the entire
  // `tools/list` handler, so the Clack MCP server reported as connected but
  // exposed ZERO tools. Boot superficially succeeded, but `submit_response`
  // (and every other Clack tool) was missing — see src/index.ts hard-fail guard.
  // This test runs the same JSON-Schema conversion the SDK does at tools/list
  // time, against every registered Clack tool, so any future schema that
  // breaks serialization fails here loudly instead of in production.
  it("every Clack tool's input schema serializes to JSON Schema (regression: tools/list silent failure)", () => {
    // owner role + changesWorkflow enabled exercises every tool that gates on those.
    const result = buildClackTools(makeQueryCtx({ role: "owner", changesWorkflowEnabled: true }));

    // The SDK's tools/list handler reads from `_registeredTools` on the McpServer
    // instance. No public accessor exists. The McpServer type now declares
    // `_registeredTools` as private, so a `value is X` predicate where `X` declares it
    // public reduces the intersection to `never`. We extract via `Reflect.get` to
    // dodge the access modifier mismatch.
    interface RegisteredTool {
      inputSchema: Parameters<typeof toJSONSchema>[0];
    }
    function readRegisteredTools(value: object): Record<string, RegisteredTool> | undefined {
      if (!("_registeredTools" in value)) return undefined;
      const tools = Reflect.get(value, "_registeredTools");
      if (typeof tools !== "object" || tools === null) return undefined;
      const result: Record<string, RegisteredTool> = tools as Record<string, RegisteredTool>;
      return result;
    }

    const clackServer = result.mcpServers.clack;
    const registered = readRegisteredTools(clackServer.instance);
    assert.ok(registered, "expected _registeredTools to be populated");

    const names = Object.keys(registered);
    assert.ok(names.length > 0, "expected the Clack MCP server to register at least one tool");

    for (const name of names) {
      const schema = registered[name].inputSchema;
      assert.doesNotThrow(
        () => toJSONSchema(schema, { io: "input" }),
        `tool "${name}" input schema cannot be converted to JSON Schema — the agent SDK runs this conversion when serving tools/list, and a throw here strips the entire Clack tool registry at runtime`,
      );
    }
  });

  it("does NOT warn when requiredTools is undefined or empty", () => {
    const warnFn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      buildClackTools(makeQueryCtx());
      buildClackTools(makeQueryCtx({ requiredTools: [] }));
      const unknownWarnings = warnFn.mock.calls
        .map((c) => String(c[0] ?? ""))
        .filter((w) => w.includes("Session requiredTools reference unknown"));
      assert.equal(unknownWarnings.length, 0);
    } finally {
      warnFn.mockRestore();
    }
  });

  describe("submit_response schema channelless override", () => {
    interface SubmitResponseShape {
      [key: string]: z.ZodType;
    }
    interface RegisteredToolEntry {
      inputSchema: { shape?: SubmitResponseShape };
    }
    interface RegisteredToolsByName {
      [name: string]: RegisteredToolEntry;
    }
    function readRegisteredTools(value: object): RegisteredToolsByName | null {
      if (!("_registeredTools" in value)) return null;
      const tools = Reflect.get(value, "_registeredTools");
      if (typeof tools !== "object" || tools === null) return null;
      return tools as RegisteredToolsByName;
    }

    function buildChannellessSession(): SessionContext {
      return {
        sessionId: "sess-cl",
        channelId: "channelless:job-cl-1",
        messageTs: "1",
        threadTs: "1",
        userId: "U1",
        trigger: { type: "scheduled", prompt: "q" },
        messages: [],
        threadContext: [],
        errors: [],
        lastActivity: Date.now(),
        createdAt: Date.now(),
        triggerType: "scheduled",
      };
    }

    it("forces submit_response to the 'optional-post-to' shape for channelless sessions even when persisted mode is 'optional'", () => {
      const result = buildClackTools(
        makeQueryCtx({
          session: buildChannellessSession(),
          submitResponseMode: "optional",
        }),
      );

      const registered = readRegisteredTools(result.mcpServers.clack.instance);
      assert.ok(registered, "expected _registeredTools to be populated");
      const submitResponse = registered["submit_response"];
      assert.ok(submitResponse, "submit_response must be registered");

      // Channelless has no bound primary channel: the schema exposes skip_response + deliver_to
      // (each entry names an explicit channel) plus the always-available escalate_to_owner, but
      // NONE of the primary delivery fields and no top-level actions.
      const keys = Object.keys(submitResponse.inputSchema.shape ?? {}).sort();
      assert.deepEqual(
        keys,
        ["deliver_to", "escalate_to_owner", "skip_response"],
        `channelless schema must accept skip_response + deliver_to + escalate_to_owner only — got [${keys.join(", ")}]`,
      );
    });

    it("preserves the persisted submitResponseMode shape for channel-bound sessions (regression)", () => {
      const result = buildClackTools(
        makeQueryCtx({
          session: {
            ...buildChannellessSession(),
            sessionId: "sess-bound",
            channelId: "C123",
          },
          submitResponseMode: "optional",
        }),
      );

      const registered = readRegisteredTools(result.mcpServers.clack.instance);
      assert.ok(registered);
      const submitResponse = registered["submit_response"];
      const keys = Object.keys(submitResponse.inputSchema.shape ?? {});
      assert.ok(
        keys.length > 1 && keys.includes("skip_response"),
        `channel-bound 'optional' mode keeps the full schema with skip_response — got [${keys.join(", ")}]`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// buildClackTools — integration-gated plugin tools
// ---------------------------------------------------------------------------

describe("buildClackTools — integration-gated plugin tools", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });

  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  function pluginWithMixedTopics(): PluginLoadResult {
    const toolA = tool("tool_a", "in foo", { x: z.string().optional() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const toolB = tool("tool_b", "in bar", { x: z.string().optional() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const toolC = tool("tool_c", "default server", { x: z.string().optional() }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const base = stubPlugin("trivia", [toolA, toolB, toolC]);
    // Override registrations: tools A and B live on on-demand servers, tool C on the default.
    base.tools = [
      { ...makeRegisteredPluginTool(toolA), minRole: "admin", serverKey: "foo" },
      { ...makeRegisteredPluginTool(toolB), minRole: "admin", serverKey: "bar" },
      { ...makeRegisteredPluginTool(toolC), minRole: "admin" },
    ];
    base.mcpServers = [
      { key: "foo", fullName: "trivia:foo", autoload: false, description: "foo server" },
      { key: "bar", fullName: "trivia:bar", autoload: false, description: "bar server" },
    ];
    return base;
  }

  function attached(integrations: string[] | undefined): Partial<QueryToolContext> {
    return {
      role: "admin",
      session: {
        sessionId: "sess-1",
        channelId: "C1",
        messageTs: "1",
        threadTs: "1",
        userId: "U1",
        trigger: { type: "scheduled", prompt: "q" },
        messages: [],
        threadContext: [],
        errors: [],
        lastActivity: Date.now(),
        createdAt: Date.now(),
        triggerType: "scheduled",
        ...(integrations !== undefined ? { attachedIntegrations: integrations } : {}),
      },
    };
  }

  it("hides on-demand server tools when attachedIntegrations is empty", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(makeQueryCtx(attached([])));
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), false);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), false);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), true);
  });

  it("reveals on-demand server tools whose integration is attached", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(makeQueryCtx(attached(["trivia:foo"])));
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), true);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), false);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), true);
  });

  it("reveals all on-demand server tools when every integration is attached", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(makeQueryCtx(attached(["trivia:foo", "trivia:bar"])));
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), true);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), true);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), true);
  });

  it("role gate still applies on top — dev role sees nothing for admin-gated tools even with on-demand server attached", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(
      makeQueryCtx({ ...attached(["trivia:foo", "trivia:bar"]), role: "dev" }),
    );
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), false);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), false);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), false);
  });

  it("treats missing attachedIntegrations as empty", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(makeQueryCtx(attached(undefined)));
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), false);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), false);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), true);
  });

  it("reveals on-demand server tools whose integration is a pre-attached topic", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(
      makeQueryCtx({ ...attached([]), preAttachedTopics: ["trivia:foo"] }),
    );
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), true);
    assert.equal(result.toolNames.includes("mcp__trivia_bar__tool_b"), false);
    assert.equal(result.toolNames.includes("mcp__trivia__tool_c"), true);
  });

  it("role gate still applies to pre-attached on-demand servers", () => {
    setLoadedPlugins({ results: [pluginWithMixedTopics()] });
    const result = buildClackTools(
      makeQueryCtx({ ...attached([]), preAttachedTopics: ["trivia:foo"], role: "dev" }),
    );
    assert.equal(result.toolNames.includes("mcp__trivia_foo__tool_a"), false);
  });
});

// ---------------------------------------------------------------------------
// Auto-respond rule tools registration
// ---------------------------------------------------------------------------

describe("buildClackTools — auto-respond rule tools admin gate", () => {
  const AUTO_RESPOND_TOOL_NAMES = [
    "list_auto_respond_rules",
    "add_auto_respond_rule",
    "update_auto_respond_rule",
    "toggle_auto_respond_rule",
    "delete_auto_respond_rule",
  ];

  function stubSlackClient(): WebClient {
    return new WebClient("xoxb-test-token");
  }

  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });

  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  it("registers all five auto-respond rule tools for admin with Slack client", () => {
    const result = buildClackTools(makeQueryCtx({ role: "admin", slackClient: stubSlackClient() }));
    for (const name of AUTO_RESPOND_TOOL_NAMES) {
      assert.ok(
        result.toolNames.includes(name),
        `expected tool "${name}" to be registered for admin`,
      );
    }
  });

  it("does NOT register auto-respond rule tools for non-admin (member, dev)", () => {
    for (const role of ["member", "dev"] as const) {
      const result = buildClackTools(makeQueryCtx({ role, slackClient: stubSlackClient() }));
      for (const name of AUTO_RESPOND_TOOL_NAMES) {
        assert.ok(
          !result.toolNames.includes(name),
          `tool "${name}" must NOT be registered for role "${role}"`,
        );
      }
    }
  });

  it("does NOT register auto-respond rule tools when Slack client is missing", () => {
    const result = buildClackTools(makeQueryCtx({ role: "admin", slackClient: undefined }));
    for (const name of AUTO_RESPOND_TOOL_NAMES) {
      assert.ok(
        !result.toolNames.includes(name),
        `tool "${name}" must NOT register without a Slack client`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Trigger-type gating
// ---------------------------------------------------------------------------

describe("shouldAllowSkip", () => {
  it("allows skip for autoRespond and threadReply", () => {
    assert.equal(shouldAllowSkip("autoRespond"), true);
    assert.equal(shouldAllowSkip("threadReply"), true);
  });

  it("denies skip for mentions, directMessages, reactions, scheduled", () => {
    assert.equal(shouldAllowSkip("mentions"), false);
    assert.equal(shouldAllowSkip("directMessages"), false);
    assert.equal(shouldAllowSkip("reactions"), false);
    assert.equal(shouldAllowSkip("scheduled"), false);
  });

  it("denies skip for undefined triggerType", () => {
    assert.equal(shouldAllowSkip(undefined), false);
  });
});

describe("allowsUnacknowledgedSkip", () => {
  it("waives the skip acknowledgment for scheduled runs", () => {
    assert.equal(allowsUnacknowledgedSkip("scheduled"), true);
  });

  it.each(["autoRespond", "threadReply", "mentions", "directMessages"] as const)(
    "keeps the skip acknowledgment for %s",
    (trigger) => {
      assert.equal(allowsUnacknowledgedSkip(trigger), false);
    },
  );
});

describe("computeAllowSkip", () => {
  it("inherits shouldAllowSkip defaults for autoRespond and threadReply", () => {
    assert.equal(computeAllowSkip("autoRespond"), true);
    assert.equal(computeAllowSkip("threadReply"), true);
  });

  it("allows skip for scheduled runs when skipConditions is set", () => {
    assert.equal(computeAllowSkip("scheduled", "Skip if no merged PRs"), true);
  });

  it("denies skip for scheduled runs without skipConditions", () => {
    assert.equal(computeAllowSkip("scheduled"), false);
    assert.equal(computeAllowSkip("scheduled", ""), false);
    assert.equal(computeAllowSkip("scheduled", undefined), false);
  });

  it("denies skip for other triggers even with skipConditions set", () => {
    // skipConditions is scheduled-only; a stray value on another trigger must not enable skip
    assert.equal(computeAllowSkip("mentions", "Skip if X"), false);
    assert.equal(computeAllowSkip("directMessages", "Skip if X"), false);
    assert.equal(computeAllowSkip("reactions", "Skip if X"), false);
  });

  it('submitResponseMode "always" denies skip regardless of trigger or skipConditions', () => {
    assert.equal(computeAllowSkip("autoRespond", undefined, "always"), false);
    assert.equal(computeAllowSkip("scheduled", "Skip if X", "always"), false);
    assert.equal(computeAllowSkip("threadReply", undefined, "always"), false);
  });

  it('submitResponseMode "optional" allows skip regardless of trigger or skipConditions', () => {
    assert.equal(computeAllowSkip("scheduled", undefined, "optional"), true);
    assert.equal(computeAllowSkip("scheduled", "", "optional"), true);
    assert.equal(computeAllowSkip("mentions", undefined, "optional"), true);
    assert.equal(computeAllowSkip("directMessages", undefined, "optional"), true);
  });

  it('submitResponseMode "skipped" returns allowSkip=true (the variant-selection handles strictness)', () => {
    assert.equal(computeAllowSkip("scheduled", undefined, "skipped"), true);
    assert.equal(computeAllowSkip("scheduled", "Skip if X", "skipped"), true);
    assert.equal(computeAllowSkip("autoRespond", undefined, "skipped"), true);
  });

  it("unset submitResponseMode preserves today's auto-derivation", () => {
    // Same expectations as before — mode unset must be byte-identical to the pre-change behavior
    assert.equal(computeAllowSkip("autoRespond"), true);
    assert.equal(computeAllowSkip("scheduled", "Skip if X"), true);
    assert.equal(computeAllowSkip("scheduled"), false);
    assert.equal(computeAllowSkip("reactions"), false);
  });
});

describe("shouldAllowAttentionLevel", () => {
  it("allows disengage for autoRespond, threadReply, and mentions", () => {
    assert.equal(shouldAllowAttentionLevel("autoRespond"), true);
    assert.equal(shouldAllowAttentionLevel("threadReply"), true);
    assert.equal(shouldAllowAttentionLevel("mentions"), true);
  });

  it("denies disengage for directMessages, reactions, scheduled", () => {
    assert.equal(shouldAllowAttentionLevel("directMessages"), false);
    assert.equal(shouldAllowAttentionLevel("reactions"), false);
    assert.equal(shouldAllowAttentionLevel("scheduled"), false);
  });

  it("denies disengage for undefined triggerType", () => {
    assert.equal(shouldAllowAttentionLevel(undefined), false);
  });
});

describe("shouldAllowPostTopLevel", () => {
  it("allows for autoRespond, threadReply, mentions, reactions", () => {
    assert.equal(shouldAllowPostTopLevel("autoRespond"), true);
    assert.equal(shouldAllowPostTopLevel("threadReply"), true);
    assert.equal(shouldAllowPostTopLevel("mentions"), true);
    assert.equal(shouldAllowPostTopLevel("reactions"), true);
  });

  it("denies for directMessages and scheduled", () => {
    assert.equal(shouldAllowPostTopLevel("directMessages"), false);
    assert.equal(shouldAllowPostTopLevel("scheduled"), false);
  });

  it("denies for undefined triggerType", () => {
    assert.equal(shouldAllowPostTopLevel(undefined), false);
  });
});

describe("shouldAllowThreadTitle", () => {
  it("allows for directMessages only", () => {
    assert.equal(shouldAllowThreadTitle("directMessages"), true);
    assert.equal(shouldAllowThreadTitle("mentions"), false);
    assert.equal(shouldAllowThreadTitle("reactions"), false);
    assert.equal(shouldAllowThreadTitle("scheduled"), false);
    assert.equal(shouldAllowThreadTitle("autoRespond"), false);
    assert.equal(shouldAllowThreadTitle(undefined), false);
  });
});

describe("isResponseRenderingAttached", () => {
  function makeManager() {
    return vi.mockObject(new McpServerManager({}, {}));
  }

  it("is true when response-rendering was pre-attached", () => {
    const manager = makeManager();
    manager.isTopicAttached.mockReturnValue(false);
    const ctx = makeQueryCtx({ mcpManager: manager, preAttachedTopics: ["response-rendering"] });
    assert.equal(isResponseRenderingAttached(ctx), true);
  });

  it("is true when the manager reports the topic attached mid-session", () => {
    const manager = makeManager();
    manager.isTopicAttached.mockReturnValue(true);
    assert.equal(isResponseRenderingAttached(makeQueryCtx({ mcpManager: manager })), true);
    assert.deepEqual(manager.isTopicAttached.mock.calls, [["response-rendering"]]);
  });

  it("is false when neither pre-attached nor attached mid-session", () => {
    const manager = makeManager();
    manager.isTopicAttached.mockReturnValue(false);
    const ctx = makeQueryCtx({ mcpManager: manager, preAttachedTopics: ["metabase"] });
    assert.equal(isResponseRenderingAttached(ctx), false);
  });

  it("is false with no manager", () => {
    assert.equal(isResponseRenderingAttached(makeQueryCtx()), false);
  });
});

describe("buildClackTools — worker mode", () => {
  it("registers git_push and await_ci alongside the other worker tools", () => {
    const result = buildClackTools(makeWorkerCtx());
    for (const name of ["git_push", "await_ci", "ensure_pr", "merge_pr", "report_status"]) {
      assert.ok(result.toolNames.includes(name), `expected worker tool ${name}`);
    }
  });

  it("does not expose record_and_upload in the implement toolbelt", () => {
    const result = buildClackTools(makeWorkerCtx());
    assert.ok(!result.toolNames.includes("record_and_upload"));
  });

  it("includes the memory faculty (remember + recall)", () => {
    const result = buildClackTools(makeWorkerCtx());
    assert.ok(result.toolNames.includes("remember"));
    assert.ok(result.toolNames.includes("recall"));
  });
});

describe("buildClackTools — tester mode (kind: 'test')", () => {
  it("omits every PR/code-mutating worker tool", () => {
    const result = buildClackTools(makeWorkerCtx({ kind: "test" }));
    for (const name of [
      "git_push",
      "ensure_pr",
      "merge_pr",
      "close_pr",
      "await_ci",
      "resolve_review_thread",
      "propose_spinoff",
    ]) {
      assert.ok(!result.toolNames.includes(name), `tester toolbelt must omit ${name}`);
    }
  });

  it("includes report_status and record_and_upload", () => {
    const result = buildClackTools(makeWorkerCtx({ kind: "test" }));
    assert.ok(result.toolNames.includes("report_status"));
    assert.ok(result.toolNames.includes("record_and_upload"));
  });

  it("includes the memory faculty (remember + recall)", () => {
    const result = buildClackTools(makeWorkerCtx({ kind: "test" }));
    assert.ok(result.toolNames.includes("remember"));
    assert.ok(result.toolNames.includes("recall"));
  });

  it("stages no intents", () => {
    const result = buildClackTools(makeWorkerCtx({ kind: "test" }));
    assert.equal(result.getStagedIntents().size, 0);
  });
});

// ---------------------------------------------------------------------------
// Canvas tool registration gating (canvases.mode + canvases.writeRole)
// ---------------------------------------------------------------------------

describe("buildClackTools — canvas tools gating", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });
  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  const CANVAS_TOOLS = ["read_canvas", "create_canvas", "edit_canvas"];

  const registered = (
    canvases: Config["canvases"],
    role: UserRole,
    slackClient: WebClient | undefined = new WebClient("xoxb-test"),
  ): string[] => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { canvases }),
      role,
      slackClient,
    });
    const { toolNames } = buildClackTools(ctx);
    return CANVAS_TOOLS.filter((name) => toolNames.includes(name));
  };

  it("registers no canvas tool when the block is absent", () => {
    assert.deepEqual(registered(undefined, "owner"), []);
  });

  it("registers no canvas tool in off mode", () => {
    assert.deepEqual(registered({ mode: "off" }, "owner"), []);
  });

  it("registers only read_canvas in read mode, even for an owner", () => {
    assert.deepEqual(registered({ mode: "read" }, "owner"), ["read_canvas"]);
  });

  it("registers only read_canvas in write mode below the default dev threshold", () => {
    assert.deepEqual(registered({ mode: "write" }, "member"), ["read_canvas"]);
  });

  it("registers the write tools in write mode at the default dev threshold", () => {
    assert.deepEqual(registered({ mode: "write" }, "dev"), CANVAS_TOOLS);
  });

  it("honors a configured writeRole", () => {
    assert.deepEqual(registered({ mode: "write", writeRole: "admin" }, "dev"), ["read_canvas"]);
    assert.deepEqual(registered({ mode: "write", writeRole: "admin" }, "admin"), CANVAS_TOOLS);
    assert.deepEqual(registered({ mode: "write", writeRole: "member" }, "member"), CANVAS_TOOLS);
  });

  it("registers no canvas tool without a Slack client", () => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { canvases: { mode: "write" } }),
    });
    const { toolNames } = buildClackTools(ctx);
    assert.deepEqual(
      CANVAS_TOOLS.filter((name) => toolNames.includes(name)),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// List tool registration gating (lists.mode + lists.writeRole)
// ---------------------------------------------------------------------------

describe("buildClackTools — List tools gating", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });
  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  const READ_TOOLS = ["read_list", "get_list_item"];
  const LIST_TOOLS = [
    ...READ_TOOLS,
    "add_list_items",
    "update_list_items",
    "delete_list_items",
    "create_list",
  ];

  const registered = (
    lists: Config["lists"],
    role: UserRole,
    slackClient: WebClient | undefined = new WebClient("xoxb-test"),
  ): string[] => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { lists }),
      role,
      slackClient,
    });
    const { toolNames } = buildClackTools(ctx);
    return LIST_TOOLS.filter((name) => toolNames.includes(name));
  };

  it("registers no List tool when the block is absent", () => {
    assert.deepEqual(registered(undefined, "owner"), []);
  });

  it("registers no List tool in off mode", () => {
    assert.deepEqual(registered({ mode: "off" }, "owner"), []);
  });

  it("registers only the read tools in read mode, even for an owner", () => {
    assert.deepEqual(registered({ mode: "read" }, "owner"), READ_TOOLS);
  });

  it("registers only the read tools in write mode below the default dev threshold", () => {
    assert.deepEqual(registered({ mode: "write" }, "member"), READ_TOOLS);
  });

  it("registers the write tools in write mode at the default dev threshold", () => {
    assert.deepEqual(registered({ mode: "write" }, "dev"), LIST_TOOLS);
  });

  it("honors a configured writeRole", () => {
    assert.deepEqual(registered({ mode: "write", writeRole: "admin" }, "dev"), READ_TOOLS);
    assert.deepEqual(registered({ mode: "write", writeRole: "admin" }, "admin"), LIST_TOOLS);
    assert.deepEqual(registered({ mode: "write", writeRole: "member" }, "member"), LIST_TOOLS);
  });

  it("registers no List tool without a Slack client", () => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { lists: { mode: "write" } }),
      role: "owner",
    });
    const { toolNames } = buildClackTools(ctx);
    assert.deepEqual(
      LIST_TOOLS.filter((name) => toolNames.includes(name)),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// view_slack_file registration gating (registry or Slack client)
// ---------------------------------------------------------------------------

describe("buildClackTools — view_slack_file gating", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });
  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  const registryWithOneImage = (): Map<string, SlackRef> =>
    new Map<string, SlackRef>([
      [
        "F1",
        {
          type: "file",
          id: "F1",
          kind: "image",
          label: "Image",
          reader: "view_slack_file",
          mustOpen: true,
          fromCurrentMessage: true,
          name: "shot.png",
        },
      ],
    ]);

  it("registers view_slack_file with a non-empty registry and no Slack client", () => {
    const ctx = makeQueryCtx({ availableRefs: registryWithOneImage(), slackClient: undefined });
    assert.ok(buildClackTools(ctx).toolNames.includes("view_slack_file"));
  });

  it("registers view_slack_file with a Slack client and an empty registry", () => {
    const ctx = makeQueryCtx({ availableRefs: new Map(), slackClient: new WebClient("xoxb-test") });
    assert.ok(buildClackTools(ctx).toolNames.includes("view_slack_file"));
  });

  it("omits view_slack_file with neither a registry entry nor a Slack client", () => {
    const ctx = makeQueryCtx({ availableRefs: new Map(), slackClient: undefined });
    assert.equal(buildClackTools(ctx).toolNames.includes("view_slack_file"), false);
  });
});

// ---------------------------------------------------------------------------
// search_messages registration gating (allowPublicSearch)
// ---------------------------------------------------------------------------

describe("buildClackTools — search_messages gating", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });
  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  const withClient = () => new WebClient("xoxb-test");

  it("omits search_messages when allowPublicSearch is off, even with a Slack client", () => {
    const ctx = makeQueryCtx({
      config: {} as Config,
      slackClient: withClient(),
    });
    const result = buildClackTools(ctx);
    assert.equal(result.toolNames.includes("search_messages"), false);
  });

  it("registers search_messages when allowPublicSearch is on and a Slack client is present", () => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { allowPublicSearch: true }),
      slackClient: withClient(),
      actionToken: "AT-1",
    });
    const result = buildClackTools(ctx);
    assert.ok(result.toolNames.includes("search_messages"));
  });

  it("omits search_messages when the flag is on but there is no Slack client", () => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { allowPublicSearch: true }),
    });
    const result = buildClackTools(ctx);
    assert.equal(result.toolNames.includes("search_messages"), false);
  });

  it("still registers search_messages (degraded) when the flag is on but no action_token", () => {
    const ctx = makeQueryCtx({
      config: Object.assign({} as Config, { allowPublicSearch: true }),
      slackClient: withClient(),
    });
    const result = buildClackTools(ctx);
    assert.ok(result.toolNames.includes("search_messages"));
  });
});
