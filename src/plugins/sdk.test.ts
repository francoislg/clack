import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { WebClient } from "@slack/web-api";
import { createClackSdk, type ClackSdkDeps } from "./sdk.js";
import type { RolesConfig } from "../roles.js";

const EMPTY_ROLES: RolesConfig = { owner: null, admins: [], devs: [] };

describe("ClackSdk", () => {
  function makeSdk(pluginName = "test-plugin", deps?: Partial<ClackSdkDeps>) {
    const dataDir = mkdtempSync(join(tmpdir(), "clack-sdk-test-"));
    const fullDeps: ClackSdkDeps = {
      getSlackClient: deps?.getSlackClient ?? (() => null),
      loadRoles: deps?.loadRoles ?? (async () => EMPTY_ROLES),
      openDmChannel: deps?.openDmChannel ?? (async () => null),
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
      const postSpy = mock.method(client.chat, "postMessage", async () => ({
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
      assert.equal(postSpy.mock.callCount(), 1);
      const args = postSpy.mock.calls[0].arguments[0];
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
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => EMPTY_ROLES,
      });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /No owner is configured/);
      assert.equal(postSpy.mock.callCount(), 0);
    });

    it("fails cleanly when the DM channel cannot be opened", async () => {
      const client = new WebClient();
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));
      const { sdk } = makeSdk("trivia", {
        getSlackClient: () => client,
        loadRoles: async () => ({ owner: "U_OWNER", admins: [], devs: [] }),
        openDmChannel: async () => null,
      });
      const result = await sdk.dmOwner("hi");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /Could not open a DM/);
      assert.equal(postSpy.mock.callCount(), 0);
    });

    it("returns the error string when chat.postMessage throws", async () => {
      const client = new WebClient();
      mock.method(client.chat, "postMessage", async () => {
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
  });
});
