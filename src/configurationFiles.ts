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
// Search instruction file content
// ---------------------------------------------------------------------------

export interface MatchHit {
  layer: "default" | "custom";
  line: number;
  snippet: string;
}

export type WithMatches<T> = T & { matches: MatchHit[] };

export interface SearchTopicEntry {
  topic: string;
  files: WithMatches<FileEntry>[];
}

export interface SearchRoleEntry {
  role: string;
  files: WithMatches<FileEntry>[];
  topics: SearchTopicEntry[];
}

export interface SearchRepoEntry {
  repo: string;
  files: WithMatches<RepoFileEntry>[];
}

export interface InstructionFileSearchResult {
  summary: { query: string; files: number; hits: number };
  roles: SearchRoleEntry[];
  preAnalysis: WithMatches<FileEntry>[];
  repos: SearchRepoEntry[];
}

const SNIPPET_MAX_LENGTH = 200;

function scanLayer(
  content: string | null,
  layer: "default" | "custom",
  needle: string,
): MatchHit[] {
  if (content === null) return [];
  const hits: MatchHit[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      const trimmed = lines[i].trim();
      const snippet =
        trimmed.length > SNIPPET_MAX_LENGTH ? `${trimmed.slice(0, SNIPPET_MAX_LENGTH)}…` : trimmed;
      hits.push({ layer, line: i + 1, snippet });
    }
  }
  return hits;
}

function searchSingleFile(path: string, needle: string): MatchHit[] {
  const { default_content, custom_content } = readInstructionFile(path);
  return [
    ...scanLayer(default_content, "default", needle),
    ...scanLayer(custom_content, "custom", needle),
  ];
}

/**
 * Case-insensitive substring search across the content of every instruction file
 * surfaced by `listInstructionFiles()`. Both the default and custom layers are
 * scanned independently; each file is annotated with its hits and files with no
 * hits are dropped, leaving the same listing shape filtered to matches plus a
 * top-level `summary`. Paths are reconstructed from the trusted listing and read
 * through `readInstructionFile`, so no new file-path input surface is introduced.
 */
export function searchInstructionFiles(query: string): InstructionFileSearchResult {
  const needle = query.toLowerCase();
  const listing = listInstructionFiles();
  let fileCount = 0;
  let hitCount = 0;

  function annotate<T extends { file: string }>(
    files: T[],
    toPath: (file: string) => string,
  ): WithMatches<T>[] {
    const out: WithMatches<T>[] = [];
    for (const entry of files) {
      const matches = searchSingleFile(toPath(entry.file), needle);
      if (matches.length > 0) {
        out.push({ ...entry, matches });
        fileCount++;
        hitCount += matches.length;
      }
    }
    return out;
  }

  const roles: SearchRoleEntry[] = [];
  for (const role of listing.roles) {
    const files = annotate(role.files, (f) => `${role.role}/${f}`);
    const topics: SearchTopicEntry[] = [];
    for (const topic of role.topics) {
      const topicFiles = annotate(topic.files, (f) => `${role.role}/topics/${topic.topic}/${f}`);
      if (topicFiles.length > 0) topics.push({ topic: topic.topic, files: topicFiles });
    }
    if (files.length > 0 || topics.length > 0) roles.push({ role: role.role, files, topics });
  }

  const preAnalysis = annotate(listing.preAnalysis, (f) => `pre-analysis/${f}`);

  const repos: SearchRepoEntry[] = [];
  for (const repo of listing.repos) {
    const files = annotate(repo.files, (f) => `${repo.repo}/${f}`);
    if (files.length > 0) repos.push({ repo: repo.repo, files });
  }

  return {
    summary: { query, files: fileCount, hits: hitCount },
    roles,
    preAnalysis,
    repos,
  };
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
