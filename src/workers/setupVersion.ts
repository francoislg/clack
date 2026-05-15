import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolveInstructionFile } from "../instructions.js";

const EMPTY_HASH = sha256("");

/**
 * Compute the hash of the per-repo `worktree_setup_instructions.md` content.
 * Returns `sha256("")` (sentinel) when the file does not exist — workers with
 * this sentinel are treated as setup-complete with nothing to run.
 *
 * Drives re-setup when Clack's setup instructions themselves change. Branch-level
 * dep changes (e.g., a new entry in `pnpm-lock.yaml`) are NOT tracked here —
 * they are handled by the separate install hook that runs before every acquire.
 */
export function computeSetupVersionHash(repoName: string): string {
  const path = resolveInstructionFile(`${repoName}/worktree_setup_instructions.md`);
  if (!path || !existsSync(path)) return EMPTY_HASH;
  return sha256(readFileSync(path, "utf-8"));
}

export function getSentinelHash(): string {
  return EMPTY_HASH;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
