import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildSkillPacksCatalog } from "./skillPacksCatalog.js";

describe("buildSkillPacksCatalog", () => {
  it("returns empty string when registry is undefined", () => {
    assert.equal(buildSkillPacksCatalog(undefined), "");
  });

  it("returns empty string when no entries are lazy", () => {
    const out = buildSkillPacksCatalog({
      other: { lazyLoad: false, description: "" },
    });
    assert.equal(out, "");
  });

  it("renders a single lazy pack", () => {
    const out = buildSkillPacksCatalog({
      marketingskills: { lazyLoad: true, description: "Marketing playbooks" },
    });
    assert.ok(out.includes("AVAILABLE SKILL PACKS"));
    assert.ok(out.includes("- marketingskills — Marketing playbooks"));
    assert.ok(out.includes("list_skill_pack_skills"));
    assert.ok(out.includes("load_skill"));
  });

  it("excludes non-lazy packs from the catalog", () => {
    const out = buildSkillPacksCatalog({
      marketingskills: { lazyLoad: true, description: "Marketing playbooks" },
      devtools: { lazyLoad: false, description: "Dev tools (eager)" },
    });
    assert.ok(out.includes("marketingskills"));
    assert.ok(!out.includes("devtools"));
  });

  it("sorts packs alphabetically", () => {
    const out = buildSkillPacksCatalog({
      zebrastuff: { lazyLoad: true, description: "Z pack" },
      anvilstuff: { lazyLoad: true, description: "A pack" },
      mangostuff: { lazyLoad: true, description: "M pack" },
    });
    const anvilIdx = out.indexOf("anvilstuff");
    const mangoIdx = out.indexOf("mangostuff");
    const zebraIdx = out.indexOf("zebrastuff");
    assert.ok(anvilIdx < mangoIdx);
    assert.ok(mangoIdx < zebraIdx);
  });

  it("includes a directive instructing Claude when to use the tools", () => {
    const out = buildSkillPacksCatalog({
      x: { lazyLoad: true, description: "X pack" },
    });
    assert.ok(/call list_skill_pack_skills first/i.test(out));
  });

  describe("user skills subsection", () => {
    it("renders USER SKILLS subsection alongside lazy packs", () => {
      const out = buildSkillPacksCatalog({ x: { lazyLoad: true, description: "X pack" } }, [
        { slug: "copy-improver", description: "When the user wants X" },
        { slug: "meeting-notes", description: "When the user wants Y" },
      ]);
      assert.ok(out.includes("AVAILABLE SKILL PACKS"));
      assert.ok(out.includes("- x — X pack"));
      assert.ok(out.includes("USER SKILLS"));
      assert.ok(out.includes("- copy-improver — When the user wants X"));
      assert.ok(out.includes("- meeting-notes — When the user wants Y"));
    });

    it("renders USER SKILLS even when no lazy packs exist", () => {
      const out = buildSkillPacksCatalog(undefined, [
        { slug: "copy-improver", description: "When the user wants X" },
      ]);
      assert.ok(out.includes("AVAILABLE SKILL PACKS"));
      assert.ok(out.includes("USER SKILLS"));
      assert.ok(out.includes("- copy-improver"));
    });

    it("user skills are alphabetized", () => {
      const out = buildSkillPacksCatalog(undefined, [
        { slug: "zebra", description: "z" },
        { slug: "apple", description: "a" },
        { slug: "mango", description: "m" },
      ]);
      const a = out.indexOf("apple");
      const m = out.indexOf("mango");
      const z = out.indexOf("zebra");
      assert.ok(a < m);
      assert.ok(m < z);
    });

    it("omits the USER SKILLS subsection when the array is empty", () => {
      const out = buildSkillPacksCatalog({ x: { lazyLoad: true, description: "X pack" } }, []);
      assert.ok(out.includes("- x"));
      assert.ok(!out.includes("USER SKILLS"));
    });

    it("returns empty string when both lazy packs are empty and userSkills are empty", () => {
      assert.equal(buildSkillPacksCatalog(undefined, []), "");
    });

    it("returns empty string when registry has only non-lazy entries and no userSkills", () => {
      assert.equal(buildSkillPacksCatalog({ x: { lazyLoad: false, description: "" } }), "");
    });
  });
});
