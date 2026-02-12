import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";

/** Convention-based instruction filenames */
const INSTRUCTION_FILES = [
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
 * List all convention-based instruction files with their override status.
 */
export function listInstructionFiles(): InstructionFileInfo[] {
  const configDir = getConfigurationDir();
  const defaultDir = getDefaultConfigurationDir();

  return INSTRUCTION_FILES.map((filename) => ({
    filename,
    hasOverride: existsSync(resolve(configDir, filename)),
    hasDefault: existsSync(resolve(defaultDir, filename)),
  }));
}

/**
 * Read an instruction file. Returns the override if it exists,
 * otherwise falls back to the default.
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
  if (!targetPath.startsWith(configDir + "/") && targetPath !== configDir) {
    logger.warn(`Path traversal attempt blocked: ${filename}`);
    throw new Error("Invalid filename: path traversal not allowed");
  }

  // Create configuration directory if it doesn't exist
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(targetPath, content, "utf-8");
}
