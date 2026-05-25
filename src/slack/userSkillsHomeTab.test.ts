import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUserSkillsSection } from "./userSkillsHomeTab.js";
import type { UserSkill } from "../userSkills.js";

const skillByAlice: UserSkill = {
  slug: "copy-improver",
  description: "When the user wants X",
  body: "BODY",
  ownerUserId: "U_ALICE",
  createdAt: "t",
  updatedAt: "t",
};

const skillByBob: UserSkill = {
  slug: "meeting-notes",
  description: "When the user wants Y",
  body: "BODY",
  ownerUserId: "U_BOB",
  createdAt: "t",
  updatedAt: "t",
};

function stringify(blocks: object[]): string {
  return JSON.stringify(blocks);
}

describe("buildUserSkillsSection", () => {
  it("renders the header and create button for a member", () => {
    const blocks = buildUserSkillsSection("U_ALICE", "member", []);
    const json = stringify(blocks);
    assert.ok(/Skills/.test(json));
    assert.ok(/Create skill/.test(json));
    assert.ok(/No user skills yet|empty/i.test(json));
  });

  it("alphabetizes skill rows", () => {
    const blocks = buildUserSkillsSection("U_ALICE", "admin", [skillByBob, skillByAlice]);
    const json = stringify(blocks);
    const apple = json.indexOf("copy-improver");
    const mango = json.indexOf("meeting-notes");
    assert.ok(apple > 0);
    assert.ok(mango > 0);
    assert.ok(apple < mango);
  });

  it("shows owner mention", () => {
    const blocks = buildUserSkillsSection("U_ALICE", "member", [skillByAlice]);
    const json = stringify(blocks);
    assert.ok(/<@U_ALICE>/.test(json));
  });

  it("owner sees Edit and Disable on their own skill", () => {
    const blocks = buildUserSkillsSection("U_ALICE", "member", [skillByAlice]);
    const json = stringify(blocks);
    assert.ok(/Edit/.test(json));
    assert.ok(/Disable/.test(json));
  });

  it("non-owner member does NOT see Edit/Disable on someone else's skill", () => {
    const blocks = buildUserSkillsSection("U_OTHER", "member", [skillByAlice]);
    const json = stringify(blocks);
    assert.equal(/clack_user_skill_edit_open/.test(json), false);
    assert.equal(/clack_user_skill_disable/.test(json), false);
  });

  it("admin sees Edit/Disable on any skill", () => {
    const blocks = buildUserSkillsSection("U_ADMIN", "admin", [skillByAlice]);
    const json = stringify(blocks);
    assert.ok(/clack_user_skill_edit_open:copy-improver/.test(json));
    assert.ok(/clack_user_skill_disable:copy-improver/.test(json));
  });

  it("disabled skill shows Restore (not Disable)", () => {
    const disabled = { ...skillByAlice, disabledAt: "t2" };
    const blocks = buildUserSkillsSection("U_ALICE", "member", [disabled]);
    const json = stringify(blocks);
    assert.ok(/clack_user_skill_restore:copy-improver/.test(json));
    assert.equal(/clack_user_skill_disable:copy-improver/.test(json), false);
    assert.ok(/disabled/.test(json));
  });
});
