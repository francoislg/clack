import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import {
  computeEffectiveRequiredTools,
  humanReadableSchedule,
  matchesCron,
  notifyCreatorOfError,
} from "./cronScheduler.js";
import type { CronJob } from "./cronJobs.js";
import { setLoadedPlugins } from "./plugins/state.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { PluginLoadResult } from "./plugins/sdk.js";

function stubPlugin(name: string, scheduledRequiredTools: string[]): PluginLoadResult {
  return {
    name,
    instructions: [],
    tools: [],
    toolMappings: new Map(),
    mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools: [] }),
    scheduledRequiredTools,
  };
}

function job(partial: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    cronExpression: "0 9 * * *",
    channel: "C1",
    prompt: "do things",
    createdBy: "U1",
    createdAt: "2026-04-13T00:00:00Z",
    enabled: true,
    timezone: "UTC",
    ...partial,
  };
}

describe("cronScheduler", () => {
  describe("humanReadableSchedule", () => {
    it("formats daily schedule", () => {
      const result = humanReadableSchedule("0 9 * * *", "America/New_York");
      assert.match(result, /Every day at/);
      assert.match(result, /9:00/);
    });

    it("formats weekly schedule", () => {
      const result = humanReadableSchedule("0 9 * * 1", "UTC");
      assert.match(result, /Mon/);
      assert.match(result, /9:00/);
    });

    it("formats weekday schedule", () => {
      const result = humanReadableSchedule("0 9 * * 1-5", "UTC");
      assert.match(result, /Weekdays at/);
    });

    it("formats monthly schedule", () => {
      const result = humanReadableSchedule("0 9 15 * *", "UTC");
      assert.match(result, /Day 15/);
    });

    it("returns raw expression for invalid cron", () => {
      const result = humanReadableSchedule("invalid", "UTC");
      assert.equal(result, "invalid");
    });
  });

  describe("matchesCron", () => {
    it("matches when now is within the cron minute", () => {
      // Cron fires at minute 0 of every hour; check at HH:00:30
      const now = new Date("2026-03-31T09:00:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), true);
    });

    it("does not match when outside the cron minute", () => {
      const now = new Date("2026-03-31T09:01:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), false);
    });

    it("does not match before the cron time", () => {
      const now = new Date("2026-03-31T08:59:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), false);
    });

    it("skips when lastRunAt already covers this cron time", () => {
      const now = new Date("2026-03-31T09:00:55Z");
      const lastRunAt = new Date("2026-03-31T09:00:10Z").toISOString();
      assert.equal(matchesCron("0 9 * * *", now, "UTC", lastRunAt), false);
    });

    it("fires when lastRunAt is from a previous cron time", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      const lastRunAt = new Date("2026-03-30T09:00:10Z").toISOString();
      assert.equal(matchesCron("0 9 * * *", now, "UTC", lastRunAt), true);
    });

    it("fires when no lastRunAt is set", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC", undefined), true);
    });
  });

  describe("notifyCreatorOfError", () => {
    const job: CronJob = {
      id: "job-1",
      cronExpression: "0 9 * * *",
      channel: "C456",
      prompt: "test",
      createdBy: "U123",
      createdAt: new Date().toISOString(),
      enabled: true,
      timezone: "UTC",
    };

    it("skips posting when the DM channel cannot be opened", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => ({ ok: false }));
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "boom");

      assert.equal(
        postSpy.mock.callCount(),
        0,
        "postMessage should not be called when DM open fails",
      );
    });

    it("skips posting when conversations.open throws", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => {
        throw new Error("user_not_found");
      });
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "boom");

      assert.equal(postSpy.mock.callCount(), 0);
    });

    it("posts to the resolved DM channel when open succeeds", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "something went wrong");

      assert.equal(postSpy.mock.callCount(), 1);
      const args = postSpy.mock.calls[0].arguments[0];
      assert.equal(args?.channel, "D789");
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /something went wrong/);
    });
  });

  describe("computeEffectiveRequiredTools", () => {
    it("returns undefined when neither explicit nor plugin defaults", () => {
      setLoadedPlugins({ results: [] });
      assert.equal(computeEffectiveRequiredTools(job({})), undefined);
    });

    it("returns explicit tools when only explicit are set", () => {
      setLoadedPlugins({ results: [] });
      assert.deepEqual(
        computeEffectiveRequiredTools(job({ requiredTools: ["mcp__trivia__save_question"] })),
        ["mcp__trivia__save_question"],
      );
    });

    it("adds plugin defaults prefixed to full MCP name when plugin is linked and loaded", () => {
      setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers"])] });
      assert.deepEqual(computeEffectiveRequiredTools(job({ plugin: "trivia" })), [
        "mcp__trivia__submit_answers",
      ]);
    });

    it("unions explicit and plugin defaults", () => {
      setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers"])] });
      assert.deepEqual(
        computeEffectiveRequiredTools(
          job({ plugin: "trivia", requiredTools: ["mcp__trivia__save_question"] }),
        ),
        ["mcp__trivia__save_question", "mcp__trivia__submit_answers"],
      );
    });

    it("deduplicates when explicit already includes the plugin default", () => {
      setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers"])] });
      assert.deepEqual(
        computeEffectiveRequiredTools(
          job({ plugin: "trivia", requiredTools: ["mcp__trivia__submit_answers"] }),
        ),
        ["mcp__trivia__submit_answers"],
      );
    });

    it("does not apply plugin defaults when cron has no plugin link", () => {
      setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers"])] });
      assert.equal(computeEffectiveRequiredTools(job({})), undefined);
    });

    it("logs warning and applies no defaults when plugin is unknown", () => {
      setLoadedPlugins({ results: [] });
      assert.equal(computeEffectiveRequiredTools(job({ plugin: "not-loaded" })), undefined);
    });
  });
});
