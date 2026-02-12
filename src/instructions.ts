import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";
import type { UserRole } from "./roles.js";

// Convention-based instruction filenames
const BASE_FILE = "instructions.md";
const ROLE_FILES: Record<string, string> = {
  dev: "dev_instructions.md",
  admin: "admin_instructions.md",
  user: "user_instructions.md",
};

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
 * Determine which role file to load based on the user's role and changesWorkflow state.
 *
 * - dev/admin/owner with changesWorkflow enabled → admin_instructions.md (admin/owner) or dev_instructions.md (dev)
 *   - admin_instructions.md falls back to dev_instructions.md if not found
 * - everyone else → user_instructions.md
 */
function getRoleFilename(role: UserRole, changesWorkflowEnabled: boolean): string | null {
  if (changesWorkflowEnabled && (role === "admin" || role === "owner")) {
    // Try admin first, fall back to dev
    if (resolveInstructionFile(ROLE_FILES.admin)) {
      return ROLE_FILES.admin;
    }
    return ROLE_FILES.dev;
  }

  if (changesWorkflowEnabled && role === "dev") {
    return ROLE_FILES.dev;
  }

  // Everyone else (member, or dev/admin/owner without changesWorkflow)
  return ROLE_FILES.user;
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
 * Loads the base instructions + role-specific overlay, then interpolates variables.
 */
export function loadInstructions(role: UserRole, options: LoadInstructionsOptions): string {
  // Load base instructions (required)
  const basePath = resolveInstructionFile(BASE_FILE);
  if (!basePath) {
    throw new Error(
      `Base instructions file '${BASE_FILE}' not found in either data/configuration/ or data/default_configuration/. ` +
      `Ensure the default_configuration directory is present.`
    );
  }

  let content = readFileSync(basePath, "utf-8");

  // Load role overlay (optional)
  const roleFilename = getRoleFilename(role, options.changesWorkflowEnabled);
  if (roleFilename) {
    const rolePath = resolveInstructionFile(roleFilename);
    if (rolePath) {
      const roleContent = readFileSync(rolePath, "utf-8");
      content += "\n" + roleContent;
    } else {
      logger.debug(`Role instruction file '${roleFilename}' not found, skipping overlay`);
    }
  }

  // Interpolate variables after concatenation
  content = interpolateVariables(content, options.variables);

  return content;
}

/**
 * Validate that the base instructions file can be resolved.
 * Call this on startup to fail fast if the file is missing.
 */
export function validateInstructionFiles(): void {
  const basePath = resolveInstructionFile(BASE_FILE);
  if (!basePath) {
    throw new Error(
      `Required instruction file '${BASE_FILE}' not found in either data/configuration/ or data/default_configuration/. ` +
      `Ensure the default_configuration directory is present with at least instructions.md.`
    );
  }
  logger.debug(`Base instructions resolved from: ${basePath}`);
}
