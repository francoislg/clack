import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { resolveJobActor, actorRole, actorDmTarget, actorDisplay } from "./actor.js";
import type { UserRole } from "./roles.js";
import type { CronJob } from "./cronJobs.js";

function userJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job1",
    cronExpression: "0 9 * * *",
    channel: "C123",
    prompt: "test",
    createdBy: "U_USER",
    createdAt: "2026-01-01T00:00:00Z",
    enabled: true,
    timezone: "UTC",
    ...overrides,
  };
}

function systemJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "sysjob1",
    cronExpression: "0 9 * * *",
    channel: "C123",
    prompt: "test",
    createdBy: null,
    systemActor: "plugin:trivia",
    createdAt: "2026-01-01T00:00:00Z",
    enabled: true,
    timezone: "UTC",
    pluginManaged: true,
    plugin: "trivia",
    specKey: "game-a:question",
    ...overrides,
  };
}

describe("resolveJobActor", () => {
  it("returns a user actor with the resolved role for user-created jobs", async () => {
    const getRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "admin");
    const actor = await resolveJobActor(userJob({ createdBy: "U_USER" }), { getRole });
    assert.deepEqual(actor, { kind: "user", userId: "U_USER", role: "admin" });
    assert.equal(getRole.mock.calls.length, 1);
    assert.equal(getRole.mock.calls[0]![0], "U_USER");
  });

  it("returns a system actor for plugin-managed jobs (no getRole call)", async () => {
    const getRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "member");
    const actor = await resolveJobActor(systemJob(), { getRole });
    assert.deepEqual(actor, { kind: "system", source: "plugin:trivia" });
    assert.equal(getRole.mock.calls.length, 0, "system path must not consult getRole");
  });

  it("throws when createdBy is null but systemActor is missing", async () => {
    const broken = systemJob({ systemActor: undefined });
    const getRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "member");
    await assert.rejects(resolveJobActor(broken, { getRole }), /data invariant violated/);
  });
});

describe("actorRole", () => {
  it('returns "system" for system actors', () => {
    assert.equal(actorRole({ kind: "system", source: "plugin:trivia" }), "system");
  });

  it("returns the user's role for user actors", () => {
    assert.equal(actorRole({ kind: "user", userId: "U1", role: "admin" }), "admin");
  });
});

describe("actorDmTarget", () => {
  it("returns null for system actors", () => {
    assert.equal(actorDmTarget({ kind: "system", source: "plugin:trivia" }), null);
  });

  it("returns the userId for user actors", () => {
    assert.equal(actorDmTarget({ kind: "user", userId: "U1", role: "dev" }), "U1");
  });
});

describe("actorDisplay", () => {
  it("returns a Slack mention for user actors", () => {
    assert.equal(actorDisplay({ kind: "user", userId: "U1", role: "dev" }), "<@U1>");
  });

  it("formats a colon-delimited source as System (kind: name)", () => {
    assert.equal(
      actorDisplay({ kind: "system", source: "plugin:trivia" }),
      "System (plugin: trivia)",
    );
  });

  it("falls back to System (source) when the source has no colon", () => {
    assert.equal(
      actorDisplay({ kind: "system", source: "boot-migration" }),
      "System (boot-migration)",
    );
  });
});
