import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { getWorkerSkillBody, clearWorkerSkillBodyCache } from "./workerSkillsBodyCache.js";

const tmpBase = resolve(tmpdir(), `worker-skills-cache-test-${process.pid}`);
const dataDir = join(tmpBase, "data");
const REPO = "myrepo";
const originalCwd = process.cwd();

function write(tier: "configuration" | "default_configuration", slug: string, body: string) {
  const dir = join(dataDir, tier, "skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: "d"\n---\n\n${body}\n`,
    "utf-8",
  );
  return join(dir, "SKILL.md");
}

beforeEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  process.chdir(tmpBase);
  clearWorkerSkillBodyCache();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpBase, { recursive: true, force: true });
  clearWorkerSkillBodyCache();
});

describe("getWorkerSkillBody", () => {
  it("first read populates the cache (fromCache=false)", () => {
    write("default_configuration", "rebase", "body one");
    const res = getWorkerSkillBody(REPO, "rebase");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fromCache).toBe(false);
      expect(res.body.trim()).toBe("body one");
    }
  });

  it("second read with unchanged mtime returns the cached body", () => {
    write("default_configuration", "rebase", "body one");
    getWorkerSkillBody(REPO, "rebase");
    const res = getWorkerSkillBody(REPO, "rebase");
    expect(res.ok && res.fromCache).toBe(true);
  });

  it("re-reads when the file mtime changes", () => {
    const path = write("default_configuration", "rebase", "body one");
    getWorkerSkillBody(REPO, "rebase");
    writeFileSync(path, `---\nname: rebase\ndescription: "d"\n---\n\nbody two\n`, "utf-8");
    const future = new Date(Date.now() + 5000);
    utimesSync(path, future, future);
    const res = getWorkerSkillBody(REPO, "rebase");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fromCache).toBe(false);
      expect(res.body.trim()).toBe("body two");
    }
  });

  it("returns ok:false for an unknown skill", () => {
    expect(getWorkerSkillBody(REPO, "nope")).toEqual({ ok: false });
  });

  it("reflects a runtime override appearing at configuration/ on the next call", () => {
    write("default_configuration", "rebase", "default body");
    const first = getWorkerSkillBody(REPO, "rebase");
    expect(first.ok && first.body.trim()).toBe("default body");

    const overridePath = write("configuration", "rebase", "override body");
    const future = new Date(Date.now() + 5000);
    utimesSync(overridePath, future, future);

    const second = getWorkerSkillBody(REPO, "rebase");
    expect(second.ok && second.body.trim()).toBe("override body");
  });
});
