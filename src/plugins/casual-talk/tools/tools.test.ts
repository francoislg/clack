import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../sdk.js";
import { en as casualTalkEn, fr as casualTalkFr } from "../i18n/strings.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../config.js";
import { createSetConfigTool } from "./setConfig.js";
import {
  createAddChannelTool,
  createRemoveChannelTool,
  createSetChannelPromptSuggestionTool,
} from "./channels.js";
import { createAddSmallTalkTopicTool, createRemoveSmallTalkTopicTool } from "./topics.js";
import { createSetExpectedRateTool } from "./rate.js";
import { createSetWorkHoursTool } from "./workHours.js";
import { createEnableTool, createDisableTool } from "./toggle.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

interface ToolTextResultEntry {
  type: string;
  text: string;
}
interface ToolCallResult {
  content: ToolTextResultEntry[];
  isError?: boolean;
}
interface ParsedResult {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Type guard for the value any of our tool handlers may resolve with. */
function isToolCallResult(value: object): value is ToolCallResult {
  if (!("content" in value)) return false;
  const content = (value as { content: unknown }).content;
  return Array.isArray(content);
}

function parsePayload(text: string): ParsedResult {
  const obj: unknown = JSON.parse(text);
  if (typeof obj !== "object" || obj === null) return {};
  const candidate = obj as { ok?: unknown; message?: unknown; error?: unknown };
  const result: ParsedResult = {};
  if (typeof candidate.ok === "boolean") result.ok = candidate.ok;
  if (typeof candidate.message === "string") result.message = candidate.message;
  if (typeof candidate.error === "string") result.error = candidate.error;
  return result;
}

interface SdkBundle {
  sdk: ReturnType<typeof createClackSdk>["sdk"];
  restartCalls: string[];
}

function buildSdk(tempDir: string): SdkBundle {
  const restartCalls: string[] = [];
  const { sdk } = createClackSdk("casual-talk", tempDir, {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
    requestSoftRestart: (reason) => {
      restartCalls.push(reason);
    },
  });
  // Dictionary must be registered before tools call sdk.t — mirror the plugin's init.
  sdk.registerDictionary({ en: casualTalkEn, fr: casualTalkFr });
  return { sdk, restartCalls };
}

/**
 * Invoke a tool's handler with its inferred args type. Uses an `object`-typed return
 * (since the Anthropic SDK's exact handler result type is complex) and narrows via
 * a type guard. Tests don't exercise the `extra` parameter.
 */
async function invoke<Args>(
  tool: { handler: (args: Args, extra?: never) => Promise<object> },
  args: Args,
): Promise<{ raw: ToolCallResult; parsed: ParsedResult }> {
  const result = await tool.handler(args);
  if (!isToolCallResult(result)) {
    throw new Error(`tool handler returned non-ToolCallResult: ${JSON.stringify(result)}`);
  }
  const text = result.content[0]?.text ?? "{}";
  return { raw: result, parsed: parsePayload(text) };
}

describe("casual-talk admin tools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "casual-talk-tools-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("set_casual_talk_config", () => {
    it("replaces the config and triggers soft restart on valid input", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      const tool = createSetConfigTool(sdk);

      const { parsed } = await invoke(tool, {
        enabled: true,
        channels: ["C123"],
        workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
        expectedRate: "weekly" as const,
        die: undefined,
        smallTalkTopics: ["food"],
      });

      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);
      const persisted = await loadConfig(sdk);
      assert.equal(persisted.expectedRate, "weekly");
      assert.equal(persisted.channels[0], "C123");
    });

    it("rejects invalid config without triggering soft restart", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      const tool = createSetConfigTool(sdk);

      const { raw, parsed } = await invoke(tool, {
        enabled: true,
        channels: ["not-a-channel"],
        workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
        expectedRate: "daily" as const,
        die: undefined,
        smallTalkTopics: [],
      });

      assert.equal(raw.isError, true);
      assert.ok(parsed.error);
      assert.equal(restartCalls.length, 0);
    });
  });

  describe("add_channel / remove_channel / set_channel_prompt_suggestion", () => {
    it("add_channel appends a new bare-string channel and triggers soft restart", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createAddChannelTool(sdk);

      const { parsed } = await invoke(tool, { id: "C111", promptSuggestion: undefined });

      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);
      const config = await loadConfig(sdk);
      assert.deepEqual(config.channels, ["C111"]);
    });

    it("add_channel with promptSuggestion stores the object form", async () => {
      const { sdk } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createAddChannelTool(sdk);

      await invoke(tool, { id: "C111", promptSuggestion: "memes only" });

      const config = await loadConfig(sdk);
      assert.deepEqual(config.channels[0], { id: "C111", promptSuggestion: "memes only" });
    });

    it("add_channel on an existing id updates the prompt suggestion", async () => {
      const { sdk } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, channels: ["C111"] });
      const tool = createAddChannelTool(sdk);

      await invoke(tool, { id: "C111", promptSuggestion: "new hint" });

      const config = await loadConfig(sdk);
      assert.deepEqual(config.channels[0], { id: "C111", promptSuggestion: "new hint" });
    });

    it("remove_channel removes an existing channel; errors when not found", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, channels: ["C111", "C222"] });
      const tool = createRemoveChannelTool(sdk);

      const { parsed } = await invoke(tool, { id: "C111" });
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);
      let config = await loadConfig(sdk);
      assert.deepEqual(config.channels, ["C222"]);

      const { raw } = await invoke(tool, { id: "C999" });
      assert.equal(raw.isError, true);
      assert.equal(restartCalls.length, 1, "no restart on not-found");
      config = await loadConfig(sdk);
      assert.deepEqual(config.channels, ["C222"]);
    });

    it("set_channel_prompt_suggestion clears the suggestion when given empty string", async () => {
      const { sdk } = buildSdk(tempDir);
      await saveConfig(sdk, {
        ...DEFAULT_CONFIG,
        channels: [{ id: "C111", promptSuggestion: "old hint" }],
      });
      const tool = createSetChannelPromptSuggestionTool(sdk);

      await invoke(tool, { id: "C111", promptSuggestion: "" });

      const config = await loadConfig(sdk);
      assert.equal(
        config.channels[0],
        "C111",
        "object reverts to bare string when suggestion cleared",
      );
    });
  });

  describe("add_small_talk_topic / remove_small_talk_topic", () => {
    it("add_small_talk_topic appends and triggers restart; duplicate is no-op (no restart)", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createAddSmallTalkTopicTool(sdk);

      await invoke(tool, { topic: "food" });
      assert.equal(restartCalls.length, 1);

      await invoke(tool, { topic: "food" });
      assert.equal(restartCalls.length, 1, "duplicate add is no-op — no extra restart");

      const config = await loadConfig(sdk);
      assert.deepEqual(config.smallTalkTopics, ["food"]);
    });

    it("remove_small_talk_topic removes existing; errors when not found", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, smallTalkTopics: ["food", "weekend"] });
      const tool = createRemoveSmallTalkTopicTool(sdk);

      const { parsed } = await invoke(tool, { topic: "food" });
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const { raw } = await invoke(tool, { topic: "nonexistent" });
      assert.equal(raw.isError, true);
      assert.equal(restartCalls.length, 1, "no restart on not-found");
    });
  });

  describe("set_expected_rate", () => {
    it("sets a named rate and clears die", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, die: 50 });
      const tool = createSetExpectedRateTool(sdk);

      const { parsed } = await invoke(tool, { rate: "weekly" as const, die: undefined });
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const config = await loadConfig(sdk);
      assert.equal(config.expectedRate, "weekly");
      assert.equal(config.die, undefined);
    });

    it("sets an explicit die", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createSetExpectedRateTool(sdk);

      const { parsed } = await invoke(tool, { die: 17, rate: undefined });
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const config = await loadConfig(sdk);
      assert.equal(config.die, 17);
    });

    it("rejects calls with neither rate nor die", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createSetExpectedRateTool(sdk);

      const { raw } = await invoke(tool, { rate: undefined, die: undefined });
      assert.equal(raw.isError, true);
      assert.equal(restartCalls.length, 0);
    });
  });

  describe("set_work_hours", () => {
    it("updates work hours on valid input", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createSetWorkHoursTool(sdk);

      const { parsed } = await invoke(tool, {
        start: 8,
        end: 18,
        tz: "America/Montreal",
        days: [1, 2, 3, 4],
      });
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const config = await loadConfig(sdk);
      assert.equal(config.workHours.start, 8);
      assert.equal(config.workHours.end, 18);
      assert.equal(config.workHours.tz, "America/Montreal");
      assert.deepEqual(config.workHours.days, [1, 2, 3, 4]);
    });

    it("rejects start >= end (wrap-around)", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createSetWorkHoursTool(sdk);

      const { raw } = await invoke(tool, {
        start: 20,
        end: 8,
        tz: "UTC",
        days: [1, 2, 3, 4, 5],
      });
      assert.equal(raw.isError, true);
      assert.equal(restartCalls.length, 0);
    });

    it("rejects invalid timezone", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createSetWorkHoursTool(sdk);

      const { raw } = await invoke(tool, {
        start: 9,
        end: 17,
        tz: "Not/A/Timezone",
        days: [1, 2, 3, 4, 5],
      });
      assert.equal(raw.isError, true);
      assert.equal(restartCalls.length, 0);
    });
  });

  describe("enable / disable (idempotent)", () => {
    it("enable flips disabled → enabled and triggers restart", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createEnableTool(sdk);

      const { parsed } = await invoke(tool, {});
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const config = await loadConfig(sdk);
      assert.equal(config.enabled, true);
    });

    it("enable on already-enabled is no-op (no restart)", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, enabled: true });
      const tool = createEnableTool(sdk);

      const { parsed } = await invoke(tool, {});
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 0, "no restart on already-enabled");
    });

    it("disable flips enabled → disabled and triggers restart", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, enabled: true });
      const tool = createDisableTool(sdk);

      const { parsed } = await invoke(tool, {});
      assert.equal(parsed.ok, true);
      assert.equal(restartCalls.length, 1);

      const config = await loadConfig(sdk);
      assert.equal(config.enabled, false);
    });

    it("disable on already-disabled is no-op (no restart)", async () => {
      const { sdk, restartCalls } = buildSdk(tempDir);
      await saveConfig(sdk, DEFAULT_CONFIG);
      const tool = createDisableTool(sdk);

      await invoke(tool, {});
      assert.equal(restartCalls.length, 0, "no restart on already-disabled");
    });
  });
});
