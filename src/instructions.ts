import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";
import type { UserRole } from "./roles.js";
import { buildRoleChain, resolveInstructions, validateInstructionDirs } from "./cascadingConfigResolver.js";

export interface LoadInstructionsOptions {
  /** Whether changesWorkflow is enabled for this trigger */
  changesWorkflowEnabled: boolean;
  /** Variables to interpolate into the instructions */
  variables: Record<string, string>;
}

/**
 * Resolve an instruction file through the two-tier chain:
 * 1. data/configuration/{filename}  (editable override)
 * 2. data/default_configuration/{filename}  (shipped default)
 *
 * Returns the resolved file path, or null if not found in either tier.
 * Used for per-repo instruction files which are NOT part of the cascading system.
 */
export function resolveInstructionFile(filename: string): string | null {
  const configPath = resolve(getConfigurationDir(), filename);
  if (existsSync(configPath)) {
    return configPath;
  }

  const defaultPath = resolve(getDefaultConfigurationDir(), filename);
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

/**
 * Replace {VARIABLE_NAME} placeholders in content with their values.
 * Unknown variables are replaced with empty string.
 */
export function interpolateVariables(content: string, variables: Record<string, string>): string {
  return content.replace(/\{(\w+)\}/g, (_match, key) => variables[key] ?? "");
}

/**
 * Load and compose the system prompt from instruction files.
 * Uses the CascadingConfigResolver to resolve role-based instruction files,
 * then interpolates variables.
 */
export function loadInstructions(role: UserRole, options: LoadInstructionsOptions): string {
  const roleChain = buildRoleChain(role, options.changesWorkflowEnabled);
  logger.debug(`Loading instructions for role '${role}' with chain: [${roleChain.join(", ")}]`);

  let content = resolveInstructions(roleChain);

  // Interpolate variables after concatenation
  content = interpolateVariables(content, options.variables);

  return content;
}

/**
 * Validate that instruction files can be resolved.
 * Call this on startup to fail fast if the files are missing.
 */
export function validateInstructionFiles(): void {
  validateInstructionDirs();
  logger.debug("Instruction directories validated successfully");
}
