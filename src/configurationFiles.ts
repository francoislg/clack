import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getConfig, getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";
import {
  listRoleDirFiles,
  listSingleDirFiles,
  readRoleFile,
  scanMdFiles,
  type RoleDirListing,
  type InstructionFileEntry,
} from "./cascadingConfigResolver.js";

export type { RoleDirListing, InstructionFileEntry };

// ---------------------------------------------------------------------------
// Repo instruction files (unchanged — flat, not cascaded)
// ---------------------------------------------------------------------------

export interface RepoInstructionFileInfo {
  filename: string;
  hasOverride: boolean;
  hasDefault: boolean;
}

function getRepoInstructionFiles(): RepoInstructionFileInfo[] {
  try {
    const config = getConfig();
    const configDir = getConfigurationDir();
    const defaultDir = getDefaultConfigurationDir();
    const files: RepoInstructionFileInfo[] = [];

    for (const repo of config.repositories) {
      for (const suffix of ["changes_instructions.md", "worktree_setup_instructions.md"]) {
        const filename = `${repo.name}/${suffix}`;
        files.push({
          filename,
          hasOverride: existsSync(resolve(configDir, filename)),
          hasDefault: existsSync(resolve(defaultDir, filename)),
        });
      }
    }
    return files;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// List all instruction files (role directories + repo files)
// ---------------------------------------------------------------------------

export interface InstructionFileListing {
  roles: RoleDirListing[];
  repos: RepoInstructionFileInfo[];
}

/**
 * List all instruction files: role-based (scanned from directories),
 * pre-analysis context, and repo-scoped (convention-based).
 */
export function listInstructionFiles(): InstructionFileListing {
  const roles = listRoleDirFiles();

  // Include pre-analysis as a pseudo-role directory (reuses same UI infrastructure).
  // Always included so admins can create the first file from the picker.
  roles.push({ role: "pre-analysis", files: listSingleDirFiles("pre-analysis") });

  return {
    roles,
    repos: getRepoInstructionFiles(),
  };
}

// ---------------------------------------------------------------------------
// Read instruction file (returns both default and custom content)
// ---------------------------------------------------------------------------

/**
 * Read an instruction file from a role directory.
 * Accepts paths like "user/identity.md" or "dev/changes.md".
 * Returns both default and custom content for comparison.
 *
 * For repo-scoped files (e.g., "myrepo/changes_instructions.md"),
 * uses the flat two-tier resolution.
 */
export function readInstructionFile(filepath: string): {
  default_content: string | null;
  custom_content: string | null;
} {
  const parts = filepath.split("/");
  if (parts.length !== 2) {
    return { default_content: null, custom_content: null };
  }

  const [dir, filename] = parts;
  return readRoleFile(dir, filename);
}

// ---------------------------------------------------------------------------
// Write instruction file
// ---------------------------------------------------------------------------

/**
 * Write an instruction file to the configuration directory.
 * Accepts paths like "user/identity.md" or "dev/changes.md".
 * Creates the directory if it doesn't exist.
 * Validates the path to prevent traversal attacks.
 */
export function writeInstructionFile(filename: string, content: string): void {
  const configDir = getConfigurationDir();
  const targetPath = resolve(configDir, filename);

  // Path safety: ensure resolved path is inside configuration directory
  if (!targetPath.startsWith(configDir + sep) && targetPath !== configDir) {
    logger.warn(`Path traversal attempt blocked: ${filename}`);
    throw new Error("Invalid filename: path traversal not allowed");
  }

  // Create parent directories if they don't exist
  const parentDir = resolve(targetPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(targetPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Delete instruction file
// ---------------------------------------------------------------------------

/**
 * Delete an instruction file from the configuration directory.
 * Accepts paths like "user/identity.md" or "dev/custom-rule.md".
 * Validates the path to prevent traversal attacks.
 * Throws if the file doesn't exist.
 */
export function deleteInstructionFile(filepath: string): void {
  const configDir = getConfigurationDir();
  const targetPath = resolve(configDir, filepath);

  // Path safety: ensure resolved path is inside configuration directory
  if (!targetPath.startsWith(configDir + sep) && targetPath !== configDir) {
    logger.warn(`Path traversal attempt blocked: ${filepath}`);
    throw new Error("Invalid filename: path traversal not allowed");
  }

  if (!existsSync(targetPath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  unlinkSync(targetPath);
}

// ---------------------------------------------------------------------------
// Effective content length
// ---------------------------------------------------------------------------

/**
 * Compute the effective content length for an instruction file.
 * Returns the length of the custom override if it exists, otherwise the default content length.
 * Returns 0 if neither exists.
 */
export function getEffectiveContentLength(filepath: string): number {
  const { default_content, custom_content } = readInstructionFile(filepath);
  const effective = custom_content ?? default_content;
  return effective?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Pre-analysis shared context
// ---------------------------------------------------------------------------

/**
 * Load and concatenate all pre-analysis context files.
 * Resolves through the two-tier system (default_configuration → configuration).
 * Returns empty string if no files exist.
 */
export function loadPreAnalysisContext(): string {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const defaultFiles = new Set(scanMdFiles(resolve(defaultDir, "pre-analysis")));
  const customFiles = new Set(scanMdFiles(resolve(configDir, "pre-analysis")));
  const allFilenames = new Set([...defaultFiles, ...customFiles]);

  if (allFilenames.size === 0) return "";

  const resolved: Array<{ filename: string; content: string }> = [];

  for (const filename of allFilenames) {
    let content: string | null = null;

    const defaultPath = resolve(defaultDir, "pre-analysis", filename);
    if (existsSync(defaultPath)) {
      content = readFileSync(defaultPath, "utf-8");
    }

    const customPath = resolve(configDir, "pre-analysis", filename);
    if (existsSync(customPath)) {
      content = readFileSync(customPath, "utf-8");
    }

    if (content !== null && content.trim().length > 0) {
      resolved.push({ filename, content });
    }
  }

  resolved.sort((a, b) => a.filename.localeCompare(b.filename));
  return resolved.map((r) => r.content).join("\n\n");
}
