import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getDownloadsDir, type Config, type ManagedRootName } from "../config.js";

/** A folder whose files Clack tracks in the file ledger. */
export interface ManagedRoot {
  name: ManagedRootName;
  dir: string;
  /** When set, every file in this root belongs to this owner (no per-owner subfolders). */
  fixedOwner?: string;
}

export const SYSTEM_OWNER = "_system";
export const TESTER_OWNER = "tester";

export interface RootsDeps {
  realpath: (p: string) => Promise<string>;
}

export const defaultRootsDeps: RootsDeps = {
  realpath: (p) => realpath(p),
};

export function pluginOwner(pluginName: string): string {
  return `plugin:${pluginName}`;
}

export function getManagedRoots(config: Pick<Config, "tester">): ManagedRoot[] {
  const roots: ManagedRoot[] = [{ name: "downloads", dir: getDownloadsDir() }];
  const recordingsDir = config.tester?.recordingsDir;
  if (typeof recordingsDir === "string" && recordingsDir.length > 0) {
    roots.push({ name: "recordings", dir: resolve(recordingsDir), fixedOwner: TESTER_OWNER });
  }
  return roots;
}

export function findRoot(roots: ManagedRoot[], name: ManagedRootName): ManagedRoot | undefined {
  return roots.find((root) => root.name === name);
}

export function isSafeSegment(s: string): boolean {
  if (s.length === 0) return false;
  if (s === "." || s === "..") return false;
  return !s.includes("/") && !s.includes("\\") && !s.includes("\0");
}

/** `relative` result is inside its base: non-empty, not climbing out, not on another drive. */
export function isContainedRelative(rel: string): boolean {
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function toPosixRel(rel: string): string {
  return rel.split(sep).join("/");
}

export async function resolveInRoot(
  root: ManagedRoot,
  path: string,
  deps: RootsDeps = defaultRootsDeps,
): Promise<
  | { ok: true; realPath: string; relPath: string }
  | { ok: false; reason: "missing" | "outside"; error: string }
> {
  const candidate = resolve(root.dir, path);
  let realCandidate: string;
  let realRoot: string;
  try {
    realCandidate = await deps.realpath(candidate);
    realRoot = await deps.realpath(root.dir);
  } catch {
    return { ok: false, reason: "missing", error: `File not found: ${path}` };
  }
  const rel = relative(realRoot, realCandidate);
  if (!isContainedRelative(rel)) {
    return {
      ok: false,
      reason: "outside",
      error: `Path is outside the managed ${root.name} folder`,
    };
  }
  return { ok: true, realPath: realCandidate, relPath: toPosixRel(rel) };
}

export function ownerOf(root: ManagedRoot, relPath: string): string {
  return root.fixedOwner ?? relPath.split("/")[0] ?? "";
}
