import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  discoverUserSkills,
  readUserSkill,
  userSkillExists,
  getSkillMtimeMs,
  writeUserSkill,
  updateUserSkill,
  disableUserSkill,
  restoreUserSkill,
  setUserSkillsDeps,
  resetUserSkillsDeps,
  defaultUserSkillsDeps,
} from "./userSkills.js";

const tmpBase = resolve(tmpdir(), `userskills-test-${process.pid}`);
const fixedDate = new Date("2026-05-22T12:00:00.000Z");
const dataDir = join(tmpBase, "data");

function setupTempDataDir() {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
}

function withFixedTime(date: Date = fixedDate) {
  setUserSkillsDeps({
    ...defaultUserSkillsDeps,
    getDataDir: () => dataDir,
    now: () => date,
  });
}

describe("writeUserSkill + readUserSkill", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("creates a skill and reads it back", () => {
    const created = writeUserSkill({
      slug: "copy-improver",
      description: "When the user wants X",
      body: "# Body\n\nDo this.",
      ownerUserId: "U_ALICE",
    });
    assert.equal(created.slug, "copy-improver");
    assert.equal(created.createdAt, fixedDate.toISOString());

    const read = readUserSkill("copy-improver");
    assert.ok(read);
    if (!read) return;
    assert.equal(read.description, "When the user wants X");
    assert.match(read.body, /^# Body/);
    assert.equal(read.ownerUserId, "U_ALICE");
    assert.equal(read.disabledAt, undefined);
  });

  it("rejects invalid slug on write", () => {
    assert.throws(
      () => writeUserSkill({ slug: "Bad-Name", description: "x", body: "y", ownerUserId: "U" }),
      /skill name/i,
    );
  });

  it("rejects empty description on write", () => {
    assert.throws(
      () => writeUserSkill({ slug: "ok", description: "  ", body: "y", ownerUserId: "U" }),
      /description/i,
    );
  });

  it("returns null for unknown slug", () => {
    assert.equal(readUserSkill("ghost"), null);
  });

  it("returns null for invalid slug", () => {
    assert.equal(readUserSkill("UPPER"), null);
  });

  it("userSkillExists tracks create", () => {
    assert.equal(userSkillExists("foo"), false);
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    assert.equal(userSkillExists("foo"), true);
  });

  it("preserves ownerUserId and createdAt on re-create", () => {
    writeUserSkill({ slug: "foo", description: "first", body: "b1", ownerUserId: "U_ALICE" });
    setUserSkillsDeps({
      ...defaultUserSkillsDeps,
      getDataDir: () => dataDir,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });
    const recreated = writeUserSkill({
      slug: "foo",
      description: "second",
      body: "b2",
      ownerUserId: "U_BOB",
    });
    assert.equal(recreated.ownerUserId, "U_ALICE");
    assert.equal(recreated.createdAt, fixedDate.toISOString());
    assert.equal(recreated.updatedAt, "2026-06-01T00:00:00.000Z");
  });
});

describe("updateUserSkill", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("updates description only", () => {
    writeUserSkill({ slug: "foo", description: "old", body: "body", ownerUserId: "U" });
    setUserSkillsDeps({
      ...defaultUserSkillsDeps,
      getDataDir: () => dataDir,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });
    const updated = updateUserSkill({ slug: "foo", description: "new" });
    assert.equal(updated.description, "new");
    assert.match(updated.body, /^body/);
    assert.equal(updated.updatedAt, "2026-06-01T00:00:00.000Z");
    assert.equal(updated.createdAt, fixedDate.toISOString());
  });

  it("updates body only", () => {
    writeUserSkill({ slug: "foo", description: "desc", body: "old body", ownerUserId: "U" });
    const updated = updateUserSkill({ slug: "foo", body: "new body" });
    assert.match(updated.body, /^new body/);
    assert.equal(updated.description, "desc");
  });

  it("rejects update with no fields", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    assert.throws(() => updateUserSkill({ slug: "foo" }), /at least one/);
  });

  it("rejects update of disabled skill", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    disableUserSkill("foo");
    assert.throws(() => updateUserSkill({ slug: "foo", body: "x" }), /disabled/);
  });

  it("rejects update of unknown slug", () => {
    assert.throws(() => updateUserSkill({ slug: "ghost", body: "x" }), /not found/);
  });

  it("rejects invalid description on update", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    assert.throws(() => updateUserSkill({ slug: "foo", description: "   " }), /description/i);
  });
});

describe("disable + restore", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("disable sets disabledAt", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    const disabled = disableUserSkill("foo");
    assert.equal(disabled.disabledAt, fixedDate.toISOString());
  });

  it("disable rejects already-disabled", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    disableUserSkill("foo");
    assert.throws(() => disableUserSkill("foo"), /already disabled/);
  });

  it("disable rejects unknown", () => {
    assert.throws(() => disableUserSkill("ghost"), /not found/);
  });

  it("restore clears disabledAt", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    disableUserSkill("foo");
    const restored = restoreUserSkill("foo");
    assert.equal(restored.disabledAt, undefined);
  });

  it("restore rejects not-disabled", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    assert.throws(() => restoreUserSkill("foo"), /not disabled/);
  });

  it("restore rejects unknown", () => {
    assert.throws(() => restoreUserSkill("ghost"), /not found/);
  });
});

describe("discoverUserSkills", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("returns empty when directory missing", () => {
    assert.deepEqual(discoverUserSkills(), []);
  });

  it("returns one entry for a well-formed skill", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    const skills = discoverUserSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].slug, "foo");
  });

  it("skips directory missing SKILL.md", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    mkdirSync(join(dataDir, "user-skills", "broken"), { recursive: true });
    writeFileSync(
      join(dataDir, "user-skills", "broken", ".meta.json"),
      JSON.stringify({ ownerUserId: "U", createdAt: "x", updatedAt: "y" }),
    );
    const skills = discoverUserSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].slug, "foo");
  });

  it("skips directory missing .meta.json", () => {
    mkdirSync(join(dataDir, "user-skills", "orphan"), { recursive: true });
    writeFileSync(
      join(dataDir, "user-skills", "orphan", "SKILL.md"),
      `---\nname: orphan\ndescription: "x"\n---\n\nbody\n`,
    );
    assert.deepEqual(discoverUserSkills(), []);
  });

  it("skips directory with frontmatter name mismatch", () => {
    mkdirSync(join(dataDir, "user-skills", "foo"), { recursive: true });
    writeFileSync(
      join(dataDir, "user-skills", "foo", "SKILL.md"),
      `---\nname: bar\ndescription: "x"\n---\n\nbody\n`,
    );
    writeFileSync(
      join(dataDir, "user-skills", "foo", ".meta.json"),
      JSON.stringify({ ownerUserId: "U", createdAt: "x", updatedAt: "y" }),
    );
    assert.deepEqual(discoverUserSkills(), []);
  });

  it("skips directory with invalid slug", () => {
    mkdirSync(join(dataDir, "user-skills", "BadSlug"), { recursive: true });
    assert.deepEqual(discoverUserSkills(), []);
  });

  it("returns both enabled and disabled (caller filters)", () => {
    writeUserSkill({ slug: "alpha", description: "d", body: "b", ownerUserId: "U" });
    writeUserSkill({ slug: "beta", description: "d", body: "b", ownerUserId: "U" });
    disableUserSkill("beta");
    const slugs = discoverUserSkills()
      .map((s) => s.slug)
      .sort();
    assert.deepEqual(slugs, ["alpha", "beta"]);
  });
});

describe("getSkillMtimeMs", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("returns null for missing skill", () => {
    assert.equal(getSkillMtimeMs("ghost"), null);
  });

  it("returns a number after write", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U" });
    const mtime = getSkillMtimeMs("foo");
    assert.equal(typeof mtime, "number");
  });
});

describe("on-disk format", () => {
  beforeEach(() => {
    setupTempDataDir();
    withFixedTime();
  });
  afterEach(() => {
    resetUserSkillsDeps();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("SKILL.md has expected frontmatter shape", () => {
    writeUserSkill({
      slug: "foo",
      description: 'A "quoted" thing',
      body: "# Body",
      ownerUserId: "U",
    });
    const skillMd = readFileSync(join(dataDir, "user-skills", "foo", "SKILL.md"), "utf-8");
    assert.match(skillMd, /^---\nname: foo\ndescription: "/);
    assert.match(skillMd, /# Body/);
    assert.match(skillMd, /\\"quoted\\"/);
  });

  it(".meta.json is valid JSON with expected fields", () => {
    writeUserSkill({ slug: "foo", description: "d", body: "b", ownerUserId: "U_ALICE" });
    const meta: unknown = JSON.parse(
      readFileSync(join(dataDir, "user-skills", "foo", ".meta.json"), "utf-8"),
    );
    assert.ok(typeof meta === "object" && meta !== null);
    const m = meta as { ownerUserId: string; createdAt: string; updatedAt: string };
    assert.equal(m.ownerUserId, "U_ALICE");
    assert.ok(typeof m.createdAt === "string");
    assert.ok(typeof m.updatedAt === "string");
  });
});
