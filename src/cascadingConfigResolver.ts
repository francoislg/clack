import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import type { UserRole } from "./roles.js";
import { canEditConfig, canRequestChanges } from "./permissions.js";

/** Known role directory names in cascade order (lowest to highest) */
const ALL_ROLE_DIRS = ["user", "dev", "admin", "owner"] as const;
export type RoleDir = (typeof ALL_ROLE_DIRS)[number];

/**
 * Build the role chain based on user role and changesWorkflow state.
 *
 * - Dev layer is only included when changesWorkflow is enabled AND role is dev+
 * - Admin layer always applies for admin+ users (config management powers)
 * - Owner layer applies for owner
 */
export function buildRoleChain(role: UserRole, changesWorkflowEnabled: boolean): RoleDir[] {
  const chain: RoleDir[] = ["user"];

  if (changesWorkflowEnabled && canRequestChanges(role)) {
    chain.push("dev");
  }

  if (canEditConfig(role)) {
    chain.push("admin");
  }

  if (role === "owner") {
    chain.push("owner");
  }

  return chain;
}

/**
 * Scan a directory for .md files. Returns filenames (not full paths).
 * Returns empty array if the directory does not exist.
 */
export function scanMdFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Resolve all instruction files through the cascading role chain.
 *
 * For each unique filename found across all role directories,
 * resolution checks in this order (last existing file wins):
 *   default/{role1}/{file} → custom/{role1}/{file} → default/{role2}/{file} → ...
 *
 * Empty files (whitespace-only) suppress the instruction.
 * Results are concatenated in alphabetical order by filename.
 */
/** Virtual default files contributed by plugins: role → filename → content */
export type VirtualDefaults = Map<string, Map<string, string>>;

export function resolveInstructions(
  roleChain: RoleDir[],
  virtualDefaults?: VirtualDefaults,
): string {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  // 1. Discover all unique filenames across disk directories and virtual defaults
  const allFilenames = new Set<string>();
  for (const role of roleChain) {
    for (const filename of scanMdFiles(resolve(defaultDir, role))) {
      allFilenames.add(filename);
    }
    // Include virtual default filenames from plugins
    const virtualForRole = virtualDefaults?.get(role);
    if (virtualForRole) {
      for (const filename of virtualForRole.keys()) {
        allFilenames.add(filename);
      }
    }
    for (const filename of scanMdFiles(resolve(configDir, role))) {
      allFilenames.add(filename);
    }
  }

  // 2. For each filename, resolve through the interleaved cascade
  //    Order per role: disk default → plugin virtual default → disk custom
  const resolvedContents: Array<{ filename: string; content: string }> = [];

  for (const filename of allFilenames) {
    let resolvedContent: string | null = null;

    for (const role of roleChain) {
      // Disk default first
      const defaultPath = resolve(defaultDir, role, filename);
      if (existsSync(defaultPath)) {
        resolvedContent = readFileSync(defaultPath, "utf-8");
      }

      // Plugin virtual default (between disk default and disk custom)
      const virtualContent = virtualDefaults?.get(role)?.get(filename);
      if (virtualContent !== undefined) {
        resolvedContent = virtualContent;
      }

      // Disk custom override wins
      const customPath = resolve(configDir, role, filename);
      if (existsSync(customPath)) {
        resolvedContent = readFileSync(customPath, "utf-8");
      }
    }

    // Empty/whitespace-only files suppress the instruction
    if (resolvedContent !== null && resolvedContent.trim().length > 0) {
      resolvedContents.push({ filename, content: resolvedContent });
    }
  }

  // 3. Sort alphabetically by filename and concatenate
  resolvedContents.sort((a, b) => a.filename.localeCompare(b.filename));
  return resolvedContents.map((r) => r.content).join("\n\n");
}

/**
 * Validate that at least one instruction file exists in the user/ directory.
 * Call on startup to fail fast.
 */
export function validateInstructionDirs(): void {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const defaultUserFiles = scanMdFiles(resolve(defaultDir, "user"));
  const customUserFiles = scanMdFiles(resolve(configDir, "user"));

  if (defaultUserFiles.length === 0 && customUserFiles.length === 0) {
    throw new Error(
      "No instruction files found in user/ directory of either data/configuration/ or data/default_configuration/. " +
        "Ensure the default_configuration/user/ directory is present with at least one .md file.",
    );
  }
}

/**
 * List all role directories and their files for inspection (used by MCP tools and Home Tab).
 * Returns files grouped by role directory with source status.
 */
export interface InstructionFileEntry {
  filename: string;
  source: "default" | "customized" | "custom-only" | "plugin" | "plugin-customized";
}

export interface RoleDirListing {
  role: string;
  files: InstructionFileEntry[];
}

export function listRoleDirFiles(virtualDefaults?: VirtualDefaults): RoleDirListing[] {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const result: RoleDirListing[] = [];

  for (const role of ALL_ROLE_DIRS) {
    const defaultFiles = new Set(scanMdFiles(resolve(defaultDir, role)));
    const customFiles = new Set(scanMdFiles(resolve(configDir, role)));
    const virtualFiles = virtualDefaults?.get(role) ?? new Map<string, string>();

    // Union of all filenames
    const allFiles = new Set([...defaultFiles, ...customFiles, ...virtualFiles.keys()]);
    if (allFiles.size === 0) continue;

    const files: InstructionFileEntry[] = [];
    for (const filename of [...allFiles].sort()) {
      const hasDefault = defaultFiles.has(filename);
      const hasCustom = customFiles.has(filename);
      const hasVirtual = virtualFiles.has(filename);

      if (hasVirtual && hasCustom) {
        files.push({ filename, source: "plugin-customized" });
      } else if (hasVirtual) {
        files.push({ filename, source: "plugin" });
      } else if (hasCustom && hasDefault) {
        files.push({ filename, source: "customized" });
      } else if (hasCustom) {
        files.push({ filename, source: "custom-only" });
      } else {
        files.push({ filename, source: "default" });
      }
    }

    result.push({ role, files });
  }

  return result;
}

/**
 * List files in a single directory pair (default + custom).
 * Works for any directory name — not tied to role semantics.
 */
export function listSingleDirFiles(dir: string): InstructionFileEntry[] {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const defaultFiles = new Set(scanMdFiles(resolve(defaultDir, dir)));
  const customFiles = new Set(scanMdFiles(resolve(configDir, dir)));

  const allFiles = new Set([...defaultFiles, ...customFiles]);
  if (allFiles.size === 0) return [];

  const files: InstructionFileEntry[] = [];
  for (const filename of [...allFiles].sort()) {
    const hasDefault = defaultFiles.has(filename);
    const hasCustom = customFiles.has(filename);

    if (hasCustom && hasDefault) {
      files.push({ filename, source: "customized" });
    } else if (hasCustom) {
      files.push({ filename, source: "custom-only" });
    } else {
      files.push({ filename, source: "default" });
    }
  }

  return files;
}

/**
 * Read a specific instruction file from a role directory.
 * Returns both default and custom content for comparison.
 */
export function readRoleFile(
  role: string,
  filename: string,
): {
  default_content: string | null;
  custom_content: string | null;
} {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const defaultPath = resolve(defaultDir, role, filename);
  const customPath = resolve(configDir, role, filename);

  return {
    default_content: existsSync(defaultPath) ? readFileSync(defaultPath, "utf-8") : null,
    custom_content: existsSync(customPath) ? readFileSync(customPath, "utf-8") : null,
  };
}
