import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { z } from "zod";
import { tool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { WebClient } from "@slack/web-api";
import { createClackSdk } from "./factory.js";
import type { ClackSdkDeps, AttentionLevel, ThreadEngagementOrigin } from "../sdk.js";
import type { RolesConfig } from "../../roles.js";
import type { CronJob } from "../../cronJobs.js";

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
      registerDelayedBootHandler: deps?.registerDelayedBootHandler,
      computeMissedRuns: deps?.computeMissedRuns,
      executeCronJob: deps?.executeCronJob,
      clackQuery: deps?.clackQuery ?? (() => emptyClackQuery()),
      startThreadConversation: deps?.startThreadConversation,
      registerThreadSession: deps?.registerThreadSession,
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

  describe("readFileBuffer", () => {
    it("reads a file's bytes as a Buffer", async () => {
      const { sdk } = makeSdk();
      await sdk.writeFile("db.bin", "MMDB");
      const result = await sdk.readFileBuffer("db.bin");
      assert.ok(Buffer.isBuffer(result));
      assert.deepEqual(result, Buffer.from("MMDB"));
    });

    it("returns null for a non-existent file", async () => {
      const { sdk } = makeSdk();
      const result = await sdk.readFileBuffer("missing.mmdb");
      assert.equal(result, null);
    });

    it("rejects path traversal", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.readFileBuffer("../other/data.mmdb"), /Path traversal/);
    });

    it("rejects absolute paths", async () => {
      const { sdk } = makeSdk();
      await assert.rejects(() => sdk.readFileBuffer("/etc/passwd"), /Absolute paths/);
    });
  });

  describe("readFileOrSeed", () => {
    it("returns existing content without overwriting", async () => {
      const { sdk } = makeSdk();
      await sdk.writeFile("config.json", '{"existing":true}');
      const result = await sdk.readFileOrSeed("config.json", '{"default":true}');
      assert.equal(result, '{"existing":true}');
    });

    it("seeds the default when the file is missing", async () => {
      const { sdk } = makeSdk();
      const result = await sdk.readFileOrSeed("config.json", '{"default":true}');
      assert.equal(result, '{"default":true}');
      assert.equal(await sdk.readFile("config.json"), '{"default":true}');
    });

    it("returns the default and does not throw when the seed write fails", async () => {
      const { sdk } = makeSdk();
      const writeErr = new Error("EACCES: permission denied");
      const spy = vi.spyOn(sdk, "writeFile").mockRejectedValue(writeErr);
      const result = await sdk.readFileOrSeed("config.json", '{"default":true}');
      assert.equal(result, '{"default":true}');
      spy.mockRestore();
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

  describe("dmUser", () => {
    it("posts to the DM channel for the specified user", async () => {
      const client = new WebClient();
      const postSpy = vi.spyOn(client.chat, "postMessage").mockImplementation(async () => ({
        ok: true,
        ts: "123.456",
      }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        openDmChannel: async () => "D_USER",
      });

      const result = await sdk.dmUser("U_USER", "Hello user");

      assert.deepEqual(result, { ok: true });
      assert.equal(postSpy.mock.calls.length, 1);
      const args = postSpy.mock.calls[0][0];
      assert.equal(args?.channel, "D_USER");
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.equal(text, "Hello user");
    });

    it("fails cleanly when the Slack client is not connected", async () => {
      const { sdk } = makeSdk("trivia", { getSlackClient: () => null });
      const result = await sdk.dmUser("U_USER", "hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not connected/);
    });

    it("fails cleanly when the DM channel cannot be opened", async () => {
      const client = new WebClient();
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        openDmChannel: async () => null,
      });
      const result = await sdk.dmUser("U_USER", "hi");
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
        openDmChannel: async () => "D_USER",
      });
      const result = await sdk.dmUser("U_USER", "hi");
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
        openDmChannel: async () => "D_USER",
      });

      await sdk.dmUser("U_USER", "hi");

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
        openDmChannel: async () => "D_USER",
      });

      await sdk.dmUser("U_USER", "hi", { suppressUnfurls: true });

      const args = postSpy.mock.calls[0][0];
      assert.ok(args && "unfurl_links" in args);
      assert.equal(args.unfurl_links, false);
      assert.ok(args && "unfurl_media" in args);
      assert.equal(args.unfurl_media, false);
    });
  });

  describe("engageThread", () => {
    it("forwards a non-off level + origin + creationContext to the core helper", async () => {
      const calls: {
        channel: string;
        threadRoot: string;
        attentionLevel: AttentionLevel;
        origin: ThreadEngagementOrigin;
        creationContext?: string;
      }[] = [];
      const { sdk } = makeSdk("trivia", {
        registerThreadSession: async (channel, threadRoot, opts) => {
          calls.push({
            channel,
            threadRoot,
            attentionLevel: opts.attentionLevel,
            origin: opts.origin,
            creationContext: opts.creationContext,
          });
          return null;
        },
      });

      await sdk.engageThread("C1", "1700000000.000100", {
        attentionLevel: "high",
        origin: "opened",
        creationContext: "ctx",
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].channel, "C1");
      assert.equal(calls[0].threadRoot, "1700000000.000100");
      assert.equal(calls[0].attentionLevel, "high");
      assert.equal(calls[0].origin, "opened");
      assert.equal(calls[0].creationContext, "ctx");
    });

    it("forwards a joined origin so the core helper can clamp it", async () => {
      const origins: ThreadEngagementOrigin[] = [];
      const { sdk } = makeSdk("trivia", {
        registerThreadSession: async (channel, threadRoot, opts) => {
          assert.equal(channel, "C1");
          assert.equal(threadRoot, "T");
          origins.push(opts.origin);
          return null;
        },
      });

      await sdk.engageThread("C1", "T", { attentionLevel: "high", origin: "joined" });

      assert.deepEqual(origins, ["joined"]);
    });

    it("is a no-op for an omitted or off attention level", async () => {
      let called = 0;
      const { sdk } = makeSdk("trivia", {
        registerThreadSession: async () => {
          called++;
          return null;
        },
      });

      await sdk.engageThread("C1", "T", { origin: "opened" });
      await sdk.engageThread("C1", "T", { attentionLevel: "off", origin: "opened" });

      assert.equal(called, 0);
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
    // Injected cron-store deps as vitest mocks typed from the real signatures. The store's own
    // semantics (id assignment, name trimming, null-clearing) belong to src/cronJobs.ts and are
    // covered there — these tests assert only which dep reconcile calls with which arguments.
    let findByPluginOwner: Mock<NonNullable<ClackSdkDeps["findByPluginOwner"]>>;
    let createJob: Mock<NonNullable<ClackSdkDeps["createJob"]>>;
    let updateJob: Mock<NonNullable<ClackSdkDeps["updateJob"]>>;
    let deleteJob: Mock<NonNullable<ClackSdkDeps["deleteJob"]>>;

    // Data fixture for an existing plugin-managed job returned by findByPluginOwner.
    function pluginJob(overrides: Partial<CronJob> = {}): CronJob {
      return {
        id: "job-1",
        cronExpression: "0 9 * * 1-5",
        prompt: "embedded prompt",
        createdBy: null,
        systemActor: "plugin:trivia",
        createdAt: "2026-01-01T00:00:00.000Z",
        enabled: true,
        timezone: "America/New_York",
        channel: "C123ABC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "ops:question",
        ...overrides,
      };
    }

    function makeReconcileSdk(pluginName: string) {
      return makeSdk(pluginName, { findByPluginOwner, createJob, updateJob, deleteJob });
    }

    beforeEach(() => {
      findByPluginOwner = vi.fn<NonNullable<ClackSdkDeps["findByPluginOwner"]>>();
      createJob = vi.fn<NonNullable<ClackSdkDeps["createJob"]>>();
      updateJob = vi.fn<NonNullable<ClackSdkDeps["updateJob"]>>();
      deleteJob = vi.fn<NonNullable<ClackSdkDeps["deleteJob"]>>();
      findByPluginOwner.mockResolvedValue([]);
      createJob.mockImplementation(async (params) =>
        pluginJob({
          cronExpression: params.cronExpression,
          channel: params.channel,
          prompt: params.prompt,
          createdBy: params.createdBy,
          systemActor: params.systemActor,
          timezone: params.timezone,
          plugin: params.plugin,
          pluginManaged: params.pluginManaged,
          specKey: params.specKey,
          name: params.name,
          requiredTools: params.requiredTools,
          skipConditions: params.skipConditions,
          submitResponseMode: params.submitResponseMode,
          skipDates: params.skipDates,
          attachedTopics: params.attachedTopics,
          attentionLevel: params.attentionLevel,
          jitterMinutes: params.jitterMinutes,
        }),
      );
      updateJob.mockImplementation(async (id) => pluginJob({ id }));
      deleteJob.mockResolvedValue(true);
    });

    const validSpec = {
      specKey: "ops:question",
      cronExpression: "0 9 * * 1-5",
      channel: "C123ABC",
      prompt: "embedded prompt",
      timezone: "America/New_York",
      requiredTools: ["mcp__trivia__get_ideas"],
    };

    it("creates a new spec as pluginManaged with the right owner", async () => {
      const { sdk } = makeReconcileSdk("trivia");

      await sdk.reconcileCronJobs("trivia", [validSpec]);

      expect(createJob).toHaveBeenCalledTimes(1);
      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: "trivia",
          pluginManaged: true,
          specKey: "ops:question",
          cronExpression: "0 9 * * 1-5",
        }),
      );
    });

    it("passes createdBy: null and systemActor: plugin:<ownerKey> to createJob", async () => {
      const { sdk } = makeReconcileSdk("trivia");

      await sdk.reconcileCronJobs("trivia", [validSpec]);

      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: null, systemActor: "plugin:trivia" }),
      );
    });

    it("empty spec list deletes all owner-managed jobs", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-9", specKey: "ops:question" })]);

      await sdk.reconcileCronJobs("trivia", []);

      expect(deleteJob).toHaveBeenCalledWith("job-9");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("updates the matching spec in place by its id instead of recreating it", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-7", specKey: "ops:question" })]);

      await sdk.reconcileCronJobs("trivia", [
        { ...validSpec, cronExpression: "0 10 * * 1-5", prompt: "updated prompt" },
      ]);

      expect(updateJob).toHaveBeenCalledTimes(1);
      expect(updateJob).toHaveBeenCalledWith(
        "job-7",
        expect.objectContaining({ cronExpression: "0 10 * * 1-5", prompt: "updated prompt" }),
      );
      expect(createJob).not.toHaveBeenCalled();
    });

    it("removing a spec deletes the job even when admin had disabled it", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      findByPluginOwner.mockResolvedValue([
        pluginJob({ id: "job-3", specKey: "ops:question", enabled: false }),
      ]);

      await sdk.reconcileCronJobs("trivia", []);

      expect(deleteJob).toHaveBeenCalledWith("job-3");
    });

    it("scopes its read and deletions to its own owner key", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      findByPluginOwner.mockResolvedValue([pluginJob({ id: "trivia-1", specKey: "ops:question" })]);

      await sdk.reconcileCronJobs("trivia", []);

      // Owner scoping is delegated to findByPluginOwner: reconcile only removes jobs that read
      // returned, so jobs owned by other plugins/users (never in the result) go untouched.
      expect(findByPluginOwner).toHaveBeenCalledWith("trivia");
      expect(deleteJob).toHaveBeenCalledTimes(1);
      expect(deleteJob).toHaveBeenCalledWith("trivia-1");
    });

    it("skips invalid specs but applies valid neighbors", async () => {
      const { sdk } = makeReconcileSdk("trivia");

      await sdk.reconcileCronJobs("trivia", [
        validSpec,
        { ...validSpec, specKey: "bad", cronExpression: "not a cron" },
      ]);

      expect(createJob).toHaveBeenCalledTimes(1);
      expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ specKey: "ops:question" }));
      expect(createJob).not.toHaveBeenCalledWith(expect.objectContaining({ specKey: "bad" }));
    });

    it("skips a spec with an invalid attentionLevel without dropping siblings", async () => {
      const { sdk } = makeReconcileSdk("trivia");

      await sdk.reconcileCronJobs("trivia", [
        // @ts-expect-error — testing runtime guard
        { ...validSpec, specKey: "bad", attentionLevel: "off" },
        { ...validSpec, specKey: "good", attentionLevel: "high" },
      ]);

      expect(createJob).toHaveBeenCalledTimes(1);
      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({ specKey: "good", attentionLevel: "high" }),
      );
    });

    it("re-declaring an existing spec updates in place instead of recreating", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-5", specKey: "ops:question" })]);

      await sdk.reconcileCronJobs("trivia", [validSpec]);

      expect(updateJob).toHaveBeenCalledTimes(1);
      expect(updateJob).toHaveBeenCalledWith(
        "job-5",
        expect.objectContaining({
          cronExpression: validSpec.cronExpression,
          prompt: validSpec.prompt,
        }),
      );
      expect(createJob).not.toHaveBeenCalled();
      expect(deleteJob).not.toHaveBeenCalled();
    });

    it("throws on non-string ownerKey", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      await assert.rejects(
        () => sdk.reconcileCronJobs("", [validSpec]),
        /ownerKey must be a non-empty string/,
      );
    });

    it("throws on non-array specs", async () => {
      const { sdk } = makeReconcileSdk("trivia");
      // @ts-expect-error — testing runtime guard
      await assert.rejects(() => sdk.reconcileCronJobs("trivia", null), /specs must be an array/);
    });

    describe("skipDates persistence", () => {
      it("creates a job with skipDates when the spec carries them", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        const skipDates = [
          { date: "12-25", label: "Christmas" },
          { date: "01-01", label: "New Year's Day" },
        ];

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, skipDates }]);

        expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ skipDates }));
      });

      it("omits skipDates from createJob when the spec omits them", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("skipDates");
      });

      it("updates skipDates in place on an existing job when the spec changes", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        const second = [
          { date: "12-25", label: "Christmas" },
          { date: "07-01", label: "Summer Holiday" },
        ];
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, skipDates: second }]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ skipDates: second }),
        );
      });

      it("clears skipDates when a subsequent spec omits them", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(updateJob).toHaveBeenCalledWith("job-2", expect.objectContaining({ skipDates: [] }));
      });
    });

    describe("attachedTopics propagation", () => {
      it("persists attachedTopics through createJob when the spec sets it", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, attachedTopics: ["trivia"] }]);

        expect(createJob).toHaveBeenCalledWith(
          expect.objectContaining({ attachedTopics: ["trivia"] }),
        );
      });

      it("omits attachedTopics when the spec does not set it", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("attachedTopics");
      });

      it("updates attachedTopics in place when the spec changes the value", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [
          { ...validSpec, attachedTopics: ["trivia", "extra"] },
        ]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ attachedTopics: ["trivia", "extra"] }),
        );
      });

      it("clears attachedTopics when a subsequent spec omits the field", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ attachedTopics: [] }),
        );
      });
    });

    describe("submitResponseMode propagation", () => {
      it("persists submitResponseMode through createJob when the spec sets it", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "skipped" }]);

        expect(createJob).toHaveBeenCalledWith(
          expect.objectContaining({ submitResponseMode: "skipped" }),
        );
      });

      it("omits submitResponseMode when the spec does not set it", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("submitResponseMode");
      });

      it("updates submitResponseMode in place when the spec changes the value", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, submitResponseMode: "skipped" }]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ submitResponseMode: "skipped" }),
        );
      });

      it("clears submitResponseMode when a subsequent spec omits it", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ submitResponseMode: null }),
        );
      });
    });

    describe("name field", () => {
      it("passes name to createJob when the spec carries one (new entry)", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Trivia: daily question" }]);

        expect(createJob).toHaveBeenCalledWith(
          expect.objectContaining({ name: "Trivia: daily question" }),
        );
      });

      it("creates a nameless job when spec omits name", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("name");
      });

      it("adopts a name on re-reconcile when the spec now has one", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "Game A — daily" }]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ name: "Game A — daily" }),
        );
      });

      it("omits name from the update patch when the re-reconciled spec has none", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("trivia", [validSpec]);

        expect(updateJob).toHaveBeenCalledTimes(1);
        expect(updateJob.mock.calls[0][1]).not.toHaveProperty("name");
      });

      it("overwrites name when the spec provides a different one", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        findByPluginOwner.mockResolvedValue([
          pluginJob({ id: "job-2", specKey: "ops:question", name: "Old" }),
        ]);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "New" }]);

        expect(updateJob).toHaveBeenCalledWith("job-2", expect.objectContaining({ name: "New" }));
      });

      it("skips a spec whose name is too long", async () => {
        const { sdk } = makeReconcileSdk("trivia");
        const oversized = "x".repeat(81);

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: oversized }]);

        expect(createJob).not.toHaveBeenCalled();
        expect(updateJob).not.toHaveBeenCalled();
      });

      it("skips a spec whose name is whitespace-only", async () => {
        const { sdk } = makeReconcileSdk("trivia");

        await sdk.reconcileCronJobs("trivia", [{ ...validSpec, name: "   " }]);

        expect(createJob).not.toHaveBeenCalled();
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
        const { sdk } = makeReconcileSdk("casual-talk");

        await sdk.reconcileCronJobs("casual-talk", [channellessSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob).toHaveBeenCalledWith(
          expect.objectContaining({ pluginManaged: true, systemActor: "plugin:casual-talk" }),
        );
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("channel");
      });

      it("rejects a spec with an invalid channel string (regression for shape check)", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");

        await sdk.reconcileCronJobs("casual-talk", [
          { ...channellessSpec, channel: "not-a-channel-id" },
        ]);

        expect(createJob).not.toHaveBeenCalled();
      });

      it("clears the persisted channel when a previously-bound spec is re-reconciled without one", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");
        findByPluginOwner.mockResolvedValue([
          pluginJob({
            id: "job-2",
            specKey: "chatter",
            plugin: "casual-talk",
            channel: "C123ABC",
          }),
        ]);

        await sdk.reconcileCronJobs("casual-talk", [channellessSpec]);

        expect(updateJob).toHaveBeenCalledWith("job-2", expect.objectContaining({ channel: null }));
      });
    });

    describe("jitterMinutes", () => {
      it("persists jitterMinutes on create", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");

        await sdk.reconcileCronJobs("casual-talk", [{ ...validSpec, jitterMinutes: 5 }]);

        expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ jitterMinutes: 5 }));
      });

      it("creates a job without jitterMinutes when the spec omits it", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");

        await sdk.reconcileCronJobs("casual-talk", [validSpec]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob.mock.calls[0][0]).not.toHaveProperty("jitterMinutes");
      });

      it("updates jitterMinutes in place, preserving id", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("casual-talk", [{ ...validSpec, jitterMinutes: 8 }]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ jitterMinutes: 8 }),
        );
      });

      it("clears jitterMinutes on re-reconcile without it (declarative ownership)", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");
        findByPluginOwner.mockResolvedValue([pluginJob({ id: "job-2", specKey: "ops:question" })]);

        await sdk.reconcileCronJobs("casual-talk", [validSpec]);

        expect(updateJob).toHaveBeenCalledWith(
          "job-2",
          expect.objectContaining({ jitterMinutes: null }),
        );
      });

      it("skips a spec with an out-of-range jitterMinutes without dropping siblings", async () => {
        const { sdk } = makeReconcileSdk("casual-talk");

        await sdk.reconcileCronJobs("casual-talk", [
          { ...validSpec, specKey: "bad", jitterMinutes: 99 },
          { ...validSpec, specKey: "good", jitterMinutes: 4 },
        ]);

        expect(createJob).toHaveBeenCalledTimes(1);
        expect(createJob).toHaveBeenCalledWith(
          expect.objectContaining({ specKey: "good", jitterMinutes: 4 }),
        );
      });
    });
  });

  describe("delayed-boot catch-up surface", () => {
    const ownedJob = {
      id: "job-1",
      cronExpression: "0 10 * * *",
      prompt: "p",
      createdBy: null,
      systemActor: "plugin:test-plugin",
      createdAt: "2026-06-01T00:00:00.000Z",
      enabled: true,
      timezone: "UTC",
      plugin: "test-plugin",
      pluginManaged: true,
      specKey: "daily:question",
    };

    it("onDelayedBoot registers the handler under the plugin's name", () => {
      const registerDelayedBootHandler =
        vi.fn<(ownerKey: string, handler: () => void | Promise<void>) => void>();
      const { sdk } = makeSdk("test-plugin", { registerDelayedBootHandler });
      const handler = async () => {};

      sdk.onDelayedBoot(handler);

      assert.deepEqual(registerDelayedBootHandler.mock.calls[0], ["test-plugin", handler]);
    });

    it("missedRuns resolves the plugin's own job and returns computed dates", async () => {
      const dates = [new Date("2026-06-10T10:00:00.000Z")];
      const computeMissedRuns = vi.fn<(job: CronJob, now?: Date) => Date[]>(() => dates);
      const { sdk } = makeSdk("test-plugin", {
        findByPluginOwner: async () => [ownedJob],
        computeMissedRuns,
      });

      const result = await sdk.missedRuns("daily:question");

      assert.deepEqual(result, { lastExpectedRuns: dates });
      assert.equal(computeMissedRuns.mock.calls[0]?.[0], ownedJob);
    });

    it("missedRuns rejects an unknown specKey without leaking other owners' jobs", async () => {
      const { sdk } = makeSdk("test-plugin", {
        findByPluginOwner: async () => [ownedJob],
        computeMissedRuns: vi.fn(() => []),
      });

      await assert.rejects(() => sdk.missedRuns("other-plugin:reveal"), /other-plugin:reveal/);
    });

    it("runCronJobNow executes the resolved job with the live Slack client", async () => {
      const client = new WebClient("xoxb-test");
      const executeCronJob = vi.fn<(job: CronJob, client: WebClient) => Promise<void>>(
        async () => {},
      );
      const { sdk } = makeSdk("test-plugin", {
        findByPluginOwner: async () => [ownedJob],
        getSlackClient: () => client,
        executeCronJob,
      });

      await sdk.runCronJobNow("daily:question");

      assert.equal(executeCronJob.mock.calls[0]?.[0], ownedJob);
      assert.equal(executeCronJob.mock.calls[0]?.[1], client);
    });

    it("runCronJobNow rejects when no Slack client is available", async () => {
      const executeCronJob = vi.fn(async () => {});
      const { sdk } = makeSdk("test-plugin", {
        findByPluginOwner: async () => [ownedJob],
        getSlackClient: () => null,
        executeCronJob,
      });

      await assert.rejects(() => sdk.runCronJobNow("daily:question"), /no Slack client/);
      assert.equal(executeCronJob.mock.calls.length, 0);
    });

    it("runCronJobNow rejects an unknown specKey without executing anything", async () => {
      const client = new WebClient("xoxb-test");
      const executeCronJob = vi.fn(async () => {});
      const { sdk } = makeSdk("test-plugin", {
        findByPluginOwner: async () => [ownedJob],
        getSlackClient: () => client,
        executeCronJob,
      });

      await assert.rejects(() => sdk.runCronJobNow("nope"), /nope/);
      assert.equal(executeCronJob.mock.calls.length, 0);
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

  describe("registerPreferences", () => {
    it("registers toggle fields with schema and translates labels", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({
        en: { notify_pref: "Daily Notifications", vibrate_pref: "Vibrate on Answer" },
      });
      sdk.registerPreferences({
        schema: z.object({
          notifyDaily: z.boolean().optional(),
          vibrateOnAnswer: z.boolean().optional(),
        }),
        fields: [
          { key: "notifyDaily", type: "toggle", label: "notify_pref", default: false },
          { key: "vibrateOnAnswer", type: "toggle", label: "vibrate_pref", default: true },
        ],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.fields.length, 2);
      assert.equal(result.preferences.fields[0].key, "notifyDaily");
      assert.equal(result.preferences.fields[0].type, "toggle");
      assert.equal(result.preferences.fields[0].default, false);
      assert.equal(result.preferences.translate("notify_pref"), "Daily Notifications");
    });

    it("harvests an optional localized section title when provided", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: { section_title: "My Preferences", x: "X" } });
      sdk.registerPreferences({
        schema: z.record(z.string(), z.boolean()),
        title: "section_title",
        fields: [{ key: "a", type: "toggle", label: "x", default: false }],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.title, "section_title");
      assert.equal(result.preferences.translate(result.preferences.title!), "My Preferences");
    });

    it("leaves the title absent when not provided", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: { x: "X" } });
      sdk.registerPreferences({
        schema: z.record(z.string(), z.boolean()),
        fields: [{ key: "a", type: "toggle", label: "x", default: false }],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.title, undefined);
    });

    it("drops non-toggle field types", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: { x: "X" } });
      sdk.registerPreferences({
        schema: z.object({ a: z.boolean(), b: z.number() }),
        fields: [
          { key: "a", type: "toggle", label: "x", default: false },
          // @ts-expect-error — testing invalid field type
          { key: "b", type: "text", label: "x", default: false },
        ],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.fields.length, 1);
      assert.equal(result.preferences.fields[0].key, "a");
    });

    it("drops fields whose key is not on the schema", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: { x: "X" } });
      sdk.registerPreferences({
        schema: z.object({ aField: z.boolean() }),
        fields: [
          { key: "aField", type: "toggle", label: "x", default: false },
          { key: "bField", type: "toggle", label: "x", default: false },
        ],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.fields.length, 1);
      assert.equal(result.preferences.fields[0].key, "aField");
    });

    it("records an error when input is null or invalid", () => {
      const { sdk, harvest } = makeSdk();
      // @ts-expect-error — testing runtime guard
      sdk.registerPreferences(null);
      const result = harvest();
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /registerPreferences requires/);
    });

    it("leaves preferences absent when all fields are dropped", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: {} });
      sdk.registerPreferences({
        schema: z.object({ a: z.boolean() }),
        fields: [{ key: "b", type: "toggle", label: "x", default: false }],
      });
      const result = harvest();
      assert.equal(result.preferences, undefined);
    });

    it("includes preferences in harvest when fields are present", () => {
      const { sdk, harvest } = makeSdk();
      sdk.registerDictionary({ en: { label: "Label" } });
      sdk.registerPreferences({
        schema: z.object({ enabled: z.boolean() }),
        fields: [{ key: "enabled", type: "toggle", label: "label", default: true }],
      });
      const result = harvest();
      assert.ok(result.preferences);
      assert.equal(result.preferences.fields.length, 1);
    });
  });
});
