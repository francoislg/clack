import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { buildWorkerSkillsCatalog, appendWorkerSkillsCatalog } from "./workerSkillsCatalog.js";

describe("buildWorkerSkillsCatalog", () => {
  it("returns an empty string when no skills resolve", () => {
    expect(buildWorkerSkillsCatalog([])).toBe("");
  });

  it("renders the expected header, line format, and load_skill directive", () => {
    const catalog = buildWorkerSkillsCatalog([
      { slug: "rebase", description: "Rebase the branch" },
    ]);
    expect(catalog.startsWith('WORKER SKILLS (call load_skill({ skill: "<slug>" })')).toBe(true);
    expect(catalog).toMatch(/^- rebase — Rebase the branch$/m);
  });

  it("alphabetizes by slug", () => {
    const catalog = buildWorkerSkillsCatalog([
      { slug: "split-commit", description: "Split a commit" },
      { slug: "rebase", description: "Rebase the branch" },
    ]);
    expect(catalog.indexOf("- rebase")).toBeLessThan(catalog.indexOf("- split-commit"));
  });
});

describe("appendWorkerSkillsCatalog", () => {
  const tmpBase = resolve(tmpdir(), `worker-skills-append-test-${process.pid}`);
  const dataDir = join(tmpBase, "data");
  const REPO = "myrepo";
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("leaves the prompt byte-identical when no skills resolve", () => {
    const prompt = "SYSTEM PROMPT";
    expect(appendWorkerSkillsCatalog(prompt, REPO)).toBe(prompt);
  });

  it("appends the catalog block when a skill resolves", () => {
    const dir = join(dataDir, "default_configuration", "skills", "rebase");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: rebase\ndescription: "Rebase it"\n---\n\nbody\n`,
      "utf-8",
    );
    const result = appendWorkerSkillsCatalog("SYSTEM PROMPT", REPO);
    expect(result.startsWith("SYSTEM PROMPT\n\nWORKER SKILLS")).toBe(true);
    expect(result).toContain("- rebase — Rebase it");
  });
});
