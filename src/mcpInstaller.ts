import { execFileSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { errorMessage } from "./errors.js";
import { logger } from "./logger.js";
import {
  getPinnedEntries as defaultGetPinnedEntries,
  setPinnedSpawnConfig as defaultSetPinnedSpawnConfig,
  type PinnedEntry,
} from "./mcp.js";

export interface McpInstallerDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, options: BufferEncoding) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  execFileSync: (
    file: string,
    args: string[],
    opts: { stdio?: "pipe" | "ignore" | "inherit"; cwd?: string },
  ) => Buffer;
}

export const defaultMcpInstallerDeps: McpInstallerDeps = {
  existsSync,
  readFileSync,
  rmSync,
  execFileSync,
};

// Server names and npm package names flow into filesystem paths. Validate them
// against conservative shapes that match real npm conventions, so a malformed
// or malicious config entry can't traverse outside data/mcp_packages/.
const SERVER_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;
const NPM_PACKAGE_RE = /^(@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function assertSafeServerName(name: string): void {
  if (!SERVER_NAME_RE.test(name)) {
    throw new Error(
      `Invalid MCP server name '${name}' — only letters, digits, '_' and '-' are allowed`,
    );
  }
}

function assertSafePackageName(pkg: string): void {
  if (!NPM_PACKAGE_RE.test(pkg)) {
    throw new Error(`Invalid npm package name '${pkg}' — does not match npm naming rules`);
  }
}

function installDir(name: string): string {
  assertSafeServerName(name);
  return join(process.cwd(), "data", "mcp_packages", name);
}

function installedPackageJsonPath(dir: string, pkg: string): string {
  return join(dir, "node_modules", pkg, "package.json");
}

/**
 * Read the installed package's `version` field. Returns undefined when the
 * file is missing, unreadable, malformed, or has no `version` — all of which
 * are treated as a version mismatch by callers (forcing a reinstall).
 */
function readInstalledVersion(
  dir: string,
  pkg: string,
  deps: McpInstallerDeps,
): string | undefined {
  const path = installedPackageJsonPath(dir, pkg);
  if (!deps.existsSync(path)) return undefined;
  try {
    const raw = deps.readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strip the `@scope/` prefix from a scoped package name. Unscoped packages
 * pass through unchanged.
 */
export function unscopedName(pkg: string): string {
  if (!pkg.startsWith("@")) return pkg;
  const slash = pkg.indexOf("/");
  return slash === -1 ? pkg : pkg.slice(slash + 1);
}

/**
 * Resolve the binary path from the installed package's `package.json#bin`.
 *
 * `bin` shapes:
 *  - string                → use directly
 *  - object with match     → entry whose key equals the unscoped package name
 *  - object without match  → first entry (deterministic — uses Object.keys order)
 *  - missing/empty         → throws (caller marks the MCP failed)
 *
 * The returned path is absolute (resolved against the installed package directory).
 */
export function resolveBinPath(installRoot: string, pkg: string, deps: McpInstallerDeps): string {
  const pkgJsonPath = installedPackageJsonPath(installRoot, pkg);
  const raw = deps.readFileSync(pkgJsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  const bin = parsed.bin;

  let relativeBin: string;
  if (typeof bin === "string") {
    relativeBin = bin;
  } else if (bin && typeof bin === "object") {
    const keys = Object.keys(bin);
    if (keys.length === 0) {
      throw new Error(`Package '${pkg}' has an empty 'bin' object — no binary to spawn`);
    }
    const want = unscopedName(pkg);
    const matchKey = keys.includes(want) ? want : keys[0];
    relativeBin = bin[matchKey];
    if (typeof relativeBin !== "string") {
      throw new Error(`Package '${pkg}' bin entry for '${matchKey}' is not a string`);
    }
  } else {
    throw new Error(`Package '${pkg}' has no 'bin' field — cannot resolve a spawn target`);
  }

  return resolve(join(installRoot, "node_modules", pkg), relativeBin);
}

export interface EnsureInstalledResult {
  binPath: string;
}

/**
 * Ensure `<pkg>@<version>` is installed at `data/mcp_packages/<name>/` with
 * hoisting disabled. Reuses an existing install when its `package.json#version`
 * matches; otherwise wipes the directory and reinstalls. Returns the absolute
 * bin path to be passed to `node` as the spawn argument.
 */
export async function ensureInstalled(
  name: string,
  pkg: string,
  version: string,
  deps: McpInstallerDeps = defaultMcpInstallerDeps,
): Promise<EnsureInstalledResult> {
  assertSafePackageName(pkg);
  const dir = installDir(name);
  const installed = readInstalledVersion(dir, pkg, deps);

  if (installed === version) {
    logger.debug(`MCP install for '${name}' is up to date (${pkg}@${version}) — reusing`);
    return { binPath: resolveBinPath(dir, pkg, deps) };
  }

  if (deps.existsSync(dir)) {
    logger.info(
      `MCP install for '${name}': version drift (installed=${installed ?? "unknown"}, want=${version}) — reinstalling`,
    );
    deps.rmSync(dir, { recursive: true, force: true });
  } else {
    logger.info(`MCP install for '${name}': installing ${pkg}@${version}`);
  }

  // --install-strategy=nested disables hoisting, sidestepping npm 10's shadow-stub
  // bug for trees where multiple ancestors require the same transitive dep at
  // overlapping ranges (the failure mode that broke asana and sentry).
  // Use execFile (no shell) so package/version/dir are passed as argv — no shell
  // metacharacters or quoting concerns.
  try {
    deps.execFileSync(
      "npm",
      ["install", "--install-strategy=nested", "--prefix", dir, `${pkg}@${version}`],
      { stdio: "pipe" },
    );
  } catch (error) {
    // execFileSync with stdio:"pipe" attaches captured stderr to the thrown error.
    // Surface it in the message so operators see npm's actual diagnostic, not
    // just "Command failed: npm install ...".
    const stderr = (error as { stderr?: Buffer | string } | null)?.stderr;
    const detail = stderr ? Buffer.from(stderr).toString().trim() : errorMessage(error);
    throw new Error(`npm install ${pkg}@${version} failed: ${detail}`);
  }

  return { binPath: resolveBinPath(dir, pkg, deps) };
}

export interface InstallAllDeps {
  ensureInstalled: typeof ensureInstalled;
  getPinnedEntries: () => Record<string, PinnedEntry>;
  setPinnedSpawnConfig: typeof defaultSetPinnedSpawnConfig;
}

export const defaultInstallAllDeps: InstallAllDeps = {
  ensureInstalled,
  getPinnedEntries: defaultGetPinnedEntries,
  setPinnedSpawnConfig: defaultSetPinnedSpawnConfig,
};

/**
 * Install every pinned entry declared in `data/mcp.json` and register the
 * resolved spawn configs. Returns the names of entries that failed — callers
 * should add them to the failed-MCP set so the Home tab reflects reality.
 */
export async function installAllPinnedMcpServers(
  deps: InstallAllDeps = defaultInstallAllDeps,
): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const [name, entry] of Object.entries(deps.getPinnedEntries())) {
    try {
      const { binPath } = await deps.ensureInstalled(name, entry.package, entry.version);
      deps.setPinnedSpawnConfig(name, {
        type: "stdio",
        command: "node",
        args: [binPath, ...(entry.args ?? [])],
        env: entry.env,
      });
      logger.info(`MCP install ready: ${name} (${entry.package}@${entry.version})`);
    } catch (error) {
      logger.warn(
        `MCP install failed for '${name}' (${entry.package}@${entry.version}): ${errorMessage(error)}`,
      );
      failed.push(name);
    }
  }
  return { failed };
}
