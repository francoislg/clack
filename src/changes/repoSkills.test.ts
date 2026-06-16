import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { readRepoSkillBody } from "./repoSkills.js";

const worktree = resolve(tmpdir(), `repo-skills-test-${process.pid}`);

function writeRepoSkill(slug: string, contents: string) {
  const dir = join(worktree, ".claude", "skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), contents, "utf-8");
}

beforeEach(() => {
  rmSync(worktree, { recursive: true, force: true });
  mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  rmSync(worktree, { recursive: true, force: true });
});

describe("readRepoSkillBody", () => {
  it("returns the frontmatter-stripped body for an existing repo skill", () => {
    writeRepoSkill("commit-guidelines", `---\nname: commit-guidelines\n---\n\nthe procedure\n`);
    const result = readRepoSkillBody(worktree, "commit-guidelines");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toContain("the procedure");
      expect(result.body).not.toContain("name: commit-guidelines");
    }
  });

  it("returns not-ok when the skill file is absent", () => {
    expect(readRepoSkillBody(worktree, "missing").ok).toBe(false);
  });

  it("rejects an invalid slug without touching the filesystem", () => {
    expect(readRepoSkillBody(worktree, "../../etc/passwd").ok).toBe(false);
    expect(readRepoSkillBody(worktree, "Bad Slug").ok).toBe(false);
  });
});
