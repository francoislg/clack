import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { z } from "zod";
import { tool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { WebClient } from "@slack/web-api";
import { createClackSdk, type ClackSdkDeps } from "./sdk.js";
import type { RolesConfig } from "../roles.js";

const EMPTY_ROLES: RolesConfig = { owner: null, admins: [], devs: [] };

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

type ScriptedStep =
  | { kind: "assistant"; text: string }
  | { kind: "success"; text: string; inputTokens: number; outputTokens: number }
  | { kind: "error"; subtype: "error_max_turns" | "error_during_execution" };

/** Drive `askClaude` against a deterministic sequence of SDK messages. */
function scriptedQueryResult(steps: ScriptedStep[]): ReturnType<ClackSdkDeps["clackQuery"]> {
  async function* gen(): AsyncGenerator<SDKMessage, void, void> {
    for (const step of steps) {
      if (step.kind === "assistant") {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: step.text }] },
        } as SDKMessage;
      } else if (step.kind === "success") {
        yield {
          type: "result",
          subtype: "success",
          result: step.text,
          usage: { input_tokens: step.inputTokens, output_tokens: step.outputTokens },
        } as SDKMessage;
      } else {
        yield { type: "result", subtype: step.subtype } as SDKMessage;
      }
    }
  }
  return gen();
}

describe("ClackSdk", () => {
  function makeSdk(pluginName = "test-plugin", deps?: Partial<ClackSdkDeps>) {
    const dataDir = mkdtempSync(join(tmpdir(), "clack-sdk-test-"));
    const fullDeps: ClackSdkDeps = {
      getSlackClient: deps?.getSlackClient ?? (() => null),
      loadRoles: deps?.loadRoles ?? (async () => EMPTY_ROLES),
      openDmChannel: deps?.openDmChannel ?? (async () => null),
      // Optional cron-CRUD deps: forward when the test injects them; the SDK falls back to
      // the real persistence layer when absent (per `ClackSdkDeps` documentation).
      findByPluginOwner: deps?.findByPluginOwner,
      createJob: deps?.createJob,
      updateJob: deps?.updateJob,
      deleteJob: deps?.deleteJob,
      clackQuery: deps?.clackQuery ?? (() => emptyClackQuery()),
      startThreadConversation: deps?.startThreadConversation,
      capabilities: deps?.capabilities,
    };
    return createClackSdk(pluginName, dataDir, fullDeps);
  }

  describe("path traversal validation", () => {
    it("rejects ../ in readFile", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.readFile("../other/data.json"), /Path traversal/);
    });

    it("rejects ../ in writeFile", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.writeFile("../escape.json", "{}"), /Path traversal/);
    });

    it("rejects absolute paths in readFile", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.readFile("/etc/passwd"), /Absolute paths/);
    });

    it("rejects absolute paths in writeFile", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.writeFile("/tmp/evil.json", "{}"), /Absolute paths/);
    });

    it("allows simple relative paths", async () => {
      const { sdk } = makeSdk();
      const result = await sdk.readFile("scores.json");
      assert.equal(result, null); // file doesn't exist, but no error
    });

    it("allows nested relative paths", async () => {
      const { sdk } = makeSdk();
      await sdk.writeFile("subdir/data.json", '{"ok":true}');
      const result = await sdk.readFile("subdir/data.json");
      assert.equal(result, '{"ok":true}');
    });
  });

  describe("scoped file I/O", () => {
    it("writes and reads a file within plugin data dir", async () => {
      const { sdk } = makeSdk("trivia");
      await sdk.writeFile("questions.json", "[]");
      const content = await sdk.readFile("questions.json");
      assert.equal(content, "[]");
    });

    it("returns null for non-existent file", async () => {
      const { sdk } = makeSdk();
      const result = await sdk.readFile("missing.json");
      assert.equal(result, null);
    });
  });

  describe("instruction registration", () => {
    it("auto-prefixes instruction filenames", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.addInstruction("user", "instructions", "You have trivia tools");
      const result = harvest();
      assert.equal(result.instructions.length, 1);
      assert.equal(result.instructions[0].filename, "trivia__instructions.md");
      assert.equal(result.instructions[0].role, "user");
      assert.equal(result.instructions[0].content, "You have trivia tools");
    });

    it("collects multiple instructions", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.addInstruction("user", "basic", "Basic instructions");
      sdk.addInstruction("dev", "admin", "Admin instructions");
      const result = harvest();
      assert.equal(result.instructions.length, 2);
      assert.equal(result.instructions[0].filename, "trivia__basic.md");
      assert.equal(result.instructions[1].filename, "trivia__admin.md");
      assert.equal(result.instructions[1].role, "dev");
    });
  });

  describe("topic instruction registration", () => {
    it("stores a topic-scoped virtual default with prefixed key", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.addTopicInstruction("user", "trivia", "persona", "PERSONA: ...");
      const result = harvest();
      assert.equal(result.instructions.length, 1);
      assert.equal(result.instructions[0].filename, "topics/trivia/trivia__persona.md");
      assert.equal(result.instructions[0].role, "user");
      assert.equal(result.instructions[0].content, "PERSONA: ...");
    });

    it("collects multiple topic files from one plugin", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.addTopicInstruction("user", "trivia", "persona", "P");
      sdk.addTopicInstruction("user", "trivia", "reveal-tone", "R");
      const result = harvest();
      assert.equal(result.instructions.length, 2);
      const keys = result.instructions.map((i) => i.filename).sort();
      assert.deepEqual(keys, [
        "topics/trivia/trivia__persona.md",
        "topics/trivia/trivia__reveal-tone.md",
      ]);
    });

    it("two plugins on the same topic produce non-colliding keys", () => {
      const { sdk: a, harvest: ha } = makeSdk("trivia");
      const { sdk: b, harvest: hb } = makeSdk("weather");
      a.addTopicInstruction("user", "shared", "rules", "A");
      b.addTopicInstruction("user", "shared", "rules", "B");
      assert.equal(ha().instructions[0].filename, "topics/shared/trivia__rules.md");
      assert.equal(hb().instructions[0].filename, "topics/shared/weather__rules.md");
    });

    it("baseline addInstruction is unaffected by topic registration", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.addInstruction("user", "trivia-check", "baseline");
      sdk.addTopicInstruction("user", "trivia", "persona", "topic");
      const result = harvest();
      assert.equal(result.instructions.length, 2);
      const baseline = result.instructions.find((i) => i.filename === "trivia__trivia-check.md");
      const topic = result.instructions.find(
        (i) => i.filename === "topics/trivia/trivia__persona.md",
      );
      assert.ok(baseline);
      assert.ok(topic);
      assert.equal(baseline.content, "baseline");
      assert.equal(topic.content, "topic");
    });
  });

  describe("tool registration", () => {
    it("records tools with minRole", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const testTool = tool(
        "test_tool",
        "A test tool",
        {
          input: z.string().optional(),
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
      sdk.registerTool("member", testTool, "Running test tool {input}");
      const result = harvest();
      assert.equal(result.tools.length, 1);
      assert.equal(result.tools[0].minRole, "member");
      assert.equal(result.toolMappings.get("test_tool"), "Running test tool {input}");
    });

    it("defaults serverKey to undefined for shorthand registerTool", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const open = tool(
        "open_tool",
        "An always-available tool",
        { input: z.string().optional() },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
      sdk.registerTool("admin", open, "Open label");
      const result = harvest();
      assert.equal(result.tools[0].serverKey, undefined);
    });
  });

  describe("MCP server handles (registerMcpServer)", () => {
    it("exposes an implicit default mcpServer named after the plugin", () => {
      const { sdk } = makeSdk("trivia");
      assert.ok(sdk.mcpServer, "default mcpServer handle should exist");
      assert.equal(sdk.mcpServer.fullName, "trivia");
    });

    it("registerMcpServer returns a handle and records the spec", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const handle = sdk.registerMcpServer("management", {
        autoload: false,
        description: "Manage trivia games and seasons.",
      });
      assert.equal(handle.fullName, "trivia:management");
      const result = harvest();
      assert.equal(result.mcpServers.length, 1);
      assert.deepEqual(result.mcpServers[0], {
        key: "management",
        fullName: "trivia:management",
        autoload: false,
        description: "Manage trivia games and seasons.",
      });
    });

    it("autoload defaults to false when omitted", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerMcpServer("management", { description: "x" });
      const result = harvest();
      assert.equal(result.mcpServers[0].autoload, false);
    });

    it("autoload: true is preserved", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerMcpServer("eager", { autoload: true, description: "x" });
      const result = harvest();
      assert.equal(result.mcpServers[0].autoload, true);
    });

    it("rejects names containing ':'", () => {
      const { sdk } = makeSdk("trivia");
      assert.throws(
        () => sdk.registerMcpServer("trivia:management", { description: "x" }),
        /must not contain ':'/,
      );
    });

    it("rejects empty names", () => {
      const { sdk } = makeSdk("trivia");
      assert.throws(() => sdk.registerMcpServer("", { description: "x" }), /non-empty name/);
    });

    it("rejects duplicate names within the same plugin", () => {
      const { sdk } = makeSdk("trivia");
      sdk.registerMcpServer("management", { description: "first" });
      assert.throws(
        () => sdk.registerMcpServer("management", { description: "second" }),
        /called twice/,
      );
    });

    it("handle.registerTool records the tool with the right serverKey", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const handle = sdk.registerMcpServer("management", { description: "x" });
      const t = tool("upsert_season", "Upsert a season", { slug: z.string() }, async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      handle.registerTool("admin", t, "Upserting season — {slug}");
      const result = harvest();
      assert.equal(result.tools.length, 1);
      assert.equal(result.tools[0].name, "upsert_season");
      assert.equal(result.tools[0].minRole, "admin");
      assert.equal(result.tools[0].serverKey, "management");
      assert.equal(result.toolMappings.get("upsert_season"), "Upserting season — {slug}");
    });

    it("sdk.mcpServer.registerTool records the tool with no serverKey", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const t = tool("list_games", "List games", {}, async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      sdk.mcpServer.registerTool("admin", t, "Listing games");
      const result = harvest();
      assert.equal(result.tools[0].serverKey, undefined);
    });

    it("handle.addTopicInstruction stores the file under topics/<fullName>/", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const handle = sdk.registerMcpServer("management", { description: "x" });
      handle.addTopicInstruction("admin", "manage", "...content...");
      const result = harvest();
      assert.equal(result.instructions.length, 1);
      assert.equal(result.instructions[0].filename, "topics/trivia:management/trivia__manage.md");
      assert.equal(result.instructions[0].role, "admin");
      assert.equal(result.instructions[0].content, "...content...");
    });

    it("default mcpServer.addTopicInstruction stores under topics/<plugin>/", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.mcpServer.addTopicInstruction("admin", "persona", "tone content");
      const result = harvest();
      assert.equal(result.instructions[0].filename, "topics/trivia/trivia__persona.md");
    });

    it("harvest returns empty mcpServers array when none are registered", () => {
      const { harvest } = makeSdk("trivia");
      const result = harvest();
      assert.deepEqual(result.mcpServers, []);
    });
  });

  describe("harvest", () => {
    it("returns plugin name", () => {
      const { harvest } = makeSdk("my-plugin");
      const result = harvest();
      assert.equal(result.name, "my-plugin");
    });

    it("produces an MCP server named after the plugin", () => {
      const { harvest } = makeSdk("weather");
      const result = harvest();
      assert.equal(result.mcpServer.name, "weather");
      assert.equal(result.mcpServer.type, "sdk");
    });

    it("includes registered tools in the MCP server instance", () => {
      const { sdk, harvest } = makeSdk("weather");
      const forecast = tool("forecast", "Get a forecast", { city: z.string() }, async () => ({
        content: [{ type: "text" as const, text: "sunny" }],
      }));
      sdk.registerTool("member", forecast, "Checking weather in {city}");
      const result = harvest();
      // The SDK wraps tools into a server; the `tools` field from harvest still exposes the
      // registered-tool shape for the host to assemble / wrap / role-gate as it sees fit.
      assert.equal(result.tools.length, 1);
      assert.equal(result.tools[0].name, "forecast");
      assert.equal(result.mcpServer.name, "weather");
    });
  });

  describe("dmOwner", () => {
    it("posts to the resolved DM channel for the configured owner", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage").mockImplementation(async () => ({
        ok: true,
        ts: "123.456",
      }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => "D_OWNER",
      });

      const result = await sdk.dmOwner("Hello owner");

      assert.deepEqual(result, { ok: true });
      assert.equal(postSpy.mock.calls.length, 1);
      const args = postSpy.mock.calls[0][0];
      assert.equal(args?.channel, "D_OWNER");
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.equal(text, "Hello owner");
    });

    it("fails cleanly when the Slack client is not connected", async () => {
      const { sdk } = makeSdk("trivia", { getSlackClient: () => null });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not connected/);
    });

    it("fails cleanly when no owner is configured", async () => {
      const client = new WebClient();
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => EMPTY_ROLES,
      });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /No owner is configured/);
      assert.equal(postSpy.mock.calls.length, 0);
    });

    it("fails cleanly when the DM channel cannot be opened", async () => {
      const client = new WebClient();
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => null,
      });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /Could not open a DM/);
      assert.equal(postSpy.mock.calls.length, 0);
    });

    it("returns the error string when chat.postMessage throws", async () => {
      const client = new WebClient();
      vi.spyOn(client.chat, "postMessage").mockImplementation(async () => {
        throw new Error("channel_not_found");
      });
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => "D_OWNER",
      });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /channel_not_found/);
    });

    it("omits unfurl flags when suppressUnfurls is not set", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage").mockImplementation(async () => ({
        ok: true,
        ts: "1.0",
      }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => "D_OWNER",
      });

      await sdk.dmOwner("hi");

      const args = postSpy.mock.calls[0][0];
      assert.ok(args);
      assert.equal("unfurl_links" in args, false);
      assert.equal("unfurl_media" in args, false);
    });

    it("sets unfurl_links and unfurl_media to false when suppressUnfurls is true", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage").mockImplementation(async () => ({
        ok: true,
        ts: "1.0",
      }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => "D_OWNER",
      });

      await sdk.dmOwner("hi", { suppressUnfurls: true });

      const args = postSpy.mock.calls[0][0];
      assert.ok(args && "unfurl_links" in args);
      assert.equal(args.unfurl_links, false);
      assert.ok(args && "unfurl_media" in args);
      assert.equal(args.unfurl_media, false);
    });
  });

  describe("sendMessage", () => {
    it("posts a top-level channel message and returns ts + channel", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage").mockImplementation(async () => ({
        ok: true,
        ts: "111.222",
        channel: "C1",
      }));
      const { sdk } = makeSdk("trivia", { getSlackClient: () => client });

      const result = await sdk.sendMessage({ channel: "C1", text: "hi" });

      assert.deepEqual(result, { ok: true, ts: "111.222", channel: "C1" });
      const args = postSpy.mock.calls[0][0];
      assert.equal(args?.channel, "C1");
      assert.equal(args && "thread_ts" in args ? args.thread_ts : undefined, undefined);
    });

    it("posts a threaded reply when threadTs is given", async () => {
      const client = new WebClient();
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true, ts: "9.9", channel: "C1" }));
      const { sdk } = makeSdk("trivia", { getSlackClient: () => client });

      await sdk.sendMessage({ channel: "C1", text: "reply", threadTs: "5.5" });

      const args = postSpy.mock.calls[0][0];
      assert.equal(args && "thread_ts" in args ? args.thread_ts : undefined, "5.5");
    });

    it("rejects when neither text nor blocks is supplied", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage");
      const { sdk } = makeSdk("trivia", { getSlackClient: () => client });

      const result = await sdk.sendMessage({ channel: "C1" });

      assert.equal(result.ok, false);
      assert.equal(postSpy.mock.calls.length, 0);
    });

    it("fails cleanly when the Slack client is not connected", async () => {
      const { sdk } = makeSdk("trivia", { getSlackClient: () => null });
      const result = await sdk.sendMessage({ channel: "C1", text: "hi" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not connected/);
    });

    it("returns the error string when chat.postMessage throws", async () => {
      const client = new WebClient();
      vi.spyOn(client.chat, "postMessage").mockImplementation(async () => {
        throw new Error("channel_not_found");
      });
      const { sdk } = makeSdk("trivia", { getSlackClient: () => client });
      const result = await sdk.sendMessage({ channel: "C1", text: "hi" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /channel_not_found/);
    });
  });

  describe("startThreadConversation", () => {
    type StartParams = Parameters<NonNullable<ClackSdkDeps["startThreadConversation"]>>[0];

    it("delegates to the injected dep with the resolved client and args", async () => {
      const client = new WebClient();
      const calls: StartParams[] = [];
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        startThreadConversation: async (params) => {
          calls.push(params);
        },
      });

      await sdk.startThreadConversation({
        channel: "C1",
        threadTs: "5.5",
        userId: "U1",
        prompt: "tell me more",
        additionalSystemPrompt: "ctx",
        attentionLevel: "high",
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].client, client);
      assert.equal(calls[0].channel, "C1");
      assert.equal(calls[0].threadTs, "5.5");
      assert.equal(calls[0].userId, "U1");
      assert.equal(calls[0].additionalSystemPrompt, "ctx");
      assert.equal(calls[0].attentionLevel, "high");
    });

    it("is a no-op when the dep is not wired", async () => {
      const client = new WebClient();
      const { sdk } = makeSdk("trivia", { getSlackClient: () => client });
      await assert.doesNotReject(
        sdk.startThreadConversation({ channel: "C1", threadTs: "5.5", userId: "U1", prompt: "x" }),
      );
    });

    it("is a no-op when the Slack client is not connected", async () => {
      const calls: number[] = [];
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => null,
        startThreadConversation: async () => {
          calls.push(1);
        },
      });
      await sdk.startThreadConversation({
        channel: "C1",
        threadTs: "5.5",
        userId: "U1",
        prompt: "x",
      });
      assert.equal(calls.length, 0);
    });
  });

  describe("reconcileCronJobs", () => {
    // Minimal in-memory store mimicking the cronJobs.ts persistence surface.
    interface StoredJob {
      id: string;
      cronExpression: string;
      channel?: string;
      prompt: string;
      timezone: string;
      name?: string;
      createdBy: string | null;
      systemActor?: string;
      plugin?: string;
      pluginManaged?: boolean;
      specKey?: string;
      enabled: boolean;
      requiredTools?: string[];
      skipConditions?: string;
      submitResponseMode?: "always" | "optional" | "skipped";
      skipDates?: Array<{ date: string; label: string }>;
      attachedTopics?: string[];
      runs?: Array<{ executedAt: string; status: "success" | "error" | "skipped" }>;
      lastRunAt?: string;
      lastRunStatus?: "success" | "error" | "skipped";
    }

    interface FakeStore {
      jobs: StoredJob[];
      deps: Partial<ClackSdkDeps>;
    }

    function makeFakeStore(): FakeStore {
      const jobs: StoredJob[] = [];
      let nextId = 1;
      const deps: Partial<ClackSdkDeps> = {
        findByPluginOwner: async (ownerKey: string) => {
          // The real findByPluginOwner returns CronJob[]. The store's StoredJob is structurally
          // compatible with the read-only fields used by reconcile (id, plugin, pluginManaged,
          // specKey). Return a typed copy mapped through the CronJob shape.
          return jobs
            .filter((j) => j.plugin === ownerKey && j.pluginManaged === true)
            .map((j) => ({
              id: j.id,
              cronExpression: j.cronExpression,
              channel: j.channel,
              prompt: j.prompt,
              createdBy: j.createdBy,
              ...(j.systemActor ? { systemActor: j.systemActor } : {}),
              createdAt: "2026-01-01T00:00:00Z",
              enabled: j.enabled,
              timezone: j.timezone,
              plugin: j.plugin,
              pluginManaged: j.pluginManaged,
              specKey: j.specKey,
              requiredTools: j.requiredTools,
              skipConditions: j.skipConditions,
              submitResponseMode: j.submitResponseMode,
              skipDates: j.skipDates,
              attachedTopics: j.attachedTopics,
              runs: j.runs,
              lastRunAt: j.lastRunAt,
              lastRunStatus: j.lastRunStatus,
            }));
        },
        createJob: async (params) => {
          const trimmedName = params.name?.trim();
          const job: StoredJob = {
            id: `job-${nextId++}`,
            cronExpression: params.cronExpression,
            channel: params.channel,
            prompt: params.prompt,
            timezone: params.timezone,
            ...(trimmedName && trimmedName.length > 0 ? { name: trimmedName } : {}),
            createdBy: params.createdBy,
            ...(params.systemActor ? { systemActor: params.systemActor } : {}),
            enabled: true,
            plugin: params.plugin,
            pluginManaged: params.pluginManaged,
            specKey: params.specKey,
            requiredTools: params.requiredTools,
            skipConditions: params.skipConditions,
            submitResponseMode: params.submitResponseMode,
            skipDates: params.skipDates,
            attachedTopics: params.attachedTopics,
          };
          jobs.push(job);
          return {
            id: job.id,
            cronExpression: job.cronExpression,
            channel: job.channel,
            prompt: job.prompt,
            createdBy: job.createdBy,
            ...(job.systemActor ? { systemActor: job.systemActor } : {}),
            createdAt: "2026-01-01T00:00:00Z",
            enabled: job.enabled,
            timezone: job.timezone,
            plugin: job.plugin,
            pluginManaged: job.pluginManaged,
            specKey: job.specKey,
          };
        },
        updateJob: async (jobId, updates) => {
          const job = jobs.find((j) => j.id === jobId);
          if (!job) return null;
          if (updates.cronExpression !== undefined) job.cronExpression = updates.cronExpression;
          if (updates.channel !== undefined) {
            job.channel = updates.channel === null ? undefined : updates.channel;
          }
          if (updates.prompt !== undefined) job.prompt = updates.prompt;
          if (updates.timezone !== undefined) job.timezone = updates.timezone;
          if (updates.requiredTools !== undefined) {
            job.requiredTools =
              updates.requiredTools.length > 0 ? updates.requiredTools : undefined;
          }
          if (updates.skipConditions !== undefined) {
            job.skipConditions =
              updates.skipConditions.length > 0 ? updates.skipConditions : undefined;
          }
          if (updates.submitResponseMode !== undefined) {
            job.submitResponseMode =
              updates.submitResponseMode === null ? undefined : updates.submitResponseMode;
          }
          if (updates.skipDates !== undefined) {
            job.skipDates = updates.skipDates.length > 0 ? updates.skipDates : undefined;
          }
          if (updates.attachedTopics !== undefined) {
            job.attachedTopics =
              updates.attachedTopics.length > 0 ? updates.attachedTopics : undefined;
          }
          if (updates.name !== undefined) {
            const trimmed = updates.name.trim();
            job.name = trimmed.length > 0 ? trimmed : undefined;
          }
          return {
            id: job.id,
            cronExpression: job.cronExpression,
            channel: job.channel,
            prompt: job.prompt,
            createdBy: job.createdBy,
            ...(job.systemActor ? { systemActor: job.systemActor } : {}),
            createdAt: "2026-01-01T00:00:00Z",
            enabled: job.enabled,
            timezone: job.timezone,
            plugin: job.plugin,
            pluginManaged: job.pluginManaged,
            specKey: job.specKey,
          };
        },
        deleteJob: async (jobId) => {
          const idx = jobs.findIndex((j) => j.id === jobId);
          if (idx === -1) return false;
          jobs.splice(idx, 1);
          return true;
        },
      };
      return { jobs, deps };
    }

    const validSpec = {
      specKey: "ops:question",
      cronExpression: "0 9 * * 1-5",
      channel: "C123ABC",
      prompt: "embedded prompt",
      timezone: "America/Montreal",
      requiredTools: ["mcp__trivia__get_ideas"],
    };

    it("creates a new spec as pluginManaged with the right owner", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);

      assert.equal(store.jobs.length, 1);
      assert.equal(store.jobs[0].plugin, "trivia");
      assert.equal(store.jobs[0].pluginManaged, true);
      assert.equal(store.jobs[0].specKey, "ops:question");
      assert.equal(store.jobs[0].cronExpression, "0 9 * * 1-5");
    });

    it("persists new specs with createdBy: null and systemActor: plugin:<ownerKey>", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);

      assert.equal(store.jobs[0].createdBy, null);
      assert.equal(store.jobs[0].systemActor, "plugin:trivia");
    });

    it("empty spec list deletes all owner-managed jobs", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);
      assert.equal(store.jobs.length, 1);

      await sdk.reconcileCronJobs("trivia", []);
      assert.equal(store.jobs.length, 0);
    });

    it("updates existing matching spec in place, preserving id/enabled", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);
      const originalId = store.jobs[0].id;
      // Simulate admin disabling the job from the Home Tab.
      store.jobs[0].enabled = false;
      store.jobs[0].runs = [{ executedAt: "2026-01-01T09:00:00Z", status: "success" }];

      await sdk.reconcileCronJobs("trivia", [
        { ...validSpec, cronExpression: "0 10 * * 1-5", prompt: "updated prompt" },
      ]);

      assert.equal(store.jobs.length, 1);
      assert.equal(store.jobs[0].id, originalId, "id preserved across update");
      assert.equal(store.jobs[0].enabled, false, "admin-disabled flag preserved");
      assert.equal(store.jobs[0].cronExpression, "0 10 * * 1-5");
      assert.equal(store.jobs[0].prompt, "updated prompt");
      assert.equal(store.jobs[0].runs?.length, 1, "run history preserved");
    });

    it("removing a spec deletes the job even when admin had disabled it", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);
      store.jobs[0].enabled = false;

      await sdk.reconcileCronJobs("trivia", []);
      assert.equal(store.jobs.length, 0);
    });

    it("does not touch jobs owned by other plugins or by users", async () => {
      const store = makeFakeStore();
      // Pre-seed: one weather-plugin job, one user-created job (no pluginManaged tag)
      store.jobs.push({
        id: "weather-1",
        cronExpression: "0 8 * * *",
        channel: "C111",
        prompt: "weather",
        timezone: "UTC",
        createdBy: null,
        systemActor: "plugin:weather",
        plugin: "weather",
        pluginManaged: true,
        specKey: "morning",
        enabled: true,
      });
      store.jobs.push({
        id: "user-1",
        cronExpression: "0 10 * * *",
        channel: "C222",
        prompt: "user job",
        timezone: "UTC",
        createdBy: "U_USER",
        enabled: true,
      });

      const { sdk } = makeSdk("trivia", store.deps);
      await sdk.reconcileCronJobs("trivia", [validSpec]);

      assert.equal(store.jobs.length, 3, "weather + user + new trivia job all present");
      assert.ok(store.jobs.find((j) => j.id === "weather-1"));
      assert.ok(store.jobs.find((j) => j.id === "user-1"));

      await sdk.reconcileCronJobs("trivia", []);
      assert.equal(store.jobs.length, 2, "trivia gone, weather + user retained");
    });

    it("skips invalid specs but applies valid neighbors", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [
        validSpec,
        { ...validSpec, specKey: "bad", cronExpression: "not a cron" },
      ]);

      assert.equal(store.jobs.length, 1, "only the valid spec was applied");
      assert.equal(store.jobs[0].specKey, "ops:question");
    });

    it("idempotent on repeat call with identical input", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);

      await sdk.reconcileCronJobs("trivia", [validSpec]);
      const firstId = store.jobs[0].id;
      const firstSnapshot = JSON.stringify(store.jobs[0]);

      await sdk.reconcileCronJobs("trivia", [validSpec]);
      assert.equal(store.jobs.length, 1);
      assert.equal(store.jobs[0].id, firstId, "no recreation on identical input");
      assert.equal(JSON.stringify(store.jobs[0]), firstSnapshot, "state unchanged");
    });

    it("throws on non-string ownerKey", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);
      await assert.rejects(
        () => sdk.reconcileCronJobs("", [validSpec]),
        /ownerKey must be a non-empty string/,
      );
    });

    it("throws on non-array specs", async () => {
      const store = makeFakeStore();
      const { sdk } = makeSdk("trivia", store.deps);
      // @ts-expect-error — testing runtime guard
      await assert.rejects(() => sdk.reconcileCronJobs("trivia", null), /specs must be an array/);
    });

    describe("skipDates persistence", () => {
      it("creates a job with skipDates when the spec carries them", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);
        const skipDates = [
          { date: "12-25", label: "Christmas" },
          { date: "01-01", label: "New Year's Day" },
        ];

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, skipDates }]);

        assert.equal(store.jobs.length, 1);
        assert.deepEqual(store.jobs[0].skipDates, skipDates);
      });

      it("creates a job without skipDates when the spec omits them", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        assert.equal(store.jobs[0].skipDates, undefined);
      });

      it("updates skipDates in place on an existing job when the spec changes", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);
        const first = [{ date: "12-25", label: "Christmas" }];
        const second = [
          { date: "12-25", label: "Christmas" },
          { date: "07-01", label: "Canada Day" },
        ];

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, skipDates: first }]);
        const id = store.jobs[0].id;
        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, skipDates: second }]);

        assert.equal(store.jobs.length, 1);
        assert.equal(store.jobs[0].id, id, "same job, updated in place");
        assert.deepEqual(store.jobs[0].skipDates, second);
      });

      it("clears skipDates when a subsequent spec omits them", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [
          { ...validSpec, skipDates: [{ date: "12-25", label: "Christmas" }] },
        ]);
        assert.ok(store.jobs[0].skipDates);

        await sdk.reconcileCronJobs("trivia", [validSpec]);
        assert.equal(store.jobs[0].skipDates, undefined);
      });
    });

    describe("attachedTopics propagation", () => {
      it("persists attachedTopics through createJob when the spec sets it", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, attachedTopics: ["trivia"] }]);

        assert.equal(store.jobs.length, 1);
        assert.deepEqual(store.jobs[0].attachedTopics, ["trivia"]);
      });

      it("omits attachedTopics when the spec does not set it", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        assert.equal(store.jobs[0].attachedTopics, undefined);
      });

      it("updates attachedTopics in place when the spec changes the value", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, attachedTopics: ["trivia"] }]);
        const id = store.jobs[0].id;

        await sdk.reconcileCronJobs("trivia", [
          { ...validSpec, attachedTopics: ["trivia", "extra"] },
        ]);

        assert.equal(store.jobs.length, 1);
        assert.equal(store.jobs[0].id, id, "same job, updated in place");
        assert.deepEqual(store.jobs[0].attachedTopics, ["trivia", "extra"]);
      });

      it("clears attachedTopics when a subsequent spec omits the field", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, attachedTopics: ["trivia"] }]);
        assert.deepEqual(store.jobs[0].attachedTopics, ["trivia"]);

        await sdk.reconcileCronJobs("trivia", [validSpec]);
        assert.equal(store.jobs[0].attachedTopics, undefined);
      });
    });

    describe("submitResponseMode propagation", () => {
      it("persists submitResponseMode through createJob when the spec sets it", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "skipped" }]);

        assert.equal(store.jobs.length, 1);
        assert.equal(store.jobs[0].submitResponseMode, "skipped");
      });

      it("omits submitResponseMode when the spec does not set it", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        assert.equal(store.jobs[0].submitResponseMode, undefined);
      });

      it("updates submitResponseMode in place when the spec changes the value", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "always" }]);
        assert.equal(store.jobs[0].submitResponseMode, "always");

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "skipped" }]);
        assert.equal(store.jobs[0].submitResponseMode, "skipped");
      });

      it("clears submitResponseMode when a subsequent spec omits it", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "skipped" }]);
        assert.equal(store.jobs[0].submitResponseMode, "skipped");

        await sdk.reconcileCronJobs("trivia", [validSpec]);
        assert.equal(store.jobs[0].submitResponseMode, undefined);
      });
    });

    describe("name field", () => {
      it("persists name when spec carries one (new entry)", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Trivia: daily question" }]);

        assert.equal(store.jobs[0].name, "Trivia: daily question");
      });

      it("creates a nameless job when spec omits name", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        assert.equal(store.jobs[0].name, undefined);
      });

      it("adopts a name on re-reconcile when the spec now has one", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [validSpec]);
        assert.equal(store.jobs[0].name, undefined);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Game A — daily" }]);
        assert.equal(store.jobs[0].name, "Game A — daily");
      });

      it("leaves the persisted name untouched when re-reconciled spec omits name", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Initial name" }]);
        assert.equal(store.jobs[0].name, "Initial name");

        await sdk.reconcileCronJobs("trivia", [validSpec]);
        assert.equal(store.jobs[0].name, "Initial name");
      });

      it("overwrites name when the spec provides a different one", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Old" }]);
        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "New" }]);

        assert.equal(store.jobs[0].name, "New");
      });

      it("skips a spec whose name is too long", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);
        const oversized = "x".repeat(81);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: oversized }]);

        assert.equal(store.jobs.length, 0);
      });

      it("skips a spec whose name is whitespace-only", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("trivia", store.deps);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "   " }]);

        assert.equal(store.jobs.length, 0);
      });
    });

    describe("channelless specs", () => {
      const channellessSpec = {
        specKey: "chatter",
        cronExpression: "*/15 9-16 * * 1-5",
        prompt: "Casual chatter",
        timezone: "UTC",
      };

      it("accepts a spec with no channel field", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("casual-talk", store.deps);

        await sdk.reconcileCronJobs("casual-talk", [channellessSpec]);

        assert.equal(store.jobs.length, 1);
        assert.equal(store.jobs[0].channel, undefined);
        assert.equal(store.jobs[0].pluginManaged, true);
        assert.equal(store.jobs[0].systemActor, "plugin:casual-talk");
      });

      it("rejects a spec with an invalid channel string (regression for shape check)", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("casual-talk", store.deps);

        await sdk.reconcileCronJobs("casual-talk", [
          { ...channellessSpec, channel: "not-a-channel-id" },
        ]);

        assert.equal(store.jobs.length, 0, "invalid channel rejected");
      });

      it("clears the persisted channel when a previously-bound spec is re-reconciled without one", async () => {
        const store = makeFakeStore();
        const { sdk } = makeSdk("casual-talk", store.deps);

        await sdk.reconcileCronJobs("casual-talk", [{ ...channellessSpec, channel: "C123ABC" }]);
        assert.equal(store.jobs[0].channel, "C123ABC");

        await sdk.reconcileCronJobs("casual-talk", [channellessSpec]);

        assert.equal(store.jobs[0].channel, undefined, "channel cleared on re-reconcile");
      });
    });
  });

  describe("watchFile", () => {
    it("rejects ../ in relative paths", () => {
      const { sdk } = makeSdk();
      assert.throws(() => sdk.watchFile("../other/data.json", () => {}), /Path traversal/);
    });

    it("rejects absolute paths", () => {
      const { sdk } = makeSdk();
      assert.throws(() => sdk.watchFile("/etc/passwd", () => {}), /Absolute paths/);
    });

    it("does not throw when the file does not exist yet", () => {
      const { sdk } = makeSdk();
      const watcher = sdk.watchFile("future-file.json", () => {});
      assert.ok(watcher, "returns a watcher even when the target is missing");
      watcher.close();
    });

    it("tracks the watcher on the plugin's load result for teardown", () => {
      const { sdk, harvest } = makeSdk("trivia");
      const w1 = sdk.watchFile("file-1.json", () => {});
      const w2 = sdk.watchFile("file-2.json", () => {});
      const result = harvest();
      assert.equal(result.watchers?.length, 2, "both watchers recorded for reload-time teardown");
      w1.close();
      w2.close();
    });
  });

  describe("registerAction / registerView", () => {
    it("prefixes a literal string key with plugin:<name>:", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerAction("answer", async () => {});
      const result = harvest();
      assert.equal(result.actionHandlers.length, 1);
      assert.equal(result.actionHandlers[0].key, "plugin:trivia:answer");
    });

    it("prefixes a RegExp key by splicing into the source", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerAction(/^answer:[a-z0-9-]+$/, async () => {});
      const result = harvest();
      const key = result.actionHandlers[0].key;
      assert.ok(key instanceof RegExp, "key should be a RegExp");
      assert.equal(key.source, "^plugin:trivia:answer:[a-z0-9-]+$");
    });

    it("preserves RegExp flags when prefixing", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerAction(/^answer:foo$/i, async () => {});
      const result = harvest();
      const key = result.actionHandlers[0].key;
      assert.ok(key instanceof RegExp);
      assert.equal(key.flags, "i");
    });

    it("rejects a literal key that already starts with plugin:", () => {
      const { sdk } = makeSdk("trivia");
      assert.throws(
        () => sdk.registerAction("plugin:trivia:answer", async () => {}),
        /auto-prefixes/,
      );
    });

    it("rejects a RegExp whose source starts with plugin:", () => {
      const { sdk } = makeSdk("trivia");
      assert.throws(
        () => sdk.registerAction(/^plugin:trivia:answer$/, async () => {}),
        /auto-prefixes/,
      );
    });

    it("registerView mirrors registerAction prefix semantics", () => {
      const { sdk, harvest } = makeSdk("trivia");
      sdk.registerView("freeform-modal", async () => {});
      sdk.registerView(/^freeform-modal:[a-z0-9-]+$/, async () => {});
      const result = harvest();
      assert.equal(result.viewHandlers.length, 2);
      assert.equal(result.viewHandlers[0].key, "plugin:trivia:freeform-modal");
      const re = result.viewHandlers[1].key;
      assert.ok(re instanceof RegExp);
      assert.equal(re.source, "^plugin:trivia:freeform-modal:[a-z0-9-]+$");
    });

    it("harvest exposes empty arrays when nothing was registered", () => {
      const { harvest } = makeSdk("trivia");
      const result = harvest();
      assert.deepEqual(result.actionHandlers, []);
      assert.deepEqual(result.viewHandlers, []);
    });

    it("actionId returns the prefixed string", () => {
      const { sdk } = makeSdk("trivia");
      assert.equal(sdk.actionId("answer"), "plugin:trivia:answer");
      assert.equal(sdk.actionId("answer:q-123"), "plugin:trivia:answer:q-123");
    });

    it("viewCallbackId returns the prefixed string", () => {
      const { sdk } = makeSdk("trivia");
      assert.equal(sdk.viewCallbackId("freeform-modal"), "plugin:trivia:freeform-modal");
    });

    it("actionId rejects keys that already include the prefix", () => {
      const { sdk } = makeSdk("trivia");
      assert.throws(() => sdk.actionId("plugin:trivia:answer"), /auto-prefixes/);
    });
  });

  describe("askClaude", () => {
    it("flattens system + messages into one prompt and returns assistant text + usage", async () => {
      let capturedPrompt: string | undefined;
      let capturedModel: string | undefined;

      const fakeClackQuery: ClackSdkDeps["clackQuery"] = (params) => {
        capturedPrompt = params.prompt;
        if (typeof params.options?.model === "string") capturedModel = params.options.model;
        return scriptedQueryResult([
          { kind: "assistant", text: "Paris" },
          { kind: "success", text: "Paris", inputTokens: 12, outputTokens: 3 },
        ]);
      };

      const { sdk } = makeSdk("trivia", { clackQuery: fakeClackQuery });

      const out = await sdk.askClaude({
        model: "claude-haiku-4-5-20251001",
        system: "You are a strict judge.",
        messages: [{ role: "user", content: "What is the capital of France?" }],
        max_tokens: 100,
      });

      assert.equal(out.text, "Paris");
      assert.equal(out.stopReason, "end_turn");
      assert.equal(out.usage.inputTokens, 12);
      assert.equal(out.usage.outputTokens, 3);
      assert.equal(capturedModel, "claude-haiku-4-5-20251001");
      assert.match(capturedPrompt ?? "", /strict judge/);
      assert.match(capturedPrompt ?? "", /capital of France/);
    });

    it("surfaces non-success result subtypes as stopReason", async () => {
      const fakeClackQuery: ClackSdkDeps["clackQuery"] = () =>
        scriptedQueryResult([
          { kind: "assistant", text: "partial" },
          { kind: "error", subtype: "error_max_turns" },
        ]);
      const { sdk } = makeSdk("trivia", { clackQuery: fakeClackQuery });

      const out = await sdk.askClaude({
        model: "haiku",
        messages: [{ role: "user", content: "go" }],
      });

      assert.equal(out.stopReason, "error_max_turns");
      assert.equal(out.text, "partial");
    });
  });

  describe("capabilities", () => {
    it("defaults to crons: true when deps does not provide capabilities", () => {
      const { sdk } = makeSdk();
      assert.equal(sdk.capabilities.crons, true);
    });

    it("reflects crons: false when deps.capabilities.crons is false", () => {
      const { sdk } = makeSdk("p", { capabilities: { crons: false } });
      assert.equal(sdk.capabilities.crons, false);
    });

    it("reflects crons: true when deps.capabilities.crons is true", () => {
      const { sdk } = makeSdk("p", { capabilities: { crons: true } });
      assert.equal(sdk.capabilities.crons, true);
    });
  });

  describe("sdk.error", () => {
    it("appends a single reason to errors[]", () => {
      const { sdk, harvest } = makeSdk();
      sdk.error("crons are disabled");
      const result = harvest();
      assert.deepEqual(result.errors, ["crons are disabled"]);
    });

    it("accumulates multiple errors in call order", () => {
      const { sdk, harvest } = makeSdk();
      sdk.error("reason A");
      sdk.error("reason B");
      const result = harvest();
      assert.deepEqual(result.errors, ["reason A", "reason B"]);
    });

    it("does not throw; plugin may continue and register tools after calling error", () => {
      const { sdk, harvest } = makeSdk();
      sdk.error("partial-failure reason");
      sdk.addInstruction("user", "instructions", "still useful");
      const result = harvest();
      assert.equal(result.errors.length, 1);
      assert.equal(result.instructions.length, 1);
    });

    it("returns an empty errors[] when never called", () => {
      const { harvest } = makeSdk();
      const result = harvest();
      assert.deepEqual(result.errors, []);
    });
  });
});
