import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getConfig, getConfigurationDir, getDefaultConfigurationDir } from "./config.js";
import { logger } from "./logger.js";
import { interpolateVariables } from "./instructions.js";
import { REPO_INSTRUCTION_FILES } from "./repoInstructionFiles.js";
import {
  listRoleDirFiles,
  listRoleTopicDirFiles,
  listSingleDirFiles,
  readRoleFile,
  readRoleTopicFile,
  scanMdFiles,
  type RoleDirListing,
  type InstructionFileEntry,
} from "./cascadingConfigResolver.js";

export type { RoleDirListing, InstructionFileEntry };

// ---------------------------------------------------------------------------
// Semantic file entry — the building block surfaced by the new listing shape
// ---------------------------------------------------------------------------

export interface FileEntry {
  file: string;
  status: "default" | "customized" | "custom-only" | "plugin" | "plugin-customized";
}

// ---------------------------------------------------------------------------
// Repo instruction files
// ---------------------------------------------------------------------------

export interface RepoEntry {
  repo: string;
  files: RepoFileEntry[];
}

export interface RepoFileEntry {
  file: string;
  status: "default" | "customized" | "custom-only" | "not_created";
}

function getRepoEntries(): RepoEntry[] {
  try {
    const config = getConfig();
    const configDir = getConfigurationDir();
    const defaultDir = getDefaultConfigurationDir();
    const repos: RepoEntry[] = [];

    for (const repo of config.repositories) {
      const files: RepoFileEntry[] = [];
      for (const suffix of REPO_INSTRUCTION_FILES) {
        const fullPath = `${repo.name}/${suffix}`;
        const hasOverride = existsSync(resolve(configDir, fullPath));
        const hasDefault = existsSync(resolve(defaultDir, fullPath));
        const status: RepoFileEntry["status"] = hasOverride
          ? hasDefault
            ? "customized"
            : "custom-only"
          : hasDefault
            ? "default"
            : "not_created";
        files.push({ file: suffix, status });
      }
      repos.push({ repo: repo.name, files });
    }
    return repos;
  } catch {
    return [];
  }
}

/** Names of all configured repositories, for validating repo-scoped config targets. */
export function getConfiguredRepoNames(): string[] {
  try {
    return getConfig().repositories.map((r) => r.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// List all instruction files (role directories + topics + repo files)
// ---------------------------------------------------------------------------

export interface RoleEntry {
  role: string;
  files: FileEntry[];
  topics: TopicEntry[];
}

export interface TopicEntry {
  topic: string;
  files: FileEntry[];
}

export interface InstructionFileListing {
  roles: RoleEntry[];
  preAnalysis: FileEntry[];
  repos: RepoEntry[];
}

function toFileEntries(entries: InstructionFileEntry[]): FileEntry[] {
  return entries.map((e) => ({ file: e.filename, status: e.source }));
}

/**
 * List all instruction files: role-based (scanned from directories), pre-analysis
 * context, and repo-scoped (convention-based). Topic files (`{role}/topics/{topic}/*.md`)
 * are surfaced under the corresponding role's `topics` array.
 *
 * Roles with neither baseline files nor topic files are omitted (matches the existing
 * `listRoleDirFiles` behavior of skipping empty role directories).
 */
export function listInstructionFiles(): InstructionFileListing {
  const baselineByRole = new Map<string, RoleDirListing>();
  for (const listing of listRoleDirFiles()) {
    baselineByRole.set(listing.role, listing);
  }

  const topicsByRole = new Map<string, TopicEntry[]>();
  for (const topicListing of listRoleTopicDirFiles()) {
    const arr = topicsByRole.get(topicListing.role) ?? [];
    arr.push({
      topic: topicListing.topic,
      files: toFileEntries(topicListing.files),
    });
    topicsByRole.set(topicListing.role, arr);
  }

  const allRoleNames = new Set<string>([...baselineByRole.keys(), ...topicsByRole.keys()]);
  const roles: RoleEntry[] = [];
  for (const role of allRoleNames) {
    const baseline = baselineByRole.get(role);
    const topics = topicsByRole.get(role) ?? [];
    roles.push({
      role,
      files: baseline ? toFileEntries(baseline.files) : [],
      topics,
    });
  }

  return {
    roles,
    preAnalysis: toFileEntries(listSingleDirFiles("pre-analysis")),
    repos: getRepoEntries(),
  };
}

// ---------------------------------------------------------------------------
// Read instruction file (returns both default and custom content)
// ---------------------------------------------------------------------------

/**
 * Read an instruction file. Accepts:
 *   - 2-segment baseline paths: `{role}/{filename}` (e.g., `"user/identity.md"`)
 *   - 4-segment topic paths:    `{role}/topics/{topic}/{filename}`
 *   - 2-segment repo paths:     `{repo}/{filename}` (resolved via `readRoleFile`,
 *     which falls back to the flat two-tier resolution for non-role directories)
 *
 * Returns both default and custom content for comparison. Anything outside the
 * accepted shapes returns null/null without throwing.
 */
export function readInstructionFile(filepath: string): {
  default_content: string | null;
  custom_content: string | null;
} {
  const parts = filepath.split("/");

  if (parts.length === 2 && parts[0] && parts[1]) {
    return readRoleFile(parts[0], parts[1]);
  }

  if (parts.length === 4 && parts[0] && parts[1] === "topics" && parts[2] && parts[3]) {
    return readRoleTopicFile(parts[0], parts[2], parts[3]);
  }

  return { default_content: null, custom_content: null };
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
  const raw = resolved.map((r) => r.content).join("\n\n");

  const config = getConfig();
  return interpolateVariables(raw, {
    BOT_NAME: config.slackApp?.name || "Clack",
  });
}
