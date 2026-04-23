import { describe, it } from "node:test";
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
});
