import { describe, it, expect } from "vitest";
import { discoverWorkerSkills, readWorkerSkillBody } from "./workerSkills.js";

/**
 * Verifies the SHIPPED built-in skill at `data/default_configuration/skills/rebase/`. Runs
 * against the real repo data dir (vitest cwd = repo root), so no temp-dir setup — it asserts
 * the default is present and loadable out of the box for any repository.
 */
describe("built-in rebase skill", () => {
  it("is discovered by default for any repository", () => {
    const slugs = discoverWorkerSkills("any-repo").map((s) => s.slug);
    expect(slugs).toContain("rebase");
  });

  it("is loadable and its body describes the rebase procedure", () => {
    const res = readWorkerSkillBody("any-repo", "rebase");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.body).toContain("git rebase");
      expect(res.body).toContain("git fetch origin");
    }
  });
});
