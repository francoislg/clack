import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUserSkillsSection, buildEditSkillModal } from "./userSkillsHomeTab.js";
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

  it("owner sees Edit accessory on their own skill row", () => {
    const blocks = buildUserSkillsSection("U_ALICE", "member", [skillByAlice]);
    const json = stringify(blocks);
    assert.ok(/clack_user_skill_edit_open:copy-improver/.test(json));
    // Disable button is no longer on the row — it lives in the edit modal.
    assert.equal(/clack_user_skill_disable:copy-improver/.test(json), false);
  });

  it("non-owner member does NOT see Edit on someone else's skill", () => {
    const blocks = buildUserSkillsSection("U_OTHER", "member", [skillByAlice]);
    const json = stringify(blocks);
    assert.equal(/clack_user_skill_edit_open/.test(json), false);
  });

  it("admin sees Edit on any skill", () => {
    const blocks = buildUserSkillsSection("U_ADMIN", "admin", [skillByAlice]);
    const json = stringify(blocks);
    assert.ok(/clack_user_skill_edit_open:copy-improver/.test(json));
  });

  it("disabled skill shows a disabled badge in its row", () => {
    const disabled = { ...skillByAlice, disabledAt: "t2" };
    const blocks = buildUserSkillsSection("U_ALICE", "member", [disabled]);
    const json = stringify(blocks);
    assert.ok(/disabled/.test(json));
  });
});

describe("buildEditSkillModal", () => {
  it("includes a Disable action for an enabled skill", () => {
    const view = buildEditSkillModal(skillByAlice);
    const json = JSON.stringify(view);
    assert.ok(/clack_user_skill_disable:copy-improver/.test(json));
    assert.equal(/clack_user_skill_restore:copy-improver/.test(json), false);
  });

  it("includes a Restore action for a disabled skill", () => {
    const disabled = { ...skillByAlice, disabledAt: "t2" };
    const view = buildEditSkillModal(disabled);
    const json = JSON.stringify(view);
    assert.ok(/clack_user_skill_restore:copy-improver/.test(json));
    assert.equal(/clack_user_skill_disable:copy-improver/.test(json), false);
  });
});
