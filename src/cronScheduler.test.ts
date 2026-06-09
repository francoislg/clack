import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import {
  executeJob,
  matchesCron,
  matchesSkipDate,
  notifyCreatorOfError,
  seededOffsetMs,
  shouldSkipUserJob,
  type CronSchedulerDeps,
  type NotifyErrorDeps,
} from "./cronScheduler.js";
import type { CronJob } from "./cronJobs.js";
import type { ClaudeResponse } from "./claude/index.js";
import type { RolesConfig } from "./roles.js";

function makeNotifyDeps(roles: RolesConfig): NotifyErrorDeps {
  return {
    loadRoles: async () => roles,
  };
}

describe("cronScheduler", () => {
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
      assert.equal(matchesCron("0 9 * * *", now, "UTC", { lastRunAt }), false);
    });

    it("fires when lastRunAt is from a previous cron time", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      const lastRunAt = new Date("2026-03-30T09:00:10Z").toISOString();
      assert.equal(matchesCron("0 9 * * *", now, "UTC", { lastRunAt }), true);
    });

    it("fires when no lastRunAt is set", () => {
      const now = new Date("2026-03-31T09:00:30Z");
      assert.equal(matchesCron("0 9 * * *", now, "UTC"), true);
    });
  });

  describe("seededOffsetMs", () => {
    const slot = new Date("2026-03-31T09:00:00Z");

    it("returns 0 when jitter is absent or non-positive", () => {
      assert.equal(seededOffsetMs("job-a", slot, 0), 0);
      assert.equal(seededOffsetMs("job-a", slot, -5), 0);
    });

    it("is deterministic across calls", () => {
      assert.equal(seededOffsetMs("job-a", slot, 8), seededOffsetMs("job-a", slot, 8));
    });

    it("stays within [0, jitterMinutes*60_000)", () => {
      for (let i = 0; i < 200; i++) {
        const o = seededOffsetMs(`job-${i}`, slot, 8);
        assert.ok(o >= 0 && o < 8 * 60_000, `offset ${o} out of range`);
      }
    });

    it("varies across occurrences (different canonical slots)", () => {
      const offsets = new Set<number>();
      for (let d = 0; d < 30; d++) {
        offsets.add(seededOffsetMs("job-a", new Date(slot.getTime() + d * 86_400_000), 8));
      }
      assert.ok(offsets.size > 5, `expected spread, got ${offsets.size} distinct offsets`);
    });

    it("spreads across the available minute buckets (no gross clustering)", () => {
      const buckets = new Set<number>();
      for (let d = 0; d < 100; d++) {
        const occ = new Date(slot.getTime() + d * 86_400_000);
        buckets.add(Math.floor(seededOffsetMs("job-a", occ, 8) / 60_000));
      }
      assert.ok(buckets.size >= 6, `expected good spread, got ${buckets.size}/8 buckets`);
    });
  });

  describe("matchesCron with jitter", () => {
    const cron = "0 9 * * *";
    const slot = new Date("2026-03-31T09:00:00Z");
    const jobId = "job-a";
    const jitter = 8;
    const offset = seededOffsetMs(jobId, slot, jitter);

    it("fires within the shifted 60s window, not before it", () => {
      const inWindow = new Date(slot.getTime() + offset + 30_000);
      assert.equal(matchesCron(cron, inWindow, "UTC", { jobId, jitterMinutes: jitter }), true);
      const beforeWindow = new Date(slot.getTime() + offset - 1_000);
      assert.equal(matchesCron(cron, beforeWindow, "UTC", { jobId, jitterMinutes: jitter }), false);
    });

    it("does not fire on the canonical slot when the offset delays past the first minute", () => {
      // Pick a seed whose offset clearly exceeds the first 60s window.
      let delayed = "";
      for (let i = 0; i < 1000; i++) {
        if (seededOffsetMs(`seek-${i}`, slot, jitter) >= 120_000) {
          delayed = `seek-${i}`;
          break;
        }
      }
      assert.ok(delayed.length > 0, "expected to find a seed with offset >= 2min");
      const atSlot = new Date(slot.getTime() + 30_000);
      assert.equal(
        matchesCron(cron, atSlot, "UTC", { jobId: delayed, jitterMinutes: jitter }),
        false,
      );
    });

    it("matches exactly one tick across the occurrence (no multi/missed fire)", () => {
      let matches = 0;
      for (let m = 0; m < 15; m++) {
        const now = new Date(slot.getTime() + m * 60_000 + 30_000);
        if (matchesCron(cron, now, "UTC", { jobId, jitterMinutes: jitter })) matches++;
      }
      assert.equal(matches, 1);
    });

    it("double-fire guard holds against the jittered fire time", () => {
      const lastRunAt = new Date(slot.getTime() + offset + 5_000).toISOString();
      const laterTick = new Date(slot.getTime() + offset + 45_000);
      assert.equal(
        matchesCron(cron, laterTick, "UTC", { lastRunAt, jobId, jitterMinutes: jitter }),
        false,
      );
    });

    it("next occurrence still fires after a jittered fire", () => {
      const lastRunAt = new Date(slot.getTime() + offset + 5_000).toISOString();
      const nextSlot = new Date(slot.getTime() + 86_400_000);
      const nextOffset = seededOffsetMs(jobId, nextSlot, jitter);
      const now = new Date(nextSlot.getTime() + nextOffset + 30_000);
      assert.equal(
        matchesCron(cron, now, "UTC", { lastRunAt, jobId, jitterMinutes: jitter }),
        true,
      );
    });

    it("with jitter 0 matches identically to no jitter", () => {
      const now = new Date(slot.getTime() + 30_000);
      assert.equal(
        matchesCron(cron, now, "UTC", { jobId, jitterMinutes: 0 }),
        matchesCron(cron, now, "UTC"),
      );
    });
  });

  describe("matchesSkipDate", () => {
    it("returns null when entries is undefined", () => {
      assert.equal(matchesSkipDate(undefined, new Date("2026-12-25T12:00:00Z"), "UTC"), null);
    });

    it("returns null when entries is empty", () => {
      assert.equal(matchesSkipDate([], new Date("2026-12-25T12:00:00Z"), "UTC"), null);
    });

    it("matches exact YYYY-MM-DD entry", () => {
      const entries = [{ date: "2026-12-25", label: "Christmas" }];
      const match = matchesSkipDate(entries, new Date("2026-12-25T12:00:00Z"), "UTC");
      assert.equal(match?.label, "Christmas");
    });

    it("matches recurring MM-DD entry", () => {
      const entries = [{ date: "12-25", label: "Christmas" }];
      const match = matchesSkipDate(entries, new Date("2027-12-25T12:00:00Z"), "UTC");
      assert.equal(match?.label, "Christmas");
    });

    it("does not match a non-off-day", () => {
      const entries = [{ date: "12-25", label: "Christmas" }];
      assert.equal(matchesSkipDate(entries, new Date("2026-12-26T12:00:00Z"), "UTC"), null);
    });

    it("evaluates the date in the supplied timezone, not UTC", () => {
      // 2026-12-24T20:00Z = 2026-12-25T07:00 in Sydney.
      const entries = [{ date: "12-25", label: "Christmas" }];
      const match = matchesSkipDate(entries, new Date("2026-12-24T20:00:00Z"), "Australia/Sydney");
      assert.equal(match?.label, "Christmas");
      // ...and the inverse: same moment in UTC is Dec 24, no match.
      assert.equal(matchesSkipDate(entries, new Date("2026-12-24T20:00:00Z"), "UTC"), null);
    });

    it("returns the first matching entry when both YYYY-MM-DD and MM-DD would match", () => {
      const entries = [
        { date: "2026-12-25", label: "Christmas 2026" },
        { date: "12-25", label: "Christmas (recurring)" },
      ];
      const match = matchesSkipDate(entries, new Date("2026-12-25T12:00:00Z"), "UTC");
      assert.equal(match?.label, "Christmas 2026");
    });

    it("returns null on an invalid timezone instead of throwing", () => {
      const entries = [{ date: "12-25", label: "Christmas" }];
      assert.equal(matchesSkipDate(entries, new Date("2026-12-25T12:00:00Z"), "Not/AZone"), null);
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
      vi.spyOn(client.conversations, "open").mockImplementation(async () => ({ ok: false }));
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "boom");

      assert.equal(
        postSpy.mock.calls.length,
        0,
        "postMessage should not be called when DM open fails",
      );
    });

    it("skips posting when conversations.open throws", async () => {
      const client = new WebClient();
      vi.spyOn(client.conversations, "open").mockImplementation(async () => {
        throw new Error("user_not_found");
      });
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "boom");

      assert.equal(postSpy.mock.calls.length, 0);
    });

    it("posts to the resolved DM channel when open succeeds", async () => {
      const client = new WebClient();
      vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "something went wrong");

      assert.equal(postSpy.mock.calls.length, 1);
      const args = postSpy.mock.calls[0][0];
      assert.equal(args?.channel, "D789");
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /something went wrong/);
    });

    it("suggests inviting Clack when channel_not_found on a regular channel", async () => {
      const client = new WebClient();
      vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "An API error occurred: channel_not_found");

      const args = postSpy.mock.calls[0][0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /<#C456>/);
      assert.match(text, /isn't a member/);
      assert.match(text, /\/invite @Clack/);
      assert.doesNotMatch(text, /channel_not_found/);
    });

    it("explains DM inaccessibility when channel_not_found on a DM target", async () => {
      const client = new WebClient();
      vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      const dmJob: CronJob = { ...job, channel: "D0AHVHZTZ9G" };
      await notifyCreatorOfError(dmJob, client, "An API error occurred: channel_not_found");

      const args = postSpy.mock.calls[0][0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /`D0AHVHZTZ9G`/);
      assert.match(text, /DM Clack isn't part of/);
      assert.doesNotMatch(text, /\/invite/);
    });

    it("also treats not_in_channel as an access error", async () => {
      const client = new WebClient();
      vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
        ok: true,
        channel: { id: "D789" },
      }));
      const postSpy = vi
        .spyOn(client.chat, "postMessage")
        .mockImplementation(async () => ({ ok: true }));

      await notifyCreatorOfError(job, client, "not_in_channel");

      const args = postSpy.mock.calls[0][0];
      const text = args && "text" in args ? (args.text ?? "") : "";
      assert.match(text, /\/invite @Clack/);
    });

    describe("system-owned jobs", () => {
      const systemJob: CronJob = {
        id: "sys-1",
        cronExpression: "0 9 * * *",
        channel: "C456",
        prompt: "test",
        createdBy: null,
        systemActor: "plugin:trivia",
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "game-a:question",
      };

      it("escalates to the deployment owner", async () => {
        const client = new WebClient();
        const openSpy = vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
          ok: true,
          channel: { id: "D_OWNER" },
        }));
        const postSpy = vi
          .spyOn(client.chat, "postMessage")
          .mockImplementation(async () => ({ ok: true }));

        const deps = makeNotifyDeps({ owner: "U_OWNER", admins: [], devs: [] });
        await notifyCreatorOfError(systemJob, client, "boom", deps);

        // The Slack `ConversationsOpenArguments` is a union of shapes — when opening a user DM
        // the variant has a `users` field that TS can't narrow without a guard.
        const openCall = openSpy.mock.calls[0][0];
        assert.ok(openCall && "users" in openCall);
        assert.equal(openCall.users, "U_OWNER");
        assert.equal(postSpy.mock.calls.length, 1);
        const args = postSpy.mock.calls[0][0];
        assert.equal(args?.channel, "D_OWNER");
        const text = args && "text" in args ? (args.text ?? "") : "";
        assert.match(text, /plugin:trivia/);
        assert.match(text, /game-a:question/);
        assert.match(text, /boom/);
      });

      it("logs and skips cleanly when no owner is configured", async () => {
        const client = new WebClient();
        const openSpy = vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
          ok: true,
          channel: { id: "D_OWNER" },
        }));
        const postSpy = vi
          .spyOn(client.chat, "postMessage")
          .mockImplementation(async () => ({ ok: true }));

        const deps = makeNotifyDeps({ owner: null, admins: [], devs: [] });
        // Must NOT throw.
        await notifyCreatorOfError(systemJob, client, "boom", deps);

        assert.equal(openSpy.mock.calls.length, 0, "no DM open attempted");
        assert.equal(postSpy.mock.calls.length, 0, "no message posted");
      });
    });
  });

  describe("executeJob (skip outcome)", () => {
    function fakeClient(): WebClient {
      const client = new WebClient();
      vi.spyOn(client.auth, "test").mockImplementation(async () => ({
        ok: true,
        url: "https://t.slack.com/",
      }));
      vi.spyOn(client.conversations, "info").mockImplementation(async () => ({
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
        markJobStarted: Parameters<CronSchedulerDeps["markJobStarted"]>[];
        updateJobRunStatus: Parameters<CronSchedulerDeps["updateJobRunStatus"]>[];
        deleteJob: Parameters<CronSchedulerDeps["deleteJob"]>[];
        notifyCreatorOfError: Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[];
      };
      order: string[];
    } {
      const calls = {
        processMessage: [] as Parameters<CronSchedulerDeps["processMessage"]>[0][],
        markJobStarted: [] as Parameters<CronSchedulerDeps["markJobStarted"]>[],
        updateJobRunStatus: [] as Parameters<CronSchedulerDeps["updateJobRunStatus"]>[],
        deleteJob: [] as Parameters<CronSchedulerDeps["deleteJob"]>[],
        notifyCreatorOfError: [] as Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[],
      };
      const order: string[] = [];
      const deps: CronSchedulerDeps = {
        processMessage: async (params) => {
          order.push("processMessage");
          calls.processMessage.push(params);
          return {
            success: true,
            answer: "",
            ...responseOverride,
          };
        },
        // Stubbed so the post-response session read-back never touches the real disk-scan
        // fallback in sessions.ts (which would scan data/sessions/ and make the test slow).
        findSessionByMessage: async () => null,
        markJobStarted: async (...args) => {
          order.push("markJobStarted");
          calls.markJobStarted.push(args);
        },
        updateJobRunStatus: async (...args) => {
          order.push("updateJobRunStatus");
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
      return { deps, calls, order };
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

    it("forwards job.attachedTopics to processMessage as preAttachedTopics", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob({ attachedTopics: ["trivia"] }), client, deps);

      assert.equal(calls.processMessage.length, 1);
      assert.deepEqual(calls.processMessage[0].preAttachedTopics, ["trivia"]);
    });

    it("passes undefined preAttachedTopics when attachedTopics is absent", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob(), client, deps);

      assert.equal(calls.processMessage.length, 1);
      assert.equal(calls.processMessage[0].preAttachedTopics, undefined);
    });

    it("cleans up one-shot jobs after a skipped run", async () => {
      const { deps, calls } = makeDeps({ skipped: true });
      const client = fakeClient();

      await executeJob(baseJob({ oneShot: true, skipConditions: "Skip always" }), client, deps);

      assert.equal(calls.deleteJob.length, 1);
      assert.equal(calls.deleteJob[0][0], "job-skip-1");
    });

    it("marks job started BEFORE processMessage runs (restart-safety)", async () => {
      const { deps, calls, order } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob(), client, deps);

      assert.equal(calls.markJobStarted.length, 1);
      assert.equal(calls.markJobStarted[0][0], "job-skip-1");
      assert.ok(
        order.indexOf("markJobStarted") < order.indexOf("processMessage"),
        "markJobStarted must run before processMessage so a mid-execution restart doesn't double-fire the slot",
      );
    });

    it("records 'success' with responseTs on normal (non-skipped) runs", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob(), client, deps);

      assert.equal(calls.updateJobRunStatus[0][1], "success");
      // responseTs comes from findSessionByMessage which returns undefined without a real session
    });

    it("does NOT include REPLAY CONTEXT when asOf is omitted", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(baseJob(), client, deps);

      assert.equal(calls.processMessage.length, 1);
      const additional = calls.processMessage[0].additionalSystemPrompt ?? "";
      assert.ok(
        !additional.includes("REPLAY CONTEXT"),
        `expected no REPLAY CONTEXT but got: ${additional}`,
      );
    });

    it("injects REPLAY CONTEXT into additionalSystemPrompt when asOf is set", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();
      const asOf = new Date("2026-05-08T09:00:00.000Z");

      await executeJob(baseJob(), client, deps, asOf);

      assert.equal(calls.processMessage.length, 1);
      const additional = calls.processMessage[0].additionalSystemPrompt ?? "";
      assert.ok(
        additional.includes("REPLAY CONTEXT"),
        `expected REPLAY CONTEXT in additionalSystemPrompt`,
      );
      assert.ok(
        additional.includes("2026-05-08T09:00:00.000Z"),
        `expected asOf ISO timestamp in REPLAY CONTEXT block`,
      );
    });

    it("forwards replayOf to updateJobRunStatus on successful replay", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();
      const asOf = new Date("2026-05-08T09:00:00.000Z");

      await executeJob(baseJob(), client, deps, asOf);

      assert.equal(calls.updateJobRunStatus.length, 1);
      // updateJobRunStatus(jobId, status, responseTs, replayOf)
      assert.equal(calls.updateJobRunStatus[0][3], "2026-05-08T09:00:00.000Z");
    });

    it("forwards replayOf to updateJobRunStatus on skipped replay", async () => {
      const { deps, calls } = makeDeps({ skipped: true });
      const client = fakeClient();
      const asOf = new Date("2026-05-08T09:00:00.000Z");

      await executeJob(baseJob({ skipConditions: "Skip on weekends" }), client, deps, asOf);

      assert.equal(calls.updateJobRunStatus.length, 1);
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
      assert.equal(calls.updateJobRunStatus[0][3], "2026-05-08T09:00:00.000Z");
    });
  });

  describe("executeJob (skipDates gate)", () => {
    function fakeClient(): WebClient {
      const client = new WebClient();
      vi.spyOn(client.auth, "test").mockImplementation(async () => ({
        ok: true,
        url: "https://t.slack.com/",
      }));
      vi.spyOn(client.conversations, "info").mockImplementation(async () => ({
        ok: true,
        channel: { id: "C456", name: "ops", is_im: false },
      }));
      return client;
    }

    function baseJob(overrides: Partial<CronJob> = {}): CronJob {
      return {
        id: "job-skipdates-1",
        cronExpression: "0 9 * * *",
        channel: "C456",
        prompt: "Trivia question",
        createdBy: "U123",
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: "UTC",
        ...overrides,
      };
    }

    function makeDeps(): {
      deps: CronSchedulerDeps;
      calls: {
        processMessage: Parameters<CronSchedulerDeps["processMessage"]>[0][];
        markJobStarted: Parameters<CronSchedulerDeps["markJobStarted"]>[];
        updateJobRunStatus: Parameters<CronSchedulerDeps["updateJobRunStatus"]>[];
        deleteJob: Parameters<CronSchedulerDeps["deleteJob"]>[];
        notifyCreatorOfError: Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[];
      };
    } {
      const calls = {
        processMessage: [] as Parameters<CronSchedulerDeps["processMessage"]>[0][],
        markJobStarted: [] as Parameters<CronSchedulerDeps["markJobStarted"]>[],
        updateJobRunStatus: [] as Parameters<CronSchedulerDeps["updateJobRunStatus"]>[],
        deleteJob: [] as Parameters<CronSchedulerDeps["deleteJob"]>[],
        notifyCreatorOfError: [] as Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[],
      };
      const deps: CronSchedulerDeps = {
        processMessage: async (params) => {
          calls.processMessage.push(params);
          return { success: true, answer: "" };
        },
        findSessionByMessage: async () => null,
        markJobStarted: async (...args) => {
          calls.markJobStarted.push(args);
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

    it("skips deterministically without opening a Claude session on a matched off-day", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();
      const job = baseJob({
        skipDates: [{ date: "12-25", label: "Christmas" }],
      });
      const asOf = new Date("2026-12-25T09:00:00.000Z");

      await executeJob(job, client, deps, asOf);

      assert.equal(calls.processMessage.length, 0, "Claude session should not be opened");
      assert.equal(calls.updateJobRunStatus.length, 1);
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
      assert.equal(calls.updateJobRunStatus[0][2], undefined, "skipped runs have no responseTs");
      assert.equal(
        calls.updateJobRunStatus[0][3],
        "2026-12-25T09:00:00.000Z",
        "replayOf forwarded",
      );
    });

    it("still fires on a non-off-day", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();
      const job = baseJob({
        skipDates: [{ date: "12-25", label: "Christmas" }],
      });
      const asOf = new Date("2026-12-26T09:00:00.000Z");

      await executeJob(job, client, deps, asOf);

      assert.equal(calls.processMessage.length, 1, "Claude session should be opened");
    });

    it("deletes a one-shot job when it skips on an off-day", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();
      const job = baseJob({
        oneShot: true,
        skipDates: [{ date: "12-25", label: "Christmas" }],
      });
      const asOf = new Date("2026-12-25T09:00:00.000Z");

      await executeJob(job, client, deps, asOf);

      assert.equal(calls.deleteJob.length, 1);
      assert.equal(calls.deleteJob[0][0], "job-skipdates-1");
    });

    it("skipDates wins over skipConditions when both could apply", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();
      const job = baseJob({
        skipDates: [{ date: "12-25", label: "Christmas" }],
        skipConditions: "Skip if no PRs yesterday.",
      });
      const asOf = new Date("2026-12-25T09:00:00.000Z");

      await executeJob(job, client, deps, asOf);

      // The skipDates gate short-circuits — Claude is never asked to evaluate skipConditions.
      assert.equal(calls.processMessage.length, 0);
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
    });

    it("respects the job's timezone when evaluating the off-day", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();
      const job = baseJob({
        timezone: "Australia/Sydney",
        skipDates: [{ date: "12-25", label: "Christmas" }],
      });
      // This moment is Dec 24 in UTC but Dec 25 in Sydney.
      const asOf = new Date("2026-12-24T20:00:00.000Z");

      await executeJob(job, client, deps, asOf);

      assert.equal(calls.processMessage.length, 0);
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
    });

    it("does not affect jobs without skipDates", async () => {
      const { deps, calls } = makeDeps();
      const client = fakeClient();

      await executeJob(baseJob(), client, deps, new Date("2026-12-25T09:00:00.000Z"));

      // No skipDates means the gate is a no-op and the run proceeds normally.
      assert.equal(calls.processMessage.length, 1);
      assert.equal(calls.updateJobRunStatus[0][1], "success");
    });
  });

  describe("shouldSkipUserJob", () => {
    function userJob(): CronJob {
      return {
        id: "u1",
        cronExpression: "0 * * * *",
        channel: "C1",
        prompt: "ask the channel",
        createdBy: "U123",
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: "UTC",
      };
    }

    function pluginJob(): CronJob {
      return {
        id: "p1",
        cronExpression: "0 * * * *",
        channel: "C1",
        prompt: "trivia reveal",
        createdBy: null,
        systemActor: "plugin:trivia",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "game-a:reveal",
        createdAt: new Date().toISOString(),
        enabled: true,
        timezone: "UTC",
      };
    }

    it("skips user-created jobs when user schedules are disabled", () => {
      assert.equal(shouldSkipUserJob(userJob(), false), true);
    });

    it("does NOT skip plugin-managed jobs when user schedules are disabled", () => {
      assert.equal(shouldSkipUserJob(pluginJob(), false), false);
    });

    it("does NOT skip user jobs when user schedules are enabled", () => {
      assert.equal(shouldSkipUserJob(userJob(), true), false);
    });

    it("does NOT skip plugin jobs when user schedules are enabled", () => {
      assert.equal(shouldSkipUserJob(pluginJob(), true), false);
    });
  });

  describe("executeJob (channelless dispatch)", () => {
    function fakeClient(): WebClient {
      const client = new WebClient();
      vi.spyOn(client.auth, "test").mockImplementation(async () => ({
        ok: true,
        url: "https://t.slack.com/",
      }));
      vi.spyOn(client.conversations, "info").mockImplementation(async () => ({
        ok: true,
        channel: { id: "C456", name: "ops", is_im: false },
      }));
      return client;
    }

    function channellessJob(overrides: Partial<CronJob> = {}): CronJob {
      return {
        id: "job-cl-1",
        cronExpression: "*/15 9-16 * * 1-5",
        prompt: "Casual chatter",
        createdBy: null,
        systemActor: "plugin:casual-talk",
        plugin: "casual-talk",
        pluginManaged: true,
        specKey: "chatter",
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
        notifyCreatorOfError: Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[];
      };
    } {
      const processMessageCalls: Parameters<CronSchedulerDeps["processMessage"]>[0][] = [];
      const updateJobRunStatusCalls: Parameters<CronSchedulerDeps["updateJobRunStatus"]>[] = [];
      const notifyCalls: Parameters<CronSchedulerDeps["notifyCreatorOfError"]>[] = [];
      const calls = {
        processMessage: processMessageCalls,
        updateJobRunStatus: updateJobRunStatusCalls,
        notifyCreatorOfError: notifyCalls,
      };
      const deps: CronSchedulerDeps = {
        processMessage: async (params) => {
          calls.processMessage.push(params);
          return { success: true, answer: "", ...responseOverride };
        },
        findSessionByMessage: async () => null,
        markJobStarted: async () => {},
        updateJobRunStatus: async (...args) => {
          calls.updateJobRunStatus.push(args);
        },
        deleteJob: async () => true,
        notifyCreatorOfError: async (...args) => {
          calls.notifyCreatorOfError.push(args);
        },
      };
      return { deps, calls };
    }

    it("synthesizes channelless:<jobId> sentinel for channelless dispatch", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(channellessJob(), client, deps);

      assert.equal(calls.processMessage.length, 1);
      assert.equal(calls.processMessage[0].channelId, "channelless:job-cl-1");
    });

    it("passes the real channel through unchanged for channel-bound jobs (regression)", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(channellessJob({ channel: "C789" }), client, deps);

      assert.equal(calls.processMessage[0].channelId, "C789");
    });

    it("records 'skipped' status and does NOT notify on channelless skipped run", async () => {
      // skip-without-post is a legitimate outcome for channelless — Claude decided no
      // candidate channel was a good fit. It must NOT trigger an error notification.
      const { deps, calls } = makeDeps({ skipped: true });
      const client = fakeClient();

      await executeJob(channellessJob({ skipConditions: "Skip on weekends" }), client, deps);

      assert.equal(calls.updateJobRunStatus.length, 1);
      assert.equal(calls.updateJobRunStatus[0][1], "skipped");
      assert.equal(calls.updateJobRunStatus[0][2], undefined, "skipped runs have no responseTs");
      assert.equal(
        calls.notifyCreatorOfError.length,
        0,
        "skip is a legitimate outcome — no error DM",
      );
    });

    it("records 'success' status on a non-skipped channelless run", async () => {
      const { deps, calls } = makeDeps({ skipped: false });
      const client = fakeClient();

      await executeJob(channellessJob(), client, deps);

      assert.equal(calls.updateJobRunStatus.length, 1);
      assert.equal(calls.updateJobRunStatus[0][1], "success");
      // responseTs comes from findSessionByMessage(dispatchChannelId, ...) — undefined
      // in this test harness since no real session exists. The contract is that responseTs
      // is plumbed through from session.responseTs when present.
    });
  });
});
