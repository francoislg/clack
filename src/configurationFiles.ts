import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getConfig, getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";

/** Static role-based instruction filenames */
const ROLE_INSTRUCTION_FILES = [
  "instructions.md",
  "dev_instructions.md",
  "admin_instructions.md",
  "user_instructions.md",
];

export interface InstructionFileInfo {
  filename: string;
  hasOverride: boolean;
  hasDefault: boolean;
}

/**
 * Generate repo-scoped instruction filenames from configured repositories.
 */
function getRepoInstructionFiles(): string[] {
  try {
    const config = getConfig();
    const files: string[] = [];
    for (const repo of config.repositories) {
      files.push(`${repo.name}/changes_instructions.md`);
      files.push(`${repo.name}/worktree_setup_instructions.md`);
    }
    return files;
  } catch {
    // Config may not be loaded yet (e.g., during startup validation)
    return [];
  }
}

/**
 * List all convention-based instruction files with their override status.
 * Includes static role files and dynamically generated repo-specific files.
 */
export function listInstructionFiles(): InstructionFileInfo[] {
  const configDir = getConfigurationDir();
  const defaultDir = getDefaultConfigurationDir();

  const allFiles = [...ROLE_INSTRUCTION_FILES, ...getRepoInstructionFiles()];

  return allFiles.map((filename) => ({
    filename,
    hasOverride: existsSync(resolve(configDir, filename)),
    hasDefault: existsSync(resolve(defaultDir, filename)),
  }));
}

/**
 * Read an instruction file. Returns the override if it exists,
 * otherwise falls back to the default. Returns null if neither exists.
 */
export function readInstructionFile(filename: string): string | null {
  const configDir = getConfigurationDir();
  const overridePath = resolve(configDir, filename);

  if (existsSync(overridePath)) {
    return readFileSync(overridePath, "utf-8");
  }

  const defaultDir = getDefaultConfigurationDir();
  const defaultPath = resolve(defaultDir, filename);

  if (existsSync(defaultPath)) {
    return readFileSync(defaultPath, "utf-8");
  }

  return null;
}

/**
 * Write an instruction file to the configuration directory.
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
