import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { casualTalkPlugin } from "./index.js";
import { DEFAULT_CONFIG, saveConfig } from "./config.js";
import type { CasualTalkConfig } from "./types.js";
import type { CronJob, CreateCronJobParams, UpdateCronJobParams } from "../../plugins-sdk/sdk.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

interface FakeStore {
  jobs: CronJob[];
  createCalls: CreateCronJobParams[];
  updateCalls: Array<{ id: string; params: UpdateCronJobParams }>;
  deleteCalls: string[];
}

function makeFakeStore(): FakeStore {
  return { jobs: [], createCalls: [], updateCalls: [], deleteCalls: [] };
}

function makeFakeStoreDeps(store: FakeStore) {
  let nextId = 1;
  return {
    findByPluginOwner: async (ownerKey: string): Promise<CronJob[]> => {
      return store.jobs.filter((j) => j.plugin === ownerKey && j.pluginManaged === true);
    },
    createJob: async (params: CreateCronJobParams): Promise<CronJob> => {
      store.createCalls.push(params);
      const job: CronJob = {
        id: `job-${nextId++}`,
        cronExpression: params.cronExpression,
        ...(params.channel !== undefined ? { channel: params.channel } : {}),
        prompt: params.prompt,
        createdBy: params.createdBy,
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: params.timezone,
        ...(params.name ? { name: params.name } : {}),
        ...(params.systemActor ? { systemActor: params.systemActor } : {}),
        ...(params.plugin ? { plugin: params.plugin } : {}),
        ...(params.pluginManaged ? { pluginManaged: true } : {}),
        ...(params.specKey ? { specKey: params.specKey } : {}),
        ...(params.submitResponseMode ? { submitResponseMode: params.submitResponseMode } : {}),
        ...(params.attachedTopics && params.attachedTopics.length > 0
          ? { attachedTopics: params.attachedTopics }
          : {}),
        ...(params.requiredTools && params.requiredTools.length > 0
          ? { requiredTools: params.requiredTools }
          : {}),
      };
      store.jobs.push(job);
      return job;
    },
    updateJob: async (id: string, params: UpdateCronJobParams): Promise<CronJob | null> => {
      store.updateCalls.push({ id, params });
      const job = store.jobs.find((j) => j.id === id);
      if (!job) return null;
      if (params.cronExpression !== undefined) job.cronExpression = params.cronExpression;
      if (params.prompt !== undefined) job.prompt = params.prompt;
      if (params.channel !== undefined) {
        job.channel = params.channel === null ? undefined : params.channel;
      }
      return job;
    },
    deleteJob: async (id: string): Promise<boolean> => {
      store.deleteCalls.push(id);
      const idx = store.jobs.findIndex((j) => j.id === id);
      if (idx < 0) return false;
      store.jobs.splice(idx, 1);
      return true;
    },
  };
}

describe("casual-talk plugin load", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "casual-talk-plugin-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildSdk(store: FakeStore, capabilities = { crons: true }) {
    return createClackSdk("casual-talk", tempDir, {
      getSlackClient: () => null,
      loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
      openDmChannel: async () => null,
      clackQuery: emptyClackQuery,
      capabilities,
      ...makeFakeStoreDeps(store),
    });
  }

  it("refuses to load when cron scheduler is disabled", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store, { crons: false });

    await casualTalkPlugin(sdk);
    const result = harvest();

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Casual-talk requires the cron scheduler/);
    assert.equal(result.tools.length, 0);
    assert.equal(result.instructions.length, 0);
    assert.equal(store.createCalls.length, 0);
  });

  it("registers the management and engagement servers with autoload: false", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store);

    await casualTalkPlugin(sdk);
    const result = harvest();

    assert.equal(result.mcpServers.length, 2, "two on-demand servers (management + engagement)");
    const management = result.mcpServers.find((s) => s.key === "management");
    assert.ok(management);
    assert.equal(management.fullName, "casual-talk:management");
    assert.equal(management.autoload, false);
    const engagement = result.mcpServers.find((s) => s.key === "engagement");
    assert.ok(engagement, "engagement server must be registered");
    assert.equal(engagement.fullName, "casual-talk:engagement");
    assert.equal(engagement.autoload, false);
  });

  it("binds the engagement instructions to the engagement topic with NO tools", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store);

    await casualTalkPlugin(sdk);
    const result = harvest();

    const engagement = result.instructions.find(
      (i) => i.filename === "topics/casual-talk:engagement/casual-talk__engagement.md",
    );
    assert.ok(engagement, "engagement topic instruction must be registered");
    assert.equal(engagement.role, "user");
    assert.match(engagement.content, /fetch_channel_messages/);
    assert.match(engagement.content, /attention_level: "high"/);
    // Instructions-only server: no tool is bound to the engagement server.
    assert.ok(
      result.tools.every((t) => t.serverKey !== "engagement"),
      "no tools may live on the engagement server",
    );
  });

  it("registers all 11 management tools, each scoped to the management server", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store);

    await casualTalkPlugin(sdk);
    const result = harvest();

    const expected = [
      "set_casual_talk_config",
      "add_channel",
      "remove_channel",
      "set_channel_prompt_suggestion",
      "add_small_talk_topic",
      "remove_small_talk_topic",
      "set_expected_rate",
      "set_work_hours",
      "enable",
      "disable",
      "toggle_builtin_fallback_topics",
    ];
    const toolNames = result.tools.map((t) => t.name);
    for (const name of expected) {
      assert.ok(toolNames.includes(name), `expected tool '${name}' to be registered`);
    }
    // Every tool is bound to the management server (serverKey === "management")
    for (const tool of result.tools) {
      assert.equal(
        tool.serverKey,
        "management",
        `tool '${tool.name}' must be on the management server`,
      );
      assert.equal(tool.minRole, "admin", `tool '${tool.name}' must be admin-only`);
    }
  });

  it("registers persona under the casual-talk topic for the user role", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store);

    await casualTalkPlugin(sdk);
    const result = harvest();

    const persona = result.instructions.find(
      (i) => i.filename === "topics/casual-talk/casual-talk__persona.md",
    );
    assert.ok(persona, "persona instruction must be registered");
    assert.equal(persona.role, "user");
    assert.match(persona.content, /casual-talk persona/i);
  });

  it("reconciles NO cron spec when config is disabled (default first-boot)", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);

    await casualTalkPlugin(sdk);

    assert.equal(store.createCalls.length, 0, "no jobs created when enabled: false");
    assert.equal(store.jobs.length, 0);
  });

  it("reconciles NO cron spec when enabled but channels is empty", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);

    // Seed config: enabled, but channels empty
    await saveConfig(sdk, { ...DEFAULT_CONFIG, enabled: true });

    await casualTalkPlugin(sdk);

    assert.equal(store.createCalls.length, 0);
  });

  it("reconciles ONE channelless spec when enabled with channels", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);

    const config: CasualTalkConfig = {
      enabled: true,
      channels: ["C111", { id: "C222", promptSuggestion: "memes only" }],
      workHours: { start: 9, end: 16, tz: "UTC", days: [1, 2, 3, 4, 5] },
      expectedRate: "daily",
      smallTalkTopics: ["food", "weekend plans"],
      useBuiltinFallbackTopics: true,
    };
    await saveConfig(sdk, config);

    await casualTalkPlugin(sdk);

    assert.equal(store.createCalls.length, 1, "exactly one cron spec reconciled");
    const created = store.createCalls[0];
    assert.equal(created.channel, undefined, "spec must be channelless");
    assert.equal(created.specKey, "chatter");
    assert.equal(created.plugin, "casual-talk");
    assert.equal(created.pluginManaged, true);
    assert.equal(created.submitResponseMode, "optional-post-to");
    assert.deepEqual(created.requiredTools, ["mcp__clack__random_roll"]);
    assert.deepEqual(
      created.attachedTopics,
      ["casual-talk"],
      "response-rendering attaches at hit time, not via the spec",
    );
    assert.equal(created.name, "Casual chatter");
    // Internal jitter constant carried onto the spec; must stay below the 15-minute cadence.
    assert.ok(
      typeof created.jitterMinutes === "number" &&
        created.jitterMinutes > 0 &&
        created.jitterMinutes < 15,
      `expected 0 < jitterMinutes < 15, got ${created.jitterMinutes}`,
    );
    // Cron expression for 9-16 weekdays
    assert.equal(created.cronExpression, "*/15 9-15 * * 1,2,3,4,5");
    // Prompt embeds the channel IDs and topics
    assert.ok(created.prompt.includes("C111"));
    assert.ok(created.prompt.includes("C222"));
    assert.ok(created.prompt.includes("memes only"));
    assert.ok(created.prompt.includes("food"));
    assert.ok(created.prompt.includes("weekend plans"));
    // Prompt embeds the resolved die (daily over 9-16 weekdays = 28)
    assert.ok(created.prompt.includes("1/28"));
  });

  it("removes a previously-reconciled spec when re-loaded with disabled config", async () => {
    const store = makeFakeStore();

    // First boot: enabled with channels — creates a job
    {
      const { sdk } = buildSdk(store);
      await saveConfig(sdk, {
        ...DEFAULT_CONFIG,
        enabled: true,
        channels: ["C111"],
      });
      await casualTalkPlugin(sdk);
    }
    assert.equal(store.jobs.length, 1);

    // Second boot: disabled — removes the job
    {
      const { sdk } = buildSdk(store);
      await saveConfig(sdk, { ...DEFAULT_CONFIG, enabled: false, channels: ["C111"] });
      await casualTalkPlugin(sdk);
    }
    assert.equal(store.jobs.length, 0, "spec removed when disabled");
    assert.equal(store.deleteCalls.length, 1);
  });

  it("registers the EN dictionary", async () => {
    const store = makeFakeStore();
    const { sdk, harvest } = buildSdk(store);

    await casualTalkPlugin(sdk);
    harvest();

    // sdk.t should resolve a known key without throwing
    const text = sdk.t("enabled");
    assert.equal(text, "Casual-talk enabled.");
  });
});
