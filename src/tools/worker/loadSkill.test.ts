import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createLoadSkillTool } from "./loadSkill.js";
import { parseToolResult } from "../testHelpers.js";
import { clearWorkerSkillBodyCache } from "../../changes/workerSkillsBodyCache.js";

const tmpBase = resolve(tmpdir(), `worker-loadskill-test-${process.pid}`);
const dataDir = join(tmpBase, "data");
const worktreeDir = join(tmpBase, "worktree");
const REPO = "my-repo";
const originalCwd = process.cwd();

function writeSkill(
  tier: "configuration" | "default_configuration",
  scope: "global" | "repo",
  slug: string,
  body: string,
) {
  const base =
    scope === "repo" ? join(dataDir, tier, REPO, "skills") : join(dataDir, tier, "skills");
  const dir = join(base, slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${slug}\ndescription: "d"\n---\n\n${body}\n`, "utf-8");
  return path;
}

/** Write a skill into the repo's own checkout at `<worktree>/.claude/skills/<slug>/SKILL.md`. */
function writeRepoSkill(slug: string, body: string) {
  const dir = join(worktreeDir, ".claude", "skills", slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${slug}\ndescription: "d"\n---\n\n${body}\n`, "utf-8");
  return path;
}

const invoke = (slug: string) =>
  createLoadSkillTool({ repoName: REPO, worktreePath: worktreeDir }).handler(
    { skill: slug },
    { sessionId: "test" },
  );

type LoadResult = Awaited<ReturnType<ReturnType<typeof createLoadSkillTool>["handler"]>>;

function firstText(result: LoadResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

beforeEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });
  process.chdir(tmpBase);
  clearWorkerSkillBodyCache();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpBase, { recursive: true, force: true });
  clearWorkerSkillBodyCache();
});

describe("worker load_skill tool", () => {
  it("returns the body with a preamble naming the skill and catalog origin", async () => {
    writeSkill("default_configuration", "global", "rebase", "the procedure");
    const result = await invoke("rebase");
    expect(result.isError).toBeUndefined();
    const text = firstText(result);
    expect(text).toMatch(/^Loaded skill 'rebase' from the worker skill catalog\./);
    expect(text).toContain("the procedure");
  });

  it("errors on an unknown skill, naming both sources", async () => {
    const result = await invoke("does-not-exist");
    expect(result.isError).toBe(true);
    const parsed = parseToolResult(result);
    expect(parsed.error).toContain("does-not-exist");
    expect(parsed.error).toContain("WORKER SKILLS");
    expect(parsed.error).toContain(".claude/skills/does-not-exist/SKILL.md");
  });

  it("loads a skill the repo ships in its own .claude/skills/", async () => {
    writeRepoSkill("commit-guidelines", "repo procedure");
    const result = await invoke("commit-guidelines");
    expect(result.isError).toBeUndefined();
    const text = firstText(result);
    expect(text).toMatch(/^Loaded skill 'commit-guidelines' from the repository's own/);
    expect(text).toContain("repo procedure");
  });

  it("prefers the repo skill over a Clack worker skill of the same slug", async () => {
    writeSkill("default_configuration", "global", "rebase", "clack body");
    writeRepoSkill("rebase", "repo body");
    const text = firstText(await invoke("rebase"));
    expect(text).toContain("repo body");
    expect(text).not.toContain("clack body");
    expect(text).toContain("the repository's own");
  });

  it("falls back to the Clack worker skill when the repo has none", async () => {
    writeSkill("default_configuration", "global", "rebase", "clack body");
    const text = firstText(await invoke("rebase"));
    expect(text).toContain("clack body");
    expect(text).toContain("the worker skill catalog");
  });

  it("returns the per-repo body when it masks a global skill", async () => {
    writeSkill("default_configuration", "global", "rebase", "global body");
    writeSkill("default_configuration", "repo", "rebase", "repo body");
    const text = firstText(await invoke("rebase"));
    expect(text).toContain("repo body");
    expect(text).not.toContain("global body");
  });

  it("hot-reloads the body when the file changes mid-run", async () => {
    const path = writeSkill("default_configuration", "global", "rebase", "old body");
    await invoke("rebase");
    writeFileSync(path, `---\nname: rebase\ndescription: "d"\n---\n\nnew body\n`, "utf-8");
    const future = new Date(Date.now() + 5000);
    utimesSync(path, future, future);
    const text = firstText(await invoke("rebase"));
    expect(text).toContain("new body");
    expect(text).not.toContain("old body");
  });
});
