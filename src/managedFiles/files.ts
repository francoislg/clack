import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getConfig, type ManagedRootName } from "../config.js";
import { fileExists } from "../fs.js";
import { logger } from "../logger.js";
import { loadLedger, updateLedger, type FileLedgerEntry } from "./ledger.js";
import {
  findRoot,
  getManagedRoots,
  isSafeSegment,
  ownerOf,
  resolveInRoot,
  SYSTEM_OWNER,
  type ManagedRoot,
} from "./roots.js";

export interface FilesDeps {
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  writeFile: (path: string, data: string | Buffer) => Promise<void>;
  stat: (path: string) => Promise<{ mtime: Date }>;
  exists: (path: string) => Promise<boolean>;
  now: () => Date;
  getRoots: () => ManagedRoot[];
  loadLedger: () => Promise<FileLedgerEntry[]>;
  updateLedger: (mutate: (entries: FileLedgerEntry[]) => FileLedgerEntry[]) => Promise<void>;
  realpath: (p: string) => Promise<string>;
}

export const defaultFilesDeps: FilesDeps = {
  mkdir: (path, opts) => mkdir(path, opts),
  writeFile: (path, data) => writeFile(path, data),
  stat: (path) => stat(path),
  exists: (path) => fileExists(path),
  now: () => new Date(),
  getRoots: () => getManagedRoots(getConfig()),
  loadLedger,
  updateLedger,
  realpath: (p) => realpath(p),
};

export function ownerFolder(root: ManagedRoot, owner: string): string {
  return join(root.dir, owner);
}

function requireRoot(name: ManagedRootName, deps: FilesDeps): ManagedRoot {
  const root = findRoot(deps.getRoots(), name);
  if (!root) {
    throw new Error(`Managed root '${name}' is not registered`);
  }
  return root;
}

function requireSafeOwner(owner: string): void {
  if (!isSafeSegment(owner)) {
    throw new Error(`Invalid managed file owner: ${owner}`);
  }
}

function requireSafeName(name: string): string {
  const base = basename(name);
  if (!isSafeSegment(base)) {
    throw new Error(`Invalid managed file name: ${name}`);
  }
  return base;
}

export async function ensureOwnerFolder(
  root: ManagedRootName,
  owner: string,
  deps: FilesDeps = defaultFilesDeps,
): Promise<string> {
  requireSafeOwner(owner);
  const folder = ownerFolder(requireRoot(root, deps), owner);
  await deps.mkdir(folder, { recursive: true });
  return folder;
}

/** The downloads folder for loads outside any session (boot diagnose, MCP tests, baseline smoke). */
export function ensureSystemDownloadsDir(deps: FilesDeps = defaultFilesDeps): Promise<string> {
  return ensureOwnerFolder("downloads", SYSTEM_OWNER, deps);
}

async function pickFreeName(folder: string, name: string, deps: FilesDeps): Promise<string> {
  if (!(await deps.exists(join(folder, name)))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!(await deps.exists(join(folder, candidate)))) return candidate;
  }
}

function sameEntry(entry: FileLedgerEntry, root: ManagedRootName, relPath: string): boolean {
  return entry.root === root && entry.path === relPath;
}

async function recordEntry(entry: FileLedgerEntry, deps: FilesDeps): Promise<void> {
  await deps.updateLedger((entries) => [
    ...entries.filter((e) => !sameEntry(e, entry.root, entry.path)),
    entry,
  ]);
}

async function prepareTarget(
  opts: { root: ManagedRootName; owner: string; name: string },
  deps: FilesDeps,
): Promise<{ absPath: string; relPath: string }> {
  requireSafeOwner(opts.owner);
  const safeName = requireSafeName(opts.name);
  const folder = await ensureOwnerFolder(opts.root, opts.owner, deps);
  const finalName = await pickFreeName(folder, safeName, deps);
  return { absPath: join(folder, finalName), relPath: `${opts.owner}/${finalName}` };
}

export async function createFile(
  opts: { root: ManagedRootName; owner: string; name: string; data: string | Buffer },
  deps: FilesDeps = defaultFilesDeps,
): Promise<string> {
  const { absPath, relPath } = await prepareTarget(opts, deps);
  await deps.writeFile(absPath, opts.data);
  await recordEntry(
    { root: opts.root, path: relPath, owner: opts.owner, createdAt: deps.now().toISOString() },
    deps,
  );
  return absPath;
}

export async function reservePath(
  opts: { root: ManagedRootName; owner: string; name: string },
  deps: FilesDeps = defaultFilesDeps,
): Promise<string> {
  const { absPath, relPath } = await prepareTarget(opts, deps);
  await recordEntry(
    { root: opts.root, path: relPath, owner: opts.owner, createdAt: deps.now().toISOString() },
    deps,
  );
  return absPath;
}

export async function resolveOwnedFile(
  opts: { owner: string; path: string },
  deps: FilesDeps = defaultFilesDeps,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const outsideError = "file_path must be inside this session's downloads folder";
  if (!isSafeSegment(opts.owner)) {
    return { ok: false, error: outsideError };
  }
  const folder = ownerFolder(requireRoot("downloads", deps), opts.owner);
  const resolved = await resolveInRoot({ name: "downloads", dir: folder }, opts.path, {
    realpath: deps.realpath,
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.reason === "outside" ? outsideError : resolved.error };
  }
  const realCandidate = resolved.realPath;
  const relPath = `${opts.owner}/${resolved.relPath}`;
  const entries = await deps.loadLedger();
  if (!entries.some((e) => sameEntry(e, "downloads", relPath))) {
    let mtime: Date;
    try {
      ({ mtime } = await deps.stat(realCandidate));
    } catch {
      return { ok: false, error: `File not found: ${opts.path}` };
    }
    const discovered: FileLedgerEntry = {
      root: "downloads",
      path: relPath,
      owner: opts.owner,
      createdAt: mtime.toISOString(),
    };
    await deps.updateLedger((current) =>
      current.some((e) => sameEntry(e, "downloads", relPath)) ? current : [...current, discovered],
    );
  }
  return { ok: true, path: realCandidate };
}

export interface UploadedFileInfo {
  fileId?: string;
  permalink?: string;
  channel?: string;
  threadTs?: string;
}

export async function markUploaded(
  absPath: string,
  info: UploadedFileInfo,
  deps: FilesDeps = defaultFilesDeps,
): Promise<void> {
  for (const root of deps.getRoots()) {
    const resolved = await resolveInRoot(root, absPath, { realpath: deps.realpath });
    if (!resolved.ok) continue;
    const { relPath, realPath } = resolved;
    const { mtime } = await deps.stat(realPath);
    const uploadedAt = deps.now().toISOString();
    await deps.updateLedger((entries) => {
      const existing = entries.find((e) => sameEntry(e, root.name, relPath));
      const base: FileLedgerEntry = existing ?? {
        root: root.name,
        path: relPath,
        owner: ownerOf(root, relPath),
        createdAt: mtime.toISOString(),
      };
      const updated: FileLedgerEntry = { ...base, ...info, uploadedAt };
      return [...entries.filter((e) => !sameEntry(e, root.name, relPath)), updated];
    });
    return;
  }
  logger.warn(`managed-files: uploaded file is not inside a managed root: ${absPath}`);
}
