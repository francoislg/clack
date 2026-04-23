import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SkillsManager,
  prepareSkillsSession,
  type PackInfo,
  type SkillsSessionSetupDeps,
  type SkillsManagerDeps,
} from "./skillsManager.js";
import type { SkillPluginRegistry } from "../config.js";
import type { SkillPluginInfo } from "../skillPlugins.js";
import type { SessionContext } from "../sessions.js";

function makePack(name: string, skills: Array<{ name: string; description?: string }>): PackInfo {
  return {
    name,
    path: `/fake/data/skill-plugins/${name}`,
    description: `${name} pack`,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description ?? `${s.name} desc`,
      skillMdPath: `/fake/data/skill-plugins/${name}/skills/${s.name}/SKILL.md`,
    })),
  };
}

function makeRegistry(entries: Record<string, { lazyLoad: boolean; description: string }>) {
  return entries as SkillPluginRegistry;
}

describe("SkillsManager — accessors", () => {
  it("knowsLazyPack returns true for packs in the lazy map", () => {
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [])]]),
      makeRegistry({
        marketingskills: { lazyLoad: true, description: "Marketing" },
      }),
    );
    assert.equal(mgr.knowsLazyPack("marketingskills"), true);
    assert.equal(mgr.knowsLazyPack("unknown"), false);
  });

  it("isEagerPack returns true only for registry entries with lazyLoad: false", () => {
    const mgr = new SkillsManager(
      new Map(),
      makeRegistry({
        devtools: { lazyLoad: false, description: "" },
        marketingskills: { lazyLoad: true, description: "Marketing" },
      }),
    );
    assert.equal(mgr.isEagerPack("devtools"), true);
    assert.equal(mgr.isEagerPack("marketingskills"), false);
    assert.equal(mgr.isEagerPack("unknown"), false);
  });

  it("knownLazyPackNames returns names sorted alphabetically", () => {
    const mgr = new SkillsManager(
      new Map([
        ["zebrastuff", makePack("zebrastuff", [])],
        ["anvilstuff", makePack("anvilstuff", [])],
      ]),
      makeRegistry({
        zebrastuff: { lazyLoad: true, description: "Z" },
        anvilstuff: { lazyLoad: true, description: "A" },
      }),
    );
    assert.deepEqual(mgr.knownLazyPackNames(), ["anvilstuff", "zebrastuff"]);
  });

  it("packDescription returns the stored description or undefined", () => {
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [])]]),
      makeRegistry({
        marketingskills: { lazyLoad: true, description: "Marketing" },
      }),
    );
    assert.equal(mgr.packDescription("marketingskills"), "marketingskills pack");
    assert.equal(mgr.packDescription("unknown"), undefined);
  });
});

describe("SkillsManager — listSkills & getSkill", () => {
  it("listSkills returns skills sorted alphabetically", () => {
    const mgr = new SkillsManager(
      new Map([
        [
          "marketingskills",
          makePack("marketingskills", [
            { name: "pricing-strategy" },
            { name: "ab-test-setup" },
            { name: "copywriting" },
          ]),
        ],
      ]),
      makeRegistry({ marketingskills: { lazyLoad: true, description: "M" } }),
    );
    const skills = mgr.listSkills("marketingskills");
    assert.ok(skills);
    assert.deepEqual(
      skills.map((s) => s.name),
      ["ab-test-setup", "copywriting", "pricing-strategy"],
    );
  });

  it("listSkills returns undefined for unknown packs", () => {
    const mgr = new SkillsManager(new Map(), makeRegistry({}));
    assert.equal(mgr.listSkills("nope"), undefined);
  });

  it("getSkill returns the matching skill or undefined", () => {
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [{ name: "ab-test-setup" }])]]),
      makeRegistry({ marketingskills: { lazyLoad: true, description: "M" } }),
    );
    const found = mgr.getSkill("marketingskills", "ab-test-setup");
    assert.ok(found);
    assert.equal(found.name, "ab-test-setup");
    assert.equal(mgr.getSkill("marketingskills", "ghost"), undefined);
    assert.equal(mgr.getSkill("nope", "ab-test-setup"), undefined);
  });
});

describe("SkillsManager — readSkillBody", () => {
  it("returns the full body via the injected readFile dep", () => {
    const reads: string[] = [];
    const deps: SkillsManagerDeps = {
      readFile: (path) => {
        reads.push(path);
        return "---\nname: ab-test-setup\n---\n\nSkill body here";
      },
    };
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [{ name: "ab-test-setup" }])]]),
      makeRegistry({ marketingskills: { lazyLoad: true, description: "M" } }),
      [],
      deps,
    );

    const body = mgr.readSkillBody("marketingskills", "ab-test-setup");
    assert.ok(body.includes("Skill body here"));
    assert.equal(reads.length, 1);
    assert.ok(reads[0].endsWith("/ab-test-setup/SKILL.md"));
  });

  it("throws when the skill is unknown", () => {
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [])]]),
      makeRegistry({ marketingskills: { lazyLoad: true, description: "M" } }),
    );
    assert.throws(() => mgr.readSkillBody("marketingskills", "ghost"), /not found/);
  });
});

describe("SkillsManager — loaded state", () => {
  it("isSkillLoaded reflects the seeded list", () => {
    const mgr = new SkillsManager(
      new Map([["m", makePack("m", [{ name: "a" }])]]),
      makeRegistry({ m: { lazyLoad: true, description: "M" } }),
      [{ pack: "m", skill: "a" }],
    );
    assert.equal(mgr.isSkillLoaded("m", "a"), true);
    assert.equal(mgr.isSkillLoaded("m", "b"), false);
  });

  it("markLoaded records the pair and returns the full updated list", () => {
    const mgr = new SkillsManager(
      new Map([["m", makePack("m", [{ name: "a" }, { name: "b" }])]]),
      makeRegistry({ m: { lazyLoad: true, description: "M" } }),
      [{ pack: "m", skill: "a" }],
    );
    const updated = mgr.markLoaded("m", "b");
    assert.equal(mgr.isSkillLoaded("m", "b"), true);
    const pairs = updated.map((p) => `${p.pack}/${p.skill}`).sort();
    assert.deepEqual(pairs, ["m/a", "m/b"]);
  });

  it("markLoaded is idempotent on repeat calls", () => {
    const mgr = new SkillsManager(
      new Map([["m", makePack("m", [{ name: "a" }])]]),
      makeRegistry({ m: { lazyLoad: true, description: "M" } }),
    );
    const first = mgr.markLoaded("m", "a");
    const second = mgr.markLoaded("m", "a");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.deepEqual(second, first);
  });
});

describe("SkillsManager — catalog", () => {
  it("returns lazy packs sorted alphabetically by name", () => {
    const mgr = new SkillsManager(
      new Map([
        ["zebra", makePack("zebra", [])],
        ["anvil", makePack("anvil", [])],
      ]),
      makeRegistry({
        zebra: { lazyLoad: true, description: "Z" },
        anvil: { lazyLoad: true, description: "A" },
      }),
    );
    const cat = mgr.catalog();
    assert.deepEqual(
      cat.map((c) => c.name),
      ["anvil", "zebra"],
    );
  });
});

// ---------------------------------------------------------------------------
// prepareSkillsSession
// ---------------------------------------------------------------------------

function fakeSession(loadedSkills?: Array<{ pack: string; skill: string }>): SessionContext {
  return {
    sessionId: "S",
    channelId: "C",
    messageTs: "0",
    threadTs: "0",
    userId: "U",
    trigger: { type: "mentions", userId: "U", messageTs: "0", messageText: "" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
    loadedSkills,
  };
}

function depsWithFiles(files: Record<string, string>, dirs: Set<string>): SkillsSessionSetupDeps {
  return {
    existsSync: (p) => p in files || dirs.has(p),
    readdirSync: (p) => {
      const entries = new Set<string>();
      const prefix = p.endsWith("/") ? p : p + "/";
      for (const key of [...Object.keys(files), ...dirs]) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) entries.add(first);
      }
      return Array.from(entries);
    },
    readFileSync: (p) => {
      const content = files[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    statSync: (p) => ({ isDirectory: () => dirs.has(p) }),
  };
}

describe("prepareSkillsSession", () => {
  it("skips non-lazy plugins", () => {
    const pluginInfos: SkillPluginInfo[] = [
      {
        name: "eager",
        path: "/fake/data/skill-plugins/eager",
        skillCount: 0,
        lazyLoad: false,
      },
    ];
    const mgr = prepareSkillsSession(
      fakeSession(),
      pluginInfos,
      makeRegistry({ eager: { lazyLoad: false, description: "" } }),
      depsWithFiles({}, new Set()),
    );
    assert.equal(mgr.knowsLazyPack("eager"), false);
    assert.equal(mgr.isEagerPack("eager"), true);
    assert.deepEqual(mgr.knownLazyPackNames(), []);
  });

  it("scans lazy plugins and extracts frontmatter", () => {
    const pluginPath = "/fake/data/skill-plugins/marketingskills";
    const skillsDir = `${pluginPath}/skills`;
    const skillDir = `${skillsDir}/ab-test-setup`;
    const mdPath = `${skillDir}/SKILL.md`;
    const files: Record<string, string> = {
      [mdPath]:
        "---\nname: ab-test-setup\ndescription: Plan and design A/B tests for landing pages.\n---\n\nBody content",
    };
    const dirs = new Set([pluginPath, skillsDir, skillDir]);

    const pluginInfos: SkillPluginInfo[] = [
      {
        name: "marketingskills",
        path: pluginPath,
        skillCount: 1,
        lazyLoad: true,
      },
    ];

    const mgr = prepareSkillsSession(
      fakeSession(),
      pluginInfos,
      makeRegistry({
        marketingskills: { lazyLoad: true, description: "Marketing" },
      }),
      depsWithFiles(files, dirs),
    );

    assert.equal(mgr.knowsLazyPack("marketingskills"), true);
    const skills = mgr.listSkills("marketingskills");
    assert.ok(skills);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "ab-test-setup");
    assert.equal(skills[0].description, "Plan and design A/B tests for landing pages.");
  });

  it("falls back to directory name when frontmatter is missing", () => {
    const pluginPath = "/fake/data/skill-plugins/marketingskills";
    const skillsDir = `${pluginPath}/skills`;
    const skillDir = `${skillsDir}/noname`;
    const mdPath = `${skillDir}/SKILL.md`;
    const files: Record<string, string> = {
      [mdPath]: "body without frontmatter\n",
    };
    const dirs = new Set([pluginPath, skillsDir, skillDir]);

    const pluginInfos: SkillPluginInfo[] = [
      {
        name: "marketingskills",
        path: pluginPath,
        skillCount: 1,
        lazyLoad: true,
      },
    ];

    const mgr = prepareSkillsSession(
      fakeSession(),
      pluginInfos,
      makeRegistry({ marketingskills: { lazyLoad: true, description: "M" } }),
      depsWithFiles(files, dirs),
    );

    const skills = mgr.listSkills("marketingskills");
    assert.ok(skills);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "noname");
    assert.equal(skills[0].description, "");
  });

  it("seeds loaded state from session.loadedSkills", () => {
    const pluginInfos: SkillPluginInfo[] = [];
    const mgr = prepareSkillsSession(
      fakeSession([{ pack: "marketingskills", skill: "ab-test-setup" }]),
      pluginInfos,
      makeRegistry({}),
      depsWithFiles({}, new Set()),
    );
    assert.equal(mgr.isSkillLoaded("marketingskills", "ab-test-setup"), true);
  });

  it("handles a lazy pack with no skills directory", () => {
    const pluginPath = "/fake/data/skill-plugins/empty";
    const dirs = new Set([pluginPath]);

    const pluginInfos: SkillPluginInfo[] = [
      { name: "empty", path: pluginPath, skillCount: 0, lazyLoad: true },
    ];

    const mgr = prepareSkillsSession(
      fakeSession(),
      pluginInfos,
      makeRegistry({ empty: { lazyLoad: true, description: "E" } }),
      depsWithFiles({}, dirs),
    );

    assert.equal(mgr.knowsLazyPack("empty"), true);
    assert.deepEqual(mgr.listSkills("empty"), []);
  });
});
