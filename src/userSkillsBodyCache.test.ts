import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  writeUserSkill,
  disableUserSkill,
  setUserSkillsDeps,
  resetUserSkillsDeps,
  defaultUserSkillsDeps,
} from "./userSkills.js";
import { getUserSkillBody, clearUserSkillBodyCache, _cacheSize } from "./userSkillsBodyCache.js";

const tmpBase = resolve(tmpdir(), `userskills-cache-test-${process.pid}`);
const dataDir = join(tmpBase, "data");

function setup(date: Date = new Date("2026-05-22T00:00:00.000Z")) {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  setUserSkillsDeps({
    ...defaultUserSkillsDeps,
    getDataDir: () => dataDir,
    now: () => date,
  });
  clearUserSkillBodyCache();
}

function teardown() {
  resetUserSkillsDeps();
  clearUserSkillBodyCache();
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
}

describe("getUserSkillBody", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("returns not_found for unknown slug", () => {
    const res = getUserSkillBody("ghost");
    assert.equal(res.ok, false);
  });

  it("reads from disk on first call (not from cache)", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "BODY", ownerUserId: "U" });
    const res = getUserSkillBody("foo");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.fromCache, false);
    assert.match(res.body, /BODY/);
  });

  it("returns cached body on repeat call with unchanged mtime", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "BODY", ownerUserId: "U" });
    const r1 = getUserSkillBody("foo");
    const r2 = getUserSkillBody("foo");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    assert.equal(r1.fromCache, false);
    assert.equal(r2.fromCache, true);
    assert.equal(r1.body, r2.body);
  });

  it("re-reads when mtime changes", async () => {
    writeUserSkill({ slug: "foo", description: "d", body: "OLD", ownerUserId: "U" });
    const r1 = getUserSkillBody("foo");
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.match(r1.body, /OLD/);

    // Wait long enough that mtime resolution captures the change.
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeUserSkill({ slug: "foo", description: "d", body: "NEW", ownerUserId: "U" });

    const r2 = getUserSkillBody("foo");
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.fromCache, false);
    assert.match(r2.body, /NEW/);
  });

  it("rejects disabled skill as not_found", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "BODY", ownerUserId: "U" });
    getUserSkillBody("foo"); // populate cache
    disableUserSkill("foo");
    const res = getUserSkillBody("foo");
    assert.equal(res.ok, false);
    // Cache should be evicted for the disabled slug.
    assert.equal(_cacheSize(), 0);
  });
});

describe("clearUserSkillBodyCache", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("clears all entries when called with no args", () => {
    writeUserSkill({ slug: "a", description: "d", body: "x", ownerUserId: "U" });
    writeUserSkill({ slug: "b", description: "d", body: "x", ownerUserId: "U" });
    getUserSkillBody("a");
    getUserSkillBody("b");
    assert.equal(_cacheSize(), 2);
    clearUserSkillBodyCache();
    assert.equal(_cacheSize(), 0);
  });

  it("clears a single entry when called with a slug", () => {
    writeUserSkill({ slug: "a", description: "d", body: "x", ownerUserId: "U" });
    writeUserSkill({ slug: "b", description: "d", body: "x", ownerUserId: "U" });
    getUserSkillBody("a");
    getUserSkillBody("b");
    clearUserSkillBodyCache("a");
    assert.equal(_cacheSize(), 1);
  });

  it("is a no-op for unknown slug", () => {
    writeUserSkill({ slug: "a", description: "d", body: "x", ownerUserId: "U" });
    getUserSkillBody("a");
    clearUserSkillBodyCache("ghost");
    assert.equal(_cacheSize(), 1);
  });
});
