/**
 * Paths the bot owns at runtime on the VM. Never pushed from a clone, whatever the manifest
 * says — a local copy of these is always stale relative to the running bot.
 */
export const RUNTIME_OWNED_PATHS = [
  "data/state",
  "data/sessions",
  "data/worktree-sessions",
  "data/repositories",
  "data/worktrees",
  "data/backups",
  "data/tester",
  "data/downloads",
  "data/error-reports",
  "data/cache",
  "data/.npm",
  "data/.claude",
  "data/mcp_packages",
  "data/.pnpm-store",
] as const;

/** Top-level `data/` entries `pull --all` skips: caches, clones, and this tool's own files. */
export const PULL_ALL_PRUNED_PATHS = [
  "data/repositories",
  "data/worktrees",
  "data/cache",
  "data/.npm",
  "data/.claude",
  "data/mcp_packages",
  "data/.pnpm-store",
  "data/error-reports",
  "data/.debug-sessions",
  "data/.gce-sync-backups",
  "data/.gce-sync-baseline.json",
] as const;

export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** One path per line; `#` comments and blank lines ignored; trailing slashes dropped. */
export function parseManifest(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.replace(/\/+$/, ""));
}

/** Every reason a manifest entry can't be pushed; empty when all entries are pushable. */
export function unpushableEntries(paths: readonly string[]): string[] {
  const problems: string[] = [];
  for (const path of paths) {
    if (!isUnder(path, "data") || path === "data") {
      problems.push(`${path}: must be a path under data/`);
    } else if (path.split("/").includes("..")) {
      problems.push(`${path}: must not contain '..'`);
    } else {
      const owner = RUNTIME_OWNED_PATHS.find((root) => isUnder(path, root) || isUnder(root, path));
      if (owner) problems.push(`${path}: overlaps ${owner}, which the running bot owns`);
    }
  }
  return problems;
}

/**
 * Narrows the manifest to the `--path` selections. Each selection must sit inside a manifest
 * entry; the result keeps the selections themselves so a single file can be targeted.
 */
export function selectRoots(manifest: readonly string[], selections: readonly string[]): string[] {
  if (selections.length === 0) return [...manifest];
  const cleaned = selections.map((s) => s.replace(/\/+$/, ""));
  const outside = cleaned.filter((s) => !manifest.some((root) => isUnder(s, root)));
  if (outside.length > 0) {
    throw new Error(`--path outside the manifest: ${outside.join(", ")}`);
  }
  return cleaned;
}
