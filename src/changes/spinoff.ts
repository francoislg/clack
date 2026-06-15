import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { getSpinoffPatchesDir } from "../config.js";

/**
 * Shape of a staged spinoff slice. Single source of truth — the worker tool's input
 * is validated into this, the staged intent carries it, and the orchestrator reads it.
 */
export const spinoffIntentSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  proposedBranch: z.string().min(1),
  /** Absolute path to the captured patch on the host-shared filesystem. */
  patchPath: z.string().min(1),
});

export type SpinoffIntentData = z.infer<typeof spinoffIntentSchema>;

/** Build the absolute patch path for a given branch + slot, under the shared patches dir. */
export function spinoffPatchPath(branchName: string, index: number): string {
  const safeBranch = branchName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return resolve(getSpinoffPatchesDir(), `${safeBranch}.${index}.patch`);
}

export interface SpinoffGitOps {
  /**
   * Capture the changes to `paths` (tracked modifications AND newly-added files) as a patch
   * written to `patchPath`, then revert those paths in the worktree so the slice no longer
   * appears on the originating branch. Returns the captured patch text.
   */
  captureAndRevertSlice: (
    worktreePath: string,
    paths: string[],
    patchPath: string,
  ) => Promise<string>;
  /** Apply a previously-captured patch onto the worktree's working tree (unstaged). */
  applySlicePatch: (worktreePath: string, patchPath: string) => Promise<void>;
}

export const defaultSpinoffGitOps: SpinoffGitOps = {
  async captureAndRevertSlice(worktreePath, paths, patchPath) {
    const git = simpleGit(worktreePath);
    const status = await git.status([...paths]);
    const newPaths = new Set(status.not_added.concat(status.created));

    // `git add -N` records intent-to-add so untracked files show up in `git diff`.
    const untracked = paths.filter((p) => newPaths.has(p));
    if (untracked.length > 0) {
      await git.raw(["add", "-N", ...untracked]);
    }

    const patch = await git.diff(["--", ...paths]);
    mkdirSync(dirname(patchPath), { recursive: true });
    await writeFile(patchPath, patch, "utf-8");

    // Undo the intent-to-add so the index is clean, then revert the working tree:
    // tracked paths are restored from HEAD, newly-added files are deleted outright.
    if (untracked.length > 0) {
      await git.raw(["reset", "--", ...untracked]);
    }
    const tracked = paths.filter((p) => !newPaths.has(p));
    if (tracked.length > 0) {
      await git.checkout(["--", ...tracked]);
    }
    for (const p of untracked) {
      rmSync(resolve(worktreePath, p), { force: true });
    }

    return patch;
  },

  async applySlicePatch(worktreePath, patchPath) {
    const git = simpleGit(worktreePath);
    await git.raw(["apply", patchPath]);
  },
};
