export const BRANCH_TYPES = ["fix", "feat", "refactor", "docs", "chore"] as const;
export const BRANCH_PATTERN = /^clack\/(fix|feat|refactor|docs|chore)\/.+$/;

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch);
}

/**
 * Return `branch` if no existing branch collides, otherwise append the smallest
 * `-N` suffix (starting at 2) that clears `exists`. Used when provisioning a
 * spinoff sibling whose proposed branch may already be live.
 */
export function resolveNonCollidingBranch(
  branch: string,
  exists: (candidate: string) => boolean,
): string {
  if (!exists(branch)) return branch;
  for (let n = 2; ; n++) {
    const candidate = `${branch}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
