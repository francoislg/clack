import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { migrateCronConfig } from "./023-cron-config-namespace.js";

describe("023 migrateCronConfig", () => {
  it("moves allowScheduledMessages: true into cron.userSchedules", () => {
    const config = { allowScheduledMessages: true };
    const { changed, movedFields } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { userSchedules: true } });
    assert.equal(movedFields[0], "allowScheduledMessages → cron.userSchedules");
  });

  it("moves allowScheduledMessages: false into cron.userSchedules", () => {
    const config = { allowScheduledMessages: false };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { userSchedules: false } });
  });

  it("moves scheduledMessagesMaxRunHistory into cron.maxRunHistory", () => {
    const config = { scheduledMessagesMaxRunHistory: 50 };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { maxRunHistory: 50 } });
  });

  it("moves both legacy fields in one pass", () => {
    const config = {
      allowScheduledMessages: true,
      scheduledMessagesMaxRunHistory: 100,
    };
    const { changed, movedFields } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, {
      cron: { userSchedules: true, maxRunHistory: 100 },
    });
    assert.equal(movedFields.length, 2);
  });

  it("prefers existing cron.userSchedules over legacy allowScheduledMessages", () => {
    const config = {
      allowScheduledMessages: false,
      cron: { userSchedules: true },
    };
    const { changed, movedFields } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { userSchedules: true } });
    assert.ok(movedFields[0].includes("dropped"));
  });

  it("prefers existing cron.maxRunHistory over legacy scheduledMessagesMaxRunHistory", () => {
    const config = {
      scheduledMessagesMaxRunHistory: 50,
      cron: { maxRunHistory: 200 },
    };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { maxRunHistory: 200 } });
  });

  it("merges into existing cron block without clobbering other fields", () => {
    const config = {
      allowScheduledMessages: true,
      cron: { enabled: false },
    };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, { cron: { enabled: false, userSchedules: true } });
  });

  it("preserves other top-level fields", () => {
    const config = {
      allowScheduledMessages: true,
      plugins: ["trivia"],
      reactions: { trigger: "robot_face" },
    };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, true);
    assert.deepEqual(config, {
      plugins: ["trivia"],
      reactions: { trigger: "robot_face" },
      cron: { userSchedules: true },
    });
  });

  it("no-op when neither legacy field nor cron block is present", () => {
    const config = { reactions: { trigger: "robot_face" } };
    const { changed, movedFields } = migrateCronConfig(config);
    assert.equal(changed, false);
    assert.equal(movedFields.length, 0);
    assert.deepEqual(config, { reactions: { trigger: "robot_face" } });
  });

  it("no-op when only the new namespace is present", () => {
    const config = { cron: { enabled: true, userSchedules: false } };
    const { changed } = migrateCronConfig(config);
    assert.equal(changed, false);
    assert.deepEqual(config, { cron: { enabled: true, userSchedules: false } });
  });

  it("idempotent across two passes", () => {
    const config = {
      allowScheduledMessages: true,
      scheduledMessagesMaxRunHistory: 100,
    };
    assert.equal(migrateCronConfig(config).changed, true);
    assert.equal(migrateCronConfig(config).changed, false);
    assert.deepEqual(config, { cron: { userSchedules: true, maxRunHistory: 100 } });
  });
});
