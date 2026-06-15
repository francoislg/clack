import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { simpleGit } from "simple-git";
import { defaultSpinoffGitOps } from "./spinoff.js";

async function initRepo(dir: string): Promise<void> {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/a.ts"), "base-a\n");
  writeFileSync(join(dir, "src/keep.ts"), "base-keep\n");
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "t@t.test");
  await git.addConfig("user.name", "Test");
  await git.add(".");
  await git.commit("base");
}

describe("spinoff git ops (integration)", () => {
  let root: string;
  let origin: string;
  let sibling: string;
  let patchPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "clack-spinoff-"));
    origin = join(root, "origin");
    sibling = join(root, "sibling");
    patchPath = join(root, "patches", "slice.patch");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("captures the slice, reverts it from the origin, and applies it cleanly on a sibling", async () => {
    await initRepo(origin);

    // Origin work: modify a tracked file (slice), add a new file (slice), modify a non-slice file.
    writeFileSync(join(origin, "src/a.ts"), "changed-a\n");
    writeFileSync(join(origin, "src/new.ts"), "brand-new\n");
    writeFileSync(join(origin, "src/keep.ts"), "changed-keep\n");

    await defaultSpinoffGitOps.captureAndRevertSlice(origin, ["src/a.ts", "src/new.ts"], patchPath);

    // Patch written.
    expect(existsSync(patchPath)).toBe(true);
    expect(readFileSync(patchPath, "utf-8").length).toBeGreaterThan(0);

    // Slice reverted in origin: tracked file restored, new file removed.
    expect(readFileSync(join(origin, "src/a.ts"), "utf-8")).toBe("base-a\n");
    expect(existsSync(join(origin, "src/new.ts"))).toBe(false);

    // Non-slice change is untouched.
    expect(readFileSync(join(origin, "src/keep.ts"), "utf-8")).toBe("changed-keep\n");

    // Apply on a fresh sibling branched from the same base.
    await initRepo(sibling);
    await defaultSpinoffGitOps.applySlicePatch(sibling, patchPath);

    expect(readFileSync(join(sibling, "src/a.ts"), "utf-8")).toBe("changed-a\n");
    expect(readFileSync(join(sibling, "src/new.ts"), "utf-8")).toBe("brand-new\n");
    // The sibling did NOT receive the non-slice change.
    expect(readFileSync(join(sibling, "src/keep.ts"), "utf-8")).toBe("base-keep\n");
  });

  it("creates the patch directory if it does not exist", async () => {
    await initRepo(origin);
    writeFileSync(join(origin, "src/a.ts"), "changed-a\n");

    const nested = resolve(root, "deep", "nested", "dir", "slice.patch");
    await defaultSpinoffGitOps.captureAndRevertSlice(origin, ["src/a.ts"], nested);

    expect(existsSync(nested)).toBe(true);
  });
});
