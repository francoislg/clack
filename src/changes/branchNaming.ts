export const BRANCH_TYPES = ["fix", "feat", "refactor", "docs", "chore"] as const;
export const BRANCH_PATTERN = /^clack\/(fix|feat|refactor|docs|chore)\/.+$/;

/** Branch names a worker is never allowed to operate on, on top of the repo's own default branch. */
export const PROTECTED_BRANCH_NAMES = ["main", "master"];

export function isValidBranchName(branch: string): boolean {
  return BRANCH_PATTERN.test(branch);
}

/**
 * A branch is protected when it is the repository's configured default branch or one of the
 * always-protected names. Refused even when continuing an existing branch — the convention is
 * relaxed for continuations, but operating on a protected branch is never a valid change.
 */
export function isProtectedBranchName(branch: string, defaultBranch: string): boolean {
  return branch === defaultBranch || PROTECTED_BRANCH_NAMES.includes(branch);
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
