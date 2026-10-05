import { describe, it, beforeAll, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { TriggerType } from "../changes/types.js";
import { McpServerManager } from "../claude/mcpServerManager.js";
import { SkillsManager } from "../claude/skillsManager.js";
import type { Config } from "../config.js";
import { validateConfig } from "../configZod.js";
import { BUILTIN_PLUGINS, loadPlugins, type LoadedPlugins } from "../plugins-core/registry.js";
import { setLoadedPlugins } from "../plugins-core/state.js";
import type { ClackSdkDeps } from "../plugins-sdk/sdk.js";
import type { SessionContext } from "../sessions.js";
import { createSlackClientMock } from "../slack/testSlackClient.js";
import { buildQueryContext, buildWorkerContext, type BuildQueryContextParams } from "./context.js";
import { buildClackTools } from "./server.js";
import { collectToolServers, findUnlistableToolServers } from "./servedToolsCheck.js";
import {
  argsFromSchema,
  schemaNode,
  type ArgsMode,
  type SchemaNode,
} from "./testArgsFromSchema.js";
import type { DeliverFn, DeliveryControl } from "./types.js";

// Proves every served tool's ADVERTISED input schema agrees with the validator enforcing it.
// Both the `tools/list` JSON and the `tools/call` validation come from the Agent SDK's bundled
// MCP server, running a different zod copy over our schemas — so a shape can list cleanly yet
// reject what it advertises (a `.default()` field rejected as "nonoptional", a `z.preprocess`
// field enforced but never listed as required), or crash the listing and hide every tool on
// its server (`z.record`). Every toolset is built with every gate open, and each tool is called
// with args generated purely from its served schema. Handlers are swapped for a stub at server
// creation, so the calls exercise the schema layer only — never a tool's side effects.

const served = vi.hoisted(() => ({
  stubText: "STUB_HANDLER_OK",
  servers: new Array<{ name: string; config: McpSdkServerConfigWithInstance }>(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    createSdkMcpServer: (options: Parameters<typeof actual.createSdkMcpServer>[0]) => {
      const config = actual.createSdkMcpServer({
        ...options,
        tools: options.tools?.map((definition) => ({
          ...definition,
          handler: async () => ({ content: [{ type: "text" as const, text: served.stubText }] }),
        })),
      });
      served.servers.push({ name: options.name, config });
      return config;
    },
  };
});

const TRIGGERS: TriggerType[] = [
  "directMessages",
  "mentions",
  "reactions",
  "autoRespond",
  "scheduled",
  "threadReply",
  "channelReply",
];

const SUBMIT_RESPONSE_MODES: Array<BuildQueryContextParams["submitResponseMode"]> = [
  undefined,
  "always",
  "optional",
  "optional-post-to",
  "skipped",
];

// Tools behind every gate the builders have: if the fixture stops opening one, its tools
// silently drop out of the sweep — these fail the coverage check instead.
const GATED_SENTINELS = [
  "clack/submit_response",
  "clack/git_push",
  "clack/record_and_upload",
  "clack/search_messages",
  "clack/attach_integration",
  "clack/load_skill",
  "clack/switch_delivery_context",
  "clack/start_investigation",
  "clack/edit_canvas",
  "clack/delete_list_items",
  "clack/create_scheduled_message",
  "clack/propose_skill_create",
  "clack/run_test",
  "trivia/check_season_status",
  "trivia_management/upsert_season",
];

interface ServedTool {
  server: string;
  name: string;
  schema: SchemaNode;
  client: Client;
}

function allGatesConfig(): Config {
  return validateConfig(
    {
      repositories: [],
      allowPublicSearch: true,
      investigations: { enabled: true },
      canvases: { mode: "write" },
      lists: { mode: "write" },
      tester: {
        enabled: true,
        sidecarUrl: "http://localhost:8931/mcp",
        recordingsDir: "data/tester/recordings",
      },
      userSkills: { enabled: true },
      cron: { userSchedules: true },
      changesWorkflow: { enabled: true },
    },
    { botToken: "xoxb-test", appToken: "xapp-test", signingSecret: "test-signing-secret" },
  );
}

function sessionFor(triggerType: TriggerType): SessionContext {
  return {
    sessionId: "served-tool-schemas",
    channelId: "C_TEST",
    messageTs: "1111.2222",
    threadTs: "1111.2222",
    userId: "U_TEST",
    triggerType,
    trigger: { type: "mentions", userId: "U_TEST", messageTs: "1111.2222", messageText: "x" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
  };
}

// Plugin install must not reach the real cron store under `data/state/`.
function isolatedSdkDeps(): Partial<ClackSdkDeps> {
  return {
    getSlackClient: () => null,
    findByPluginOwner: vi
      .fn<NonNullable<ClackSdkDeps["findByPluginOwner"]>>()
      .mockResolvedValue([]),
    createJob: vi.fn<NonNullable<ClackSdkDeps["createJob"]>>(),
    updateJob: vi.fn<NonNullable<ClackSdkDeps["updateJob"]>>(),
    deleteJob: vi.fn<NonNullable<ClackSdkDeps["deleteJob"]>>(),
    registerDelayedBootHandler: vi.fn<NonNullable<ClackSdkDeps["registerDelayedBootHandler"]>>(),
    computeMissedRuns: vi.fn<NonNullable<ClackSdkDeps["computeMissedRuns"]>>().mockReturnValue([]),
  };
}

function buildEveryToolset(config: Config): void {
  const slackClient = createSlackClientMock();
  const deliver = vi.fn<DeliverFn>();
  const deliveryControl: DeliveryControl = { switchTo: vi.fn<DeliveryControl["switchTo"]>() };

  for (const triggerType of TRIGGERS) {
    for (const submitResponseMode of SUBMIT_RESPONSE_MODES) {
      for (const actionToken of ["action-token", undefined]) {
        buildClackTools(
          buildQueryContext({
            userId: "U_TEST",
            role: "owner",
            session: sessionFor(triggerType),
            config,
            changesWorkflowEnabled: true,
            cronUserSchedules: true,
            slackClient,
            actionToken,
            deliver,
            deliveryControl,
            submitResponseMode,
            skipConditions:
              triggerType === "scheduled" ? "nothing new since the last run" : undefined,
            allowMultiMessage: triggerType === "scheduled",
            preAttachedTopics: [],
            mcpManager: new McpServerManager({}, {}),
            skillsManager: new SkillsManager(new Map(), {}),
          }),
        );
      }
    }
  }

  for (const kind of ["implement", "test"] as const) {
    buildClackTools(
      buildWorkerContext({
        worktreePath: "/nonexistent/worktree",
        branchName: "served-tool-schemas",
        repoName: "repo",
        repoUrl: "https://github.com/example/repo",
        channelId: "C_TEST",
        threadTs: "1111.2222",
        sessionId: "served-tool-schemas",
        kind,
        config,
      }),
    );
  }
}

/** `<server>/<tool>` for every tool the plugins registered, keyed by served server name. */
function registeredPluginTools(plugins: LoadedPlugins): string[] {
  return plugins.results.flatMap((result) =>
    result.tools.flatMap((registration) => {
      const definitions: Parameters<typeof registration.pushTo>[0] = [];
      registration.pushTo(definitions);
      const server =
        registration.serverKey === undefined
          ? result.name
          : `${result.name}_${registration.serverKey}`;
      return definitions.map((definition) => `${server}/${definition.name}`);
    }),
  );
}

async function connect(config: McpSdkServerConfigWithInstance): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await config.instance.connect(serverTransport);
  const client = new Client({ name: "served-tool-schemas", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

/** Returns null when the call validated (the stub ran), else the rejection text. */
async function rejection(tool: ServedTool, mode: ArgsMode): Promise<string | null> {
  let args;
  try {
    args = argsFromSchema(tool.schema, mode);
  } catch (error) {
    return `arg generation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  const result = CallToolResultSchema.parse(
    await tool.client.callTool({ name: tool.name, arguments: args }),
  );
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
  if (!result.isError && text === served.stubText) return null;
  return `${text.replace(/\s+/g, " ").slice(0, 600)} — args ${JSON.stringify(args).slice(0, 300)}`;
}

describe("served MCP tool schemas", () => {
  let pluginsDir: string;
  let plugins: LoadedPlugins;
  const clients: Client[] = [];
  const listingFailures: string[] = [];
  const tools: ServedTool[] = [];

  beforeAll(async () => {
    pluginsDir = await mkdtemp(join(tmpdir(), "served-tool-schemas-"));
    await mkdir(join(pluginsDir, "trivia"), { recursive: true });
    await writeFile(
      join(pluginsDir, "trivia", "config.json"),
      JSON.stringify({ seasons: { enabled: true, prompt: "A season of trivia." } }),
    );
    plugins = await loadPlugins(Object.keys(BUILTIN_PLUGINS), isolatedSdkDeps(), pluginsDir);
    setLoadedPlugins(plugins);

    served.servers.length = 0;
    buildEveryToolset(allGatesConfig());

    const seen = new Set<string>();
    for (const { name, config } of served.servers) {
      const client = await connect(config);
      clients.push(client);
      let listed;
      try {
        listed = await client.listTools();
      } catch (error) {
        listingFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const tool of listed.tools) {
        const key = `${name}/${tool.name}/${JSON.stringify(tool.inputSchema)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tools.push({
          server: name,
          name: tool.name,
          schema: schemaNode.parse(tool.inputSchema),
          client,
        });
      }
    }
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    for (const result of plugins?.results ?? []) {
      for (const watcher of result.watchers ?? []) watcher.close();
    }
    setLoadedPlugins({ results: [] });
    await rm(pluginsDir, { recursive: true, force: true });
  });

  it("loads every built-in plugin without errors", () => {
    assert.deepEqual(
      plugins.results.map((r) => r.name).sort(),
      Object.keys(BUILTIN_PLUGINS).sort(),
    );
    for (const result of plugins.results) {
      assert.deepEqual(result.errors, [], `plugin ${result.name} reported errors`);
      assert.ok(result.tools.length > 0, `plugin ${result.name} registered no tools`);
    }
  });

  it("covers the tools behind every gate", () => {
    const names = new Set(tools.map((t) => `${t.server}/${t.name}`));
    assert.deepEqual(
      GATED_SENTINELS.filter((sentinel) => !names.has(sentinel)),
      [],
    );
  });

  it("lists every server's tools", () => {
    assert.deepEqual(listingFailures, []);
  });

  it("serves every tool each plugin registers", () => {
    const servedNames = new Set(tools.map((t) => `${t.server}/${t.name}`));
    assert.deepEqual(
      registeredPluginTools(plugins).filter((name) => !servedNames.has(name)),
      [],
    );
  });

  it("gives the boot check every server, on-demand ones included, all listable", async () => {
    const servers = collectToolServers(allGatesConfig(), createSlackClientMock());

    assert.deepEqual(await findUnlistableToolServers(servers), []);
    const reached = new Set<string>();
    for (const { name, server } of servers) {
      const client = await connect(server);
      for (const tool of (await client.listTools()).tools) {
        reached.add(`${name.replace(":", "_")}/${tool.name}`);
      }
      await client.close();
    }
    assert.deepEqual(
      registeredPluginTools(plugins).filter((tool) => !reached.has(tool)),
      [],
    );
  });

  it.each<ArgsMode>(["minimal", "full"])(
    "validates %s args built from each advertised schema",
    async (mode) => {
      const rejected: string[] = [];
      for (const tool of tools) {
        const reason = await rejection(tool, mode);
        if (reason !== null) rejected.push(`${tool.server}/${tool.name}: ${reason}`);
      }
      assert.deepEqual(rejected, []);
    },
  );
});
