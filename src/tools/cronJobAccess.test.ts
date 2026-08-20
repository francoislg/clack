import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  canViewFull,
  canEdit,
  canDelete,
  canToggleShared,
  isPrivateTarget,
} from "./cronJobAccess.js";
import type { CronJob } from "../cronJobs.js";
import type { UserRole } from "../roles.js";

function makeJob(overrides: Partial<CronJob>): CronJob {
  const defaults: CronJob = {
    id: "test-job",
    cronExpression: "0 9 * * *",
    prompt: "test",
    createdBy: "U001",
    createdAt: new Date().toISOString(),
    enabled: true,
    timezone: "UTC",
  };
  return { ...defaults, ...overrides };
}

describe("cronJobAccess", () => {
  describe("canViewFull", () => {
    it("admin can view any job", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canViewFull(job, admin), true);
    });

    it("owner can view any job", () => {
      const owner = { userId: "U999", role: "owner" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canViewFull(job, owner), true);
    });

    it("creator can view their own job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canViewFull(job, creator), true);
    });

    it("non-creator cannot view unless editableByAnyone or pluginManaged", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canViewFull(job, viewer), false);
    });

    it("anyone can view when editableByAnyone is true", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001", editableByAnyone: true });
      assert.equal(canViewFull(job, viewer), true);
    });

    it("anyone can view plugin-managed jobs", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
      });
      assert.equal(canViewFull(job, viewer), true);
    });

    it("non-admin cannot view creator-only job with editableByAnyone absent", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canViewFull(job, viewer), false);
    });

    it("member can view when editableByAnyone is true even if not creator", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({
        createdBy: "U001",
        editableByAnyone: true,
      });
      assert.equal(canViewFull(job, viewer), true);
    });
  });

  describe("canEdit", () => {
    it("admin can edit any job", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canEdit(job, admin), true);
    });

    it("owner can edit any job", () => {
      const owner = { userId: "U999", role: "owner" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canEdit(job, owner), true);
    });

    it("creator can edit their own job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canEdit(job, creator), true);
    });

    it("non-creator cannot edit unless editableByAnyone is set", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canEdit(job, viewer), false);
    });

    it("anyone can edit when editableByAnyone is true", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001", editableByAnyone: true });
      assert.equal(canEdit(job, viewer), true);
    });

    it("pluginManaged does NOT grant edit permission to non-admins (differs from canViewFull)", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
      });
      assert.equal(canEdit(job, viewer), false);
    });

    it("admin can edit plugin-managed jobs", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
      });
      assert.equal(canEdit(job, admin), true);
    });

    it("non-admin cannot edit pluginManaged job even with editableByAnyone true", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
        editableByAnyone: true,
      });
      assert.equal(canEdit(job, viewer), false);
    });
  });

  describe("canToggleShared", () => {
    it("admin can toggle shared on any channel-targeted job", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "C123456789" });
      assert.equal(canToggleShared(job, admin), true);
    });

    it("owner can toggle shared on any channel-targeted job", () => {
      const owner = { userId: "U999", role: "owner" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "C123456789" });
      assert.equal(canToggleShared(job, owner), true);
    });

    it("creator can toggle shared on their own channel-targeted job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "C123456789" });
      assert.equal(canToggleShared(job, creator), true);
    });

    it("non-creator cannot toggle shared on channel-targeted job", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "C123456789" });
      assert.equal(canToggleShared(job, viewer), false);
    });

    it("non-creator cannot toggle shared even on editableByAnyone channel-targeted job", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "C123456789", editableByAnyone: true });
      assert.equal(canToggleShared(job, viewer), false);
    });

    it("stranger cannot toggle shared on private job (DM channel)", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "D123456789" });
      assert.equal(canToggleShared(job, viewer), false);
    });

    it("owner cannot toggle shared on their own DM-targeted job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "D123456789" });
      assert.equal(canToggleShared(job, creator), false);
    });

    it("admin cannot toggle shared on DM-targeted job", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: "D123456789" });
      assert.equal(canToggleShared(job, admin), false);
    });

    it("creator cannot toggle shared on channelless non-plugin job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001", channel: undefined, pluginManaged: undefined });
      assert.equal(canToggleShared(job, creator), false);
    });
  });

  describe("canRemove", () => {
    it("admin can always remove", () => {
      const admin = { userId: "U999", role: "admin" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canDelete(job, admin), true);
    });

    it("owner can always remove", () => {
      const owner = { userId: "U999", role: "owner" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canDelete(job, owner), true);
    });

    it("creator can remove their own job", () => {
      const creator = { userId: "U001", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canDelete(job, creator), true);
    });

    it("non-creator CANNOT remove even with editableByAnyone true", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({ createdBy: "U001", editableByAnyone: true });
      assert.equal(canDelete(job, viewer), false);
    });

    it("non-creator CANNOT remove plugin-managed jobs", () => {
      const viewer = { userId: "U002", role: "dev" as UserRole };
      const job = makeJob({
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
      });
      assert.equal(canDelete(job, viewer), false);
    });

    it("member cannot remove a creator-only job", () => {
      const viewer = { userId: "U002", role: "member" as UserRole };
      const job = makeJob({ createdBy: "U001" });
      assert.equal(canDelete(job, viewer), false);
    });
  });

  describe("isPrivateTarget", () => {
    it("DM-targeted jobs (D prefix) are private", () => {
      const job = makeJob({ channel: "D123456789" });
      assert.equal(isPrivateTarget(job), true);
    });

    it("channelless non-plugin jobs are private", () => {
      const job = makeJob({ channel: undefined, pluginManaged: undefined });
      assert.equal(isPrivateTarget(job), true);
    });

    it("channelless plugin-managed jobs are NOT private", () => {
      const job = makeJob({
        channel: undefined,
        createdBy: null,
        systemActor: "plugin:trivia",
        pluginManaged: true,
      });
      assert.equal(isPrivateTarget(job), false);
    });

    it("public channel jobs (C prefix) are NOT private", () => {
      const job = makeJob({ channel: "C123456789" });
      assert.equal(isPrivateTarget(job), false);
    });

    it("private channel jobs (G prefix) are NOT private", () => {
      const job = makeJob({ channel: "G123456789" });
      assert.equal(isPrivateTarget(job), false);
    });
  });
});
