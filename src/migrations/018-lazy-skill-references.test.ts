import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migration } from "./018-lazy-skill-references.js";

describe("migration 018: lazy-skill-references", () => {
  it("metadata is correct", () => {
    assert.equal(migration.version, 18);
    assert.equal(migration.priority, "enhancement");
    assert.equal(migration.static, undefined);
    assert.ok(migration.prompt);
    assert.ok(migration.prompt!.length > 0);
  });

  it("references data/config.json so Claude can identify lazy packs", () => {
    assert.ok(migration.files.includes("data/config.json"));
  });

  it("includes baseline user instruction files", () => {
    const baseline = [
      "data/configuration/user/integrations.md",
      "data/configuration/user/metabase.md",
      "data/configuration/user/response-style.md",
    ];
    for (const path of baseline) {
      assert.ok(migration.files.includes(path), `missing baseline file: ${path}`);
    }
  });

  it("includes topic files so nested references are caught", () => {
    const topics = [
      "data/configuration/user/topics/metabase/metabase.md",
      "data/configuration/user/topics/sentry/sentry.md",
      "data/configuration/user/topics/scheduling/scheduled-messages.md",
    ];
    for (const path of topics) {
      assert.ok(migration.files.includes(path), `missing topic file: ${path}`);
    }
  });

  it("prompt explains both rewrite shapes (Skill() call + prose mention)", () => {
    const prompt = migration.prompt!;
    assert.ok(prompt.includes('Skill("'));
    assert.ok(prompt.includes("load_skill("));
    assert.ok(/prose/i.test(prompt));
  });

  it("prompt has explicit re-run safety rule", () => {
    const prompt = migration.prompt!.toLowerCase();
    assert.ok(prompt.includes("re-run safety"));
  });

  it("prompt instructs the no-op behavior when no lazy packs are configured", () => {
    const prompt = migration.prompt!.toLowerCase();
    assert.ok(prompt.includes("no lazy packs configured"));
  });

  it("prompt references the lazy-pack registry source of truth", () => {
    const prompt = migration.prompt!;
    assert.ok(prompt.includes("skillPlugins"));
    assert.ok(prompt.includes("lazyLoad"));
  });

  it("prompt references the two new tools Claude must call", () => {
    const prompt = migration.prompt!;
    assert.ok(prompt.includes("list_skill_pack_skills"));
    assert.ok(prompt.includes("load_skill"));
  });

  it("does NOT list files under data/default_configuration/", () => {
    for (const path of migration.files) {
      assert.ok(
        !path.startsWith("data/default_configuration/"),
        `shipped defaults are read-only; unexpected file in scope: ${path}`,
      );
    }
  });
});
