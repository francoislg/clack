import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import {
  executeJob,
  humanReadableSchedule,
  matchesCron,
  notifyCreatorOfError,
  type CronSchedulerDeps,
} from "./cronScheduler.js";
import type { CronJob } from "./cronJobs.js";
import type { ClaudeResponse } from "./claude/index.js";

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

    it("suggests inviting Clack when channel_not_found on a regular channel", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "An API error occurred: channel_not_found");

      const args = postSpy.mock.calls[0].arguments[0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /<#C456>/);
      assert.match(text, /isn't a member/);
      assert.match(text, /\/invite @Clack/);
      assert.doesNotMatch(text, /channel_not_found/);
    });

    it("explains DM inaccessibility when channel_not_found on a DM target", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      const dmJob: CronJob = { ...job, channel: "D0AHVHZTZ9G" };
      await notifyCreatorOfError(dmJob, client, "An API error occurred: channel_not_found");

      const args = postSpy.mock.calls[0].arguments[0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /`D0AHVHZTZ9G`/);
      assert.match(text, /DM Clack isn't part of/);
      assert.doesNotMatch(text, /\/invite/);
    });

    it("also treats not_in_channel as an access error", async () => {
      const client = new WebClient();
      mock.method(client.conversations, "open", async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = mock.method(client.chat, "postMessage", async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "not_in_channel");

      const args = postSpy.mock.calls[0].arguments[0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /\/invite @Clack/);
    });
  });

  describe("executeJob (skip outcome)", () => {
    function fakeClient(): WebClient {
      const client = new WebClient();
      mock.method(client.auth, "test", async () => ({ ok: true, url: "https://t.slack.com/" }));
      mock.method(client.conversations, "info", async () => ({
        ok: true,
        channel: { id: "C456", name: "ops", is_im: false },
      }));
      return client;
    }

    function baseJob(overrides: Partial<CronJob> = {}): CronJob {
      return {
        id: "job-skip-1",
        cronExpression: "0 9 * * *",
        channel: "C456",
        prompt: "Summarize PRs",
        createdBy: "U123",
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: "UTC",
        ...overrides,
      };
    }

    function makeDeps(responseOverride: Partial<ClaudeResponse> = {}): {
      deps: CronSchedulerDeps;
      calls: {
        processMessage: Parameters<CronSchedulerDeps["processMessage"]>[0][];
        updateJobRunStatus: Parameters<CronSchedulerDeps["updateJobRunStatus"]>[];
        deleteJob: Parameters<CronSchedulerDeps["deleteJob"]>[];
        notifyCreatorOfError: Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[];
      };
    } {
      const calls = {
        processMessage: [] as Parameters<CronSchedulerDeps["processMessage"]>[0][],
        updateJobRunStatus: [] as Parameters<CronSchedulerDeps["updateJobRunStatus"]>[],
        deleteJob: [] as Parameters<CronSchedulerDeps["deleteJob"]>[],
        notifyCreatorOfError: [] as Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[],
      };
      const deps: CronSchedulerDeps = {
        processMessage: async (params) => {
          calls.processMessage.push(params);
          return {
            success: true,
            answer: "",
            ...responseOverride,
          };
        },
        updateJobRunStatus: async (...args) => {
          calls.updateJobRunStatus.push(args);
        },
        deleteJob: async (...args) => {
          calls.deleteJob.push(args);
          return true;
        },
        notifyCreatorOfError: async (...args) => {
          calls.notifyCreatorOfError.push(args);
        },
      };
      return { deps, calls };
    }

    it("records 'skipped' and does NOT DM creator when Claude skips", async () => {
      const { deps, calls } = makeDeps({ skipped: true });
      const client = fakeClient();

      await executeJob(baseJob({ skipConditions: "Skip on weekends" }), client, deps);

      assert.equal(calls.updateJobRunStatus.length, 1);
      assert.equal(calls.updateJobRunStatus[0][0], "job-skip-1");
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
      assert.equal(calls.updateJobRunStatus[0][2], undefined, "skipped runs have no responseTs");
      assert.equal(calls.notifyCreatorOfError.length, 0, "skip is intentional, not an error");
    });

    it("passes job.skipConditions to processMessage", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob({ skipConditions: "Skip if nothing changed" }), client, deps);

      assert.equal(calls.processMessage.length, 1);
      assert.equal(calls.processMessage[0].skipConditions, "Skip if nothing changed");
      assert.equal(calls.processMessage[0].triggerType, "scheduled");
    });

    it("cleans up one-shot jobs after a skipped run", async () => {
      const { deps, calls } = makeDeps({ skipped: true });
      const client = fakeClient();

      await executeJob(baseJob({ oneShot: true, skipConditions: "Skip always" }), client, deps);

      assert.equal(calls.deleteJob.length, 1);
      assert.equal(calls.deleteJob[0][0], "job-skip-1");
    });

    it("records 'success' with responseTs on normal (non-skipped) runs", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob(), client, deps);

      assert.equal(calls.updateJobRunStatus[0][1], "success");
      // responseTs comes from findSessionByMessage which returns undefined without a real session
    });
  });
});
