import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  discoverWorkerSkills,
  readWorkerSkillBody,
  getWorkerSkillMtimeMs,
} from "./workerSkills.js";

const tmpBase = resolve(tmpdir(), `worker-skills-test-${process.pid}`);
const dataDir = join(tmpBase, "data");
const REPO = "myrepo";
const originalCwd = process.cwd();

type Scope = "global" | "repo";
type Tier = "configuration" | "default_configuration";

function skillFile(tier: Tier, scope: Scope, slug: string, description: string, body: string) {
  const base =
    scope === "repo" ? join(dataDir, tier, REPO, "skills") : join(dataDir, tier, "skills");
  const dir = join(base, slug);
  mkdirSync(dir, { recursive: true });
  const md = `---\nname: ${slug}\ndescription: "${description}"\n---\n\n${body}\n`;
  writeFileSync(join(dir, "SKILL.md"), md, "utf-8");
}

beforeEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  process.chdir(tmpBase);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("discoverWorkerSkills", () => {
  it("discovers a built-in global skill from default_configuration", () => {
    skillFile("default_configuration", "global", "rebase", "Rebase the branch", "do the rebase");
    const skills = discoverWorkerSkills(REPO);
    expect(skills).toEqual([{ slug: "rebase", description: "Rebase the branch" }]);
  });

  it("discovers a skill from configuration when default_configuration lacks it", () => {
    skillFile("configuration", "global", "custom", "Custom skill", "body");
    expect(discoverWorkerSkills(REPO)).toEqual([{ slug: "custom", description: "Custom skill" }]);
  });

  it("trims surrounding whitespace from the description", () => {
    skillFile("default_configuration", "global", "padded", "  Rebase it  ", "body");
    expect(discoverWorkerSkills(REPO)).toEqual([{ slug: "padded", description: "Rebase it" }]);
  });

  it("returns the trimmed description and ignores extra frontmatter keys", () => {
    const dir = join(dataDir, "default_configuration", "skills", "rebase");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: rebase\ndescription: "Rebase it"\nargument-hint: branch\nallowed-tools: Bash(git:*)\n---\n\nbody\n`,
      "utf-8",
    );
    expect(discoverWorkerSkills(REPO)).toEqual([{ slug: "rebase", description: "Rebase it" }]);
  });

  it("skips a skill whose description is missing", () => {
    const dir = join(dataDir, "default_configuration", "skills", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: broken\n---\n\nbody\n`, "utf-8");
    expect(discoverWorkerSkills(REPO)).toEqual([]);
  });

  it("skips a skill whose description is whitespace-only", () => {
    skillFile("default_configuration", "global", "blank", "   ", "body");
    expect(discoverWorkerSkills(REPO)).toEqual([]);
  });

  it("skips directories with an invalid slug", () => {
    skillFile("default_configuration", "global", "Bad_Slug", "nope", "body");
    expect(discoverWorkerSkills(REPO)).toEqual([]);
  });

  it("returns empty when no skills exist", () => {
    expect(discoverWorkerSkills(REPO)).toEqual([]);
  });

  it("per-repo skill masks a global skill of the same slug", () => {
    skillFile("default_configuration", "global", "rebase", "global desc", "global body");
    skillFile("default_configuration", "repo", "rebase", "repo desc", "repo body");
    expect(discoverWorkerSkills(REPO)).toEqual([{ slug: "rebase", description: "repo desc" }]);
  });

  it("merges distinct global and per-repo slugs", () => {
    skillFile("default_configuration", "global", "rebase", "rebase desc", "b");
    skillFile("default_configuration", "repo", "deploy", "deploy desc", "b");
    const slugs = discoverWorkerSkills(REPO)
      .map((s) => s.slug)
      .sort();
    expect(slugs).toEqual(["deploy", "rebase"]);
  });
});

describe("readWorkerSkillBody", () => {
  it("reads the resolved body", () => {
    skillFile("default_configuration", "global", "rebase", "d", "the procedure");
    const res = readWorkerSkillBody(REPO, "rebase");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.body.trim()).toBe("the procedure");
  });

  it("returns ok:false for an unknown slug", () => {
    expect(readWorkerSkillBody(REPO, "nope")).toEqual({ ok: false });
  });

  it("returns ok:false for an invalid slug", () => {
    expect(readWorkerSkillBody(REPO, "Bad_Slug")).toEqual({ ok: false });
  });

  it("configuration override masks default_configuration within a scope", () => {
    skillFile("default_configuration", "global", "rebase", "d", "default body");
    skillFile("configuration", "global", "rebase", "d", "override body");
    const res = readWorkerSkillBody(REPO, "rebase");
    expect(res.ok && res.body.trim()).toBe("override body");
  });

  it("per-repo default beats global configuration (scope wins over tier)", () => {
    skillFile("configuration", "global", "rebase", "d", "global override body");
    skillFile("default_configuration", "repo", "rebase", "d", "repo body");
    const res = readWorkerSkillBody(REPO, "rebase");
    expect(res.ok && res.body.trim()).toBe("repo body");
  });
});

describe("getWorkerSkillMtimeMs", () => {
  it("returns a number for an existing skill and null for an unknown one", () => {
    skillFile("default_configuration", "global", "rebase", "d", "b");
    expect(typeof getWorkerSkillMtimeMs(REPO, "rebase")).toBe("number");
    expect(getWorkerSkillMtimeMs(REPO, "nope")).toBeNull();
  });
});
