import { describe, it, expect, vi } from "vitest";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { createAttachIntegrationTool, type AttachIntegrationDeps } from "./attachIntegration.js";
import { toolResultText } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { McpServerRegistry, RepositoryConfig } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import { McpServerManager, type AttachResult } from "../../claude/mcpServerManager.js";

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

const REGISTRY: McpServerRegistry = {
  metabase: { alwaysLoad: false, description: "Metabase dashboards and questions" },
};

const METABASE_CFG: McpServerConfig = { type: "stdio", command: "metabase-mcp", args: [], env: {} };
const PLUGIN_SERVER: McpServerConfig = { type: "stdio", command: "plugin-mcp", args: [], env: {} };

const TOOLS_NOTE = [
  "Its tools are now registered.",
  "Call ToolSearch to surface them and use them to continue your work in THIS turn —",
  'do not end your turn waiting for a "next turn".',
].join(" ");
const RETRY_MAY_HELP = "Retrying attach_integration may help.";
const RETRY_WILL_NOT_HELP =
  "Retrying will not help — stop using this integration and tell the user it is unavailable right now.";
const ALREADY_LOADED = "tools it provides are already loaded";
const LIVE: AttachResult = { ok: true, alreadyLive: true };
const MADE_LIVE: AttachResult = { ok: true, alreadyLive: false };

type LoadMcpServerFn = AttachIntegrationDeps["loadMcpServer"];
type ResolveTopicFilesFn = AttachIntegrationDeps["resolveTopicFiles"];
type RecordMcpAttachFn = AttachIntegrationDeps["recordMcpAttach"];
type BuildVirtualDefaultsFn = AttachIntegrationDeps["buildVirtualDefaults"];

interface Setup {
  /** Registry state of the name: unknown, known but never handed to the SDK, or registered. */
  state: "unknown" | "unregistered" | "sessionStart" | "dynamic";
  attach?: AttachResult;
  integrationServer?: McpServerConfig;
  preAttached?: string[];
  session?: SessionContext;
  deps?: Partial<AttachIntegrationDeps>;
}

/**
 * The manager is a deep mock of the real class (its own behavior is covered by
 * `mcpServerManager.test.ts`); each test programs the answers its claim depends on.
 */
function setup(opts: Setup) {
  const manager = vi.mockObject(new McpServerManager({}, REGISTRY));
  manager.knowsServer.mockReturnValue(opts.state !== "unknown");
  manager.isRegistered.mockReturnValue(opts.state === "sessionStart" || opts.state === "dynamic");
  manager.isInSessionStart.mockReturnValue(opts.state === "sessionStart");
  manager.knownNames.mockReturnValue(["metabase", "scheduling-only"]);
  if (opts.attach) manager.attach.mockResolvedValue(opts.attach);
  if (opts.integrationServer) manager.getIntegrationServer.mockReturnValue(opts.integrationServer);

  const loadMcpServer = vi.fn<LoadMcpServerFn>(async (name: string) =>
    name === "metabase" ? METABASE_CFG : undefined,
  );
  const resolveTopicFiles = vi.fn<ResolveTopicFilesFn>(
    (_roleChain, topic) => `Topic instructions for ${topic}`,
  );
  const recordMcpAttach = vi.fn<RecordMcpAttachFn>(async () => null);
  const buildVirtualDefaults = vi.fn<BuildVirtualDefaultsFn>(() => undefined);
  const deps: AttachIntegrationDeps = {
    loadMcpServer,
    resolveTopicFiles,
    recordMcpAttach,
    buildVirtualDefaults,
    ...opts.deps,
  };

  const ctx: QueryToolContext = {
    mode: "query",
    userId: "U123",
    role: "dev",
    session: opts.session ?? makeSession(),
    config: { repositories: [] as RepositoryConfig[] } as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    mcpManager: manager,
    ...(opts.preAttached && { preAttachedTopics: opts.preAttached }),
  };

  const run = async (name: string) => {
    const toolDef = createAttachIntegrationTool(ctx, deps);
    const result = await toolDef.handler({ name }, { sessionId: "test" });
    return { result, text: toolResultText(result) };
  };
  const lastRecord = () => {
    const calls = vi.mocked(deps.recordMcpAttach).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [sessionId, entry, attachedName] = calls[calls.length - 1]!;
    return { sessionId, entry, attachedName };
  };
  return { manager, deps, loadMcpServer, resolveTopicFiles, recordMcpAttach, run, lastRecord };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attach_integration tool", () => {
  it("returns error when mcpManager is absent (bug guard)", async () => {
    const toolDef = createAttachIntegrationTool({
      mode: "query",
      userId: "U123",
      role: "dev",
      session: makeSession(),
      config: { repositories: [] as RepositoryConfig[] } as QueryToolContext["config"],
      changesWorkflowEnabled: false,
      cronUserSchedules: false,
    });
    const result = await toolDef.handler({ name: "metabase" }, { sessionId: "test" });

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("not available");
  });

  it("returns error for an unknown integration name and lists available ones", async () => {
    const t = setup({ state: "unknown" });

    const { result, text } = await t.run("nonexistent");

    expect(result.isError).toBe(true);
    expect(text).toContain(
      "Unknown integration: nonexistent. Available integrations: metabase, scheduling-only.",
    );
    expect(t.manager.attach).not.toHaveBeenCalled();
    expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
  });

  describe("unregistered names", () => {
    it("attaches an MCP-backed integration with its config and returns the tools note and instructions", async () => {
      const t = setup({ state: "unregistered", attach: MADE_LIVE });

      const { text } = await t.run("metabase");

      expect(text).toBe(
        `Attached integration: metabase. ${TOOLS_NOTE}\n\nTopic instructions for metabase`,
      );
      expect(t.loadMcpServer).toHaveBeenCalledWith("metabase");
      expect(t.manager.attach).toHaveBeenCalledWith("metabase", METABASE_CFG);
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.lastRecord().attachedName).toBe("metabase");
      expect(t.lastRecord().entry.outcome).toBe("ok");
    });

    it("attaches a plugin-registered on-demand server resolved from the manager's integration servers", async () => {
      const t = setup({
        state: "unregistered",
        attach: MADE_LIVE,
        integrationServer: PLUGIN_SERVER,
      });

      const { text } = await t.run("myplugin:topic");

      expect(text).toContain(`Attached integration: myplugin:topic. ${TOOLS_NOTE}`);
      expect(t.loadMcpServer).toHaveBeenCalledWith("myplugin:topic");
      expect(t.manager.attach).toHaveBeenCalledWith("myplugin:topic", PLUGIN_SERVER);
      expect(t.lastRecord().entry.outcome).toBe("ok");
    });

    it("attaches an instructions-only integration without calling the manager's attach", async () => {
      const t = setup({ state: "unregistered" });

      const { text } = await t.run("response-rendering");

      expect(text).toContain("Attached integration: response-rendering. Instructions loaded.");
      expect(text).toContain("has no callable tools");
      expect(text).toContain("Topic instructions for response-rendering");
      expect(t.resolveTopicFiles.mock.calls[0]![1]).toBe("response-rendering");
      expect(t.manager.attach).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("response-rendering");
      expect(t.lastRecord().attachedName).toBe("response-rendering");
      expect(t.lastRecord().entry.outcome).toBe("instructions_only");
    });

    it.each([
      ["no server", "scheduling-only", undefined, "nothing arrives"],
      ["a server", "metabase", MADE_LIVE, "No topic instructions were resolved"],
    ])("handles no topic instructions with %s", async (_label, name, attach, expected) => {
      const t = setup({
        state: "unregistered",
        attach,
        deps: { resolveTopicFiles: vi.fn<ResolveTopicFilesFn>(() => "") },
      });

      const { text } = await t.run(name);

      expect(text).toContain(expected);
    });

    it("passes virtualDefaults to resolveTopicFiles so plugin-registered topic instructions resolve", async () => {
      const sentinel = new Map();
      const t = setup({
        state: "unregistered",
        deps: {
          buildVirtualDefaults: vi.fn<BuildVirtualDefaultsFn>(() => sentinel),
          resolveTopicFiles: vi.fn<ResolveTopicFilesFn>((_roleChain, topic, vd) =>
            vd === sentinel ? `body for ${topic}` : "",
          ),
        },
      });

      const { text } = await t.run("trivia:management");

      expect(text).toContain("body for trivia:management");
    });

    it.each([
      ["retryable", { ok: false, error: "failed: refused", retryable: true }, RETRY_MAY_HELP],
      ["non-retryable", { ok: false, error: "needs-auth", retryable: false }, RETRY_WILL_NOT_HELP],
    ] satisfies [string, AttachResult, string][])(
      "returns a %s failure and persists nothing but history",
      async (_label, attach, sentence) => {
        const t = setup({ state: "unregistered", attach });

        const { result, text } = await t.run("metabase");

        expect(result.isError).toBe(true);
        expect(text).toContain(
          `Failed to attach metabase: ${attach.ok ? "" : attach.error} ${sentence}`,
        );
        expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
        expect(t.recordMcpAttach).toHaveBeenCalledTimes(1);
        expect(t.lastRecord().attachedName).toBeUndefined();
        expect(t.lastRecord().entry).toMatchObject({
          outcome: "failed",
          error: attach.ok ? "" : attach.error,
        });
      },
    );

    it("returns a failed attach when loading the server config throws", async () => {
      const t = setup({
        state: "unregistered",
        deps: {
          loadMcpServer: vi.fn<LoadMcpServerFn>(async () => {
            throw new Error("token mint failed");
          }),
        },
      });

      const { result, text } = await t.run("metabase");

      expect(result.isError).toBe(true);
      expect(text).toContain(`Failed to attach metabase: token mint failed ${RETRY_MAY_HELP}`);
      expect(t.manager.attach).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
      expect(t.lastRecord().entry.outcome).toBe("failed");
    });

    it("records an attach of an unregistered name the manager reports already live", async () => {
      const t = setup({ state: "unregistered", attach: LIVE });

      const { text } = await t.run("metabase");

      expect(text).toBe(
        `Attached integration: metabase. ${TOOLS_NOTE}\n\nTopic instructions for metabase`,
      );
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.recordMcpAttach).toHaveBeenCalledWith(
        "sess-1",
        expect.objectContaining({ name: "metabase", outcome: "ok" }),
        "metabase",
      );
    });

    it("still returns success when persistence throws — the attach itself succeeded", async () => {
      const t = setup({
        state: "unregistered",
        attach: MADE_LIVE,
        deps: {
          recordMcpAttach: vi.fn<RecordMcpAttachFn>(async () => {
            throw new Error("disk full");
          }),
        },
      });

      const { result, text } = await t.run("metabase");

      expect(result.isError).not.toBe(true);
      expect(text).toContain("Attached integration: metabase.");
    });
  });

  describe("registered names", () => {
    it.each([
      ["dynamic", "Integration already attached: metabase. No additional action taken."],
      [
        "sessionStart",
        "Integration metabase is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly.",
      ],
    ] as const)("a live %s server gets a no-op message", async (state, expected) => {
      const t = setup({ state, attach: LIVE });

      const { text } = await t.run("metabase");

      expect(text).toBe(expected);
      expect(t.manager.attach).toHaveBeenCalledWith("metabase");
      expect(t.loadMcpServer).not.toHaveBeenCalled();
      expect(t.resolveTopicFiles).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.recordMcpAttach).toHaveBeenCalledTimes(1);
      expect(t.lastRecord().attachedName).toBeUndefined();
      expect(t.lastRecord().entry.outcome).toBe("duplicate");
    });

    it("a recovered session-start server gets the tools note with instructions", async () => {
      const t = setup({ state: "sessionStart", attach: MADE_LIVE });

      const { text } = await t.run("metabase");

      expect(text).toBe(
        `Attached integration: metabase. ${TOOLS_NOTE}\n\nTopic instructions for metabase`,
      );
      expect(t.manager.attach).toHaveBeenCalledWith("metabase");
      expect(t.loadMcpServer).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.lastRecord().attachedName).toBe("metabase");
      expect(t.lastRecord().entry.outcome).toBe("ok");
    });

    it("a recovered dynamic server gets the tools note without instructions", async () => {
      const t = setup({ state: "dynamic", attach: MADE_LIVE });

      const { text } = await t.run("metabase");

      expect(text).toBe(`Attached integration: metabase. ${TOOLS_NOTE}`);
      expect(t.resolveTopicFiles).not.toHaveBeenCalled();
      expect(t.loadMcpServer).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.lastRecord().entry.outcome).toBe("ok");
    });

    it("a server that cannot be made live gets the failure result", async () => {
      const t = setup({
        state: "sessionStart",
        attach: { ok: false, error: "failed: boom", retryable: true },
      });

      const { result, text } = await t.run("metabase");

      expect(result.isError).toBe(true);
      expect(text).toContain(`Failed to attach metabase: failed: boom ${RETRY_MAY_HELP}`);
      expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
      expect(t.lastRecord().attachedName).toBeUndefined();
    });
  });

  describe("pre-attached names", () => {
    it.each([
      ["unknown to the registry", "unknown", "my-plugin-topic"],
      ["known with no server behind it", "unregistered", "response-rendering"],
    ] as const)("is a no-op for a topic %s", async (_label, state, name) => {
      const t = setup({ state, preAttached: [name] });

      const { result, text } = await t.run(name);

      expect(result.isError).not.toBe(true);
      expect(text).toContain("pre-attached at session start");
      expect(text).not.toContain(`Topic instructions for ${name}`);
      expect(t.resolveTopicFiles).not.toHaveBeenCalled();
      expect(t.manager.attach).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith(name);
      expect(t.lastRecord().entry.outcome).toBe("duplicate");
    });

    it("is a no-op for a plugin on-demand server, which loaded under its SDK server name", async () => {
      const t = setup({
        state: "unregistered",
        integrationServer: PLUGIN_SERVER,
        preAttached: ["trivia:foo"],
      });

      const { text } = await t.run("trivia:foo");

      expect(text).toContain("pre-attached at session start");
      expect(t.manager.attach).not.toHaveBeenCalled();
      expect(t.manager.getIntegrationServer).not.toHaveBeenCalled();
    });

    it("says 'already loaded' for a registered server the manager reports live", async () => {
      const t = setup({ state: "sessionStart", attach: LIVE, preAttached: ["metabase"] });

      const { text } = await t.run("metabase");

      expect(text).toContain(ALREADY_LOADED);
      expect(t.manager.attach).toHaveBeenCalledWith("metabase");
      expect(t.loadMcpServer).not.toHaveBeenCalled();
      expect(t.resolveTopicFiles).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.lastRecord().entry.outcome).toBe("duplicate");
    });

    it.each([
      ["a registered server that was not live", "sessionStart", ["metabase"]],
      ["a server whose pre-load failed", "unregistered", ["metabase", METABASE_CFG]],
    ] as const)("recovers %s with the tools note only", async (_label, state, attachArgs) => {
      const t = setup({ state, attach: MADE_LIVE, preAttached: ["metabase"] });

      const { text } = await t.run("metabase");

      expect(t.manager.attach).toHaveBeenCalledWith(...attachArgs);
      expect(text).toBe(`Attached integration: metabase. ${TOOLS_NOTE}`);
      expect(t.resolveTopicFiles).not.toHaveBeenCalled();
      expect(t.loadMcpServer).toHaveBeenCalledTimes(state === "unregistered" ? 1 : 0);
      expect(t.manager.recordTopicAttached).toHaveBeenCalledWith("metabase");
      expect(t.lastRecord().attachedName).toBe("metabase");
      expect(t.lastRecord().entry.outcome).toBe("ok");
    });

    it("never says 'already loaded' when the server cannot be made live", async () => {
      const t = setup({
        state: "sessionStart",
        attach: { ok: false, error: "failed: connect timeout", retryable: true },
        preAttached: ["metabase"],
      });

      const { result, text } = await t.run("metabase");

      expect(result.isError).toBe(true);
      expect(text).toContain(
        `Failed to attach metabase: failed: connect timeout ${RETRY_MAY_HELP}`,
      );
      expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
      expect(t.lastRecord().attachedName).toBeUndefined();
      expect(t.lastRecord().entry.outcome).toBe("failed");
    });

    it("returns a failed attach, without attaching, when the recovery config load throws", async () => {
      const t = setup({
        state: "unregistered",
        preAttached: ["metabase"],
        deps: {
          loadMcpServer: vi.fn<LoadMcpServerFn>(async () => {
            throw new Error("token mint failed");
          }),
        },
      });

      const { result, text } = await t.run("metabase");

      expect(result.isError).toBe(true);
      expect(text).toContain(`Failed to attach metabase: token mint failed ${RETRY_MAY_HELP}`);
      expect(t.manager.attach).not.toHaveBeenCalled();
      expect(t.manager.recordTopicAttached).not.toHaveBeenCalled();
      expect(t.lastRecord().entry.outcome).toBe("failed");
    });
  });
});
