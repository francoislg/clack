import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../sdk.js";
import { idlerPlugin } from "./index.js";
import { DEFAULT_CONFIG, saveConfig } from "./config.js";
import type { IdlerConfig } from "./types.js";
import type { CronJob, CreateCronJobParams, UpdateCronJobParams } from "../../cronJobs.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

interface FakeStore {
  jobs: CronJob[];
  createCalls: CreateCronJobParams[];
}

function makeFakeStore(): FakeStore {
  return { jobs: [], createCalls: [] };
}

function makeFakeStoreDeps(store: FakeStore) {
  let nextId = 1;
  return {
    findByPluginOwner: async (ownerKey: string): Promise<CronJob[]> =>
      store.jobs.filter((j) => j.plugin === ownerKey && j.pluginManaged === true),
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
        ...(params.systemActor ? { systemActor: params.systemActor } : {}),
        ...(params.plugin ? { plugin: params.plugin } : {}),
        ...(params.pluginManaged ? { pluginManaged: true } : {}),
        ...(params.specKey ? { specKey: params.specKey } : {}),
        ...(params.submitResponseMode ? { submitResponseMode: params.submitResponseMode } : {}),
        ...(params.silent ? { silent: true } : {}),
      };
      store.jobs.push(job);
      return job;
    },
    updateJob: async (_id: string, _params: UpdateCronJobParams): Promise<CronJob | null> => null,
    deleteJob: async (_id: string): Promise<boolean> => true,
  };
}

function byKey(store: FakeStore, specKey: string): CreateCronJobParams | undefined {
  return store.createCalls.find((c) => c.specKey === specKey);
}

const WORK_HOURS = { start: 18, end: 9, tz: "UTC", days: [1, 2, 3, 4, 5] };

function operationalConfig(reporting: IdlerConfig["reporting"]): IdlerConfig {
  return {
    ...DEFAULT_CONFIG,
    enabled: true,
    workHours: WORK_HOURS,
    repoAllowlist: ["my-repo"],
    reporting,
  };
}

describe("idler plugin reconcile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-plugin-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildSdk(store: FakeStore, capabilities = { crons: true }) {
    return createClackSdk("idler", tempDir, {
      getSlackClient: () => null,
      loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
      openDmChannel: async () => null,
      clackQuery: emptyClackQuery,
      capabilities,
      ...makeFakeStoreDeps(store),
    });
  }

  it("reconciles NO specs when dormant (no reporting channel)", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(sdk, operationalConfig({ tickUpdates: "none", summary: true }));
    await idlerPlugin(sdk);
    assert.equal(store.createCalls.length, 0);
  });

  it("none + summary: work spec is silent, summary spec present", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(
      sdk,
      operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
    );
    await idlerPlugin(sdk);

    const work = byKey(store, "work");
    assert.ok(work, "work spec must be reconciled");
    assert.equal(work.channel, "C123");
    assert.equal(work.silent, true);
    assert.ok(byKey(store, "summary"), "summary spec must be reconciled when summary: true");
  });

  it("optional + summary off: work spec NOT silent, no summary spec", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(
      sdk,
      operationalConfig({ channel: "C123", tickUpdates: "optional", summary: false }),
    );
    await idlerPlugin(sdk);

    const work = byKey(store, "work");
    assert.ok(work);
    assert.equal(work.silent, undefined);
    assert.equal(byKey(store, "summary"), undefined, "no summary spec when summary: false");
  });

  it("reconciles four specs: deep sync (anchor hour), light sync (cadence, no anchor), work, summary", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(
      sdk,
      operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
    );
    await idlerPlugin(sdk);

    const deep = byKey(store, "sync");
    assert.ok(deep, "deep sync spec must be reconciled under specKey 'sync'");
    assert.equal(deep.cronExpression, "45 17 * * 1,2,3,4,5");
    assert.equal(deep.submitResponseMode, "skipped");
    assert.equal(deep.channel, undefined, "deep sync is channelless");
    assert.deepEqual(deep.attachedTopics, ["idler"]);

    const light = byKey(store, "sync-light");
    assert.ok(light, "light sync spec must be reconciled under specKey 'sync-light'");
    assert.equal(light.cronExpression, "45 9,11,13,15 * * 1,2,3,4,5");
    assert.equal(light.submitResponseMode, "skipped");
    assert.equal(light.channel, undefined, "light sync is channelless");
    assert.deepEqual(light.attachedTopics, ["idler"]);

    assert.ok(byKey(store, "work"), "work spec present");
    assert.ok(byKey(store, "summary"), "summary spec present");
    assert.equal(store.createCalls.length, 4);
  });

  it("cadence 1 fires light sync every non-anchor hour", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(sdk, {
      ...operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
      syncEveryHours: 1,
    });
    await idlerPlugin(sdk);

    const light = byKey(store, "sync-light");
    assert.ok(light);
    assert.equal(light.cronExpression, "45 9-16 * * 1,2,3,4,5");
  });

  it("single-hour sync window produces only the deep sync spec (no light)", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(sdk, {
      ...operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
      syncHours: { start: 8, end: 9, tz: "UTC", days: [1, 2, 3, 4, 5] },
    });
    await idlerPlugin(sdk);

    const deep = byKey(store, "sync");
    assert.ok(deep, "deep sync spec present");
    assert.equal(deep.cronExpression, "45 8 * * 1,2,3,4,5");
    assert.equal(byKey(store, "sync-light"), undefined, "no light sync for a single-hour window");
    assert.equal(store.createCalls.length, 3);
  });

  it("both sync specs inherit the explicit sync window's timezone", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(sdk, {
      ...operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
      syncHours: { start: 9, end: 18, tz: "Europe/London", days: [1, 2, 3, 4, 5] },
    });
    await idlerPlugin(sdk);

    assert.equal(byKey(store, "sync")?.timezone, "Europe/London");
    assert.equal(byKey(store, "sync-light")?.timezone, "Europe/London");
  });

  it("reconciles no sync specs when the work window covers every hour", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(sdk, {
      ...operationalConfig({ channel: "C123", tickUpdates: "none", summary: true }),
      workHours: { start: 0, end: 24, tz: "UTC", days: [1, 2, 3, 4, 5] },
    });
    await idlerPlugin(sdk);

    assert.equal(byKey(store, "sync"), undefined, "no deep sync when there is no complement");
    assert.equal(
      byKey(store, "sync-light"),
      undefined,
      "no light sync when there is no complement",
    );
    assert.ok(byKey(store, "work"), "work spec still present");
    assert.equal(store.createCalls.length, 2, "only work + summary");
  });

  it("fully silent (none + summary off): work spec silent, no summary spec", async () => {
    const store = makeFakeStore();
    const { sdk } = buildSdk(store);
    await saveConfig(
      sdk,
      operationalConfig({ channel: "C123", tickUpdates: "none", summary: false }),
    );
    await idlerPlugin(sdk);

    const work = byKey(store, "work");
    assert.ok(work);
    assert.equal(work.silent, true);
    assert.equal(byKey(store, "summary"), undefined);
  });
});
