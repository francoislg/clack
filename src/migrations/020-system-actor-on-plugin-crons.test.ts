import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migration } from "./020-system-actor-on-plugin-crons.js";

const JOBS_PATH = "data/state/cron-jobs.json";

interface RowOut {
  id: string;
  createdBy: string | null;
  systemActor?: string;
  pluginManaged?: boolean;
  plugin?: string;
  specKey?: string;
}

function runWithJobs(rows: object[]): RowOut[] | null {
  const result = migration.static!({ [JOBS_PATH]: JSON.stringify({ jobs: rows }) });
  const written = result[JOBS_PATH];
  if (written === undefined) return null;
  if (typeof written !== "string") {
    throw new Error("expected string write, got delete marker");
  }
  const parsed = JSON.parse(written) as { jobs: RowOut[] };
  return parsed.jobs;
}

describe("020-system-actor-on-plugin-crons", () => {
  it("rewrites a legacy plugin-managed row", () => {
    const out = runWithJobs([
      {
        id: "j1",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "x",
        createdBy: "trivia",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "game-a:question",
      },
    ]);
    assert.ok(out, "migration should write");
    assert.equal(out!.length, 1);
    assert.equal(out![0].createdBy, null);
    assert.equal(out![0].systemActor, "plugin:trivia");
    assert.equal(out![0].pluginManaged, true);
    assert.equal(out![0].plugin, "trivia");
    assert.equal(out![0].specKey, "game-a:question");
  });

  it("leaves an already-migrated row alone", () => {
    const out = runWithJobs([
      {
        id: "j1",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "x",
        createdBy: null,
        systemActor: "plugin:trivia",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "game-a:question",
      },
    ]);
    // No write expected — file is byte-identical to input.
    assert.equal(out, null, "no rewrite when shape is already correct");
  });

  it("leaves a user-created row untouched", () => {
    const out = runWithJobs([
      {
        id: "u1",
        cronExpression: "0 10 * * *",
        channel: "C999",
        prompt: "ping",
        createdBy: "U_USER",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
      },
    ]);
    assert.equal(out, null, "no write when only user-created rows exist");
  });

  it("leaves a malformed legacy row alone", () => {
    // pluginManaged: true but `plugin` field missing — can't synthesize systemActor.
    const out = runWithJobs([
      {
        id: "bad",
        cronExpression: "0 9 * * *",
        channel: "C123",
        prompt: "x",
        createdBy: "trivia",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
        pluginManaged: true,
        specKey: "game-a:question",
      },
    ]);
    assert.equal(out, null, "malformed row skipped, no write");
  });

  it("rewrites only the legacy rows in a mixed file", () => {
    const out = runWithJobs([
      {
        id: "legacy",
        cronExpression: "0 9 * * *",
        channel: "C1",
        prompt: "x",
        createdBy: "trivia",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
        plugin: "trivia",
        pluginManaged: true,
        specKey: "a:q",
      },
      {
        id: "user",
        cronExpression: "0 10 * * *",
        channel: "C2",
        prompt: "y",
        createdBy: "U_USER",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
      },
      {
        id: "already-good",
        cronExpression: "0 11 * * *",
        channel: "C3",
        prompt: "z",
        createdBy: null,
        systemActor: "plugin:weather",
        createdAt: "2026-01-01T00:00:00Z",
        enabled: true,
        timezone: "UTC",
        plugin: "weather",
        pluginManaged: true,
        specKey: "morning",
      },
    ]);
    assert.ok(out);
    const legacy = out!.find((r) => r.id === "legacy")!;
    const user = out!.find((r) => r.id === "user")!;
    const good = out!.find((r) => r.id === "already-good")!;
    assert.equal(legacy.createdBy, null);
    assert.equal(legacy.systemActor, "plugin:trivia");
    assert.equal(user.createdBy, "U_USER");
    assert.equal(user.systemActor, undefined);
    assert.equal(good.createdBy, null);
    assert.equal(good.systemActor, "plugin:weather");
  });

  it("no-op when cron-jobs.json is missing", () => {
    const result = migration.static!({ [JOBS_PATH]: null });
    assert.deepEqual(result, {});
  });
});
