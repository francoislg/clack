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
