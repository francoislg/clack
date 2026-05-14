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
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."),
      )
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
  activeTopics?: Set<string>,
  virtualDefaults?: VirtualDefaults,
): string {
  const baseline = resolveBaselineFiles(roleChain, virtualDefaults);

  if (!activeTopics || activeTopics.size === 0) {
    return baseline;
  }

  const sections: string[] = [];
  if (baseline.length > 0) sections.push(baseline);

  // Topics appear after baseline, alphabetically by topic name, each under a header.
  for (const topic of [...activeTopics].sort()) {
    const content = resolveTopicFiles(roleChain, topic, virtualDefaults);
    if (content.length > 0) {
      sections.push(`=== TOPIC: ${topic} ===\n\n${content}`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Baseline cascade resolution: walks `{role}/*.md` (not `topics/`) across the role chain,
 * applying default → virtual → custom per-file. Identical to the pre-topic-support
 * behavior when `activeTopics` is empty.
 */
function resolveBaselineFiles(roleChain: RoleDir[], virtualDefaults?: VirtualDefaults): string {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  // 1. Discover all unique baseline filenames across disk dirs and virtual defaults.
  //    Virtual-default keys starting with "topics/" are topic files — skip them here.
  const allFilenames = new Set<string>();
  for (const role of roleChain) {
    for (const filename of scanMdFiles(resolve(defaultDir, role))) {
      allFilenames.add(filename);
    }
    const virtualForRole = virtualDefaults?.get(role);
    if (virtualForRole) {
      for (const filename of virtualForRole.keys()) {
        if (!filename.startsWith("topics/")) {
          allFilenames.add(filename);
        }
      }
    }
    for (const filename of scanMdFiles(resolve(configDir, role))) {
      allFilenames.add(filename);
    }
  }

  // 2. For each filename, resolve through the interleaved cascade.
  //    Order per role: disk default → plugin virtual default → disk custom
  const resolvedContents: Array<{ filename: string; content: string }> = [];

  for (const filename of allFilenames) {
    let resolvedContent: string | null = null;

    for (const role of roleChain) {
      const defaultPath = resolve(defaultDir, role, filename);
      if (existsSync(defaultPath)) {
        resolvedContent = readFileSync(defaultPath, "utf-8");
      }

      const virtualContent = virtualDefaults?.get(role)?.get(filename);
      if (virtualContent !== undefined) {
        resolvedContent = virtualContent;
      }

      const customPath = resolve(configDir, role, filename);
      if (existsSync(customPath)) {
        resolvedContent = readFileSync(customPath, "utf-8");
      }
    }

    if (resolvedContent !== null && resolvedContent.trim().length > 0) {
      resolvedContents.push({ filename, content: resolvedContent });
    }
  }

  resolvedContents.sort((a, b) => a.filename.localeCompare(b.filename));
  return resolvedContents.map((r) => r.content).join("\n\n");
}

/**
 * Resolve files for a single active topic. Walks `{role}/topics/{topic}/*.md` across
 * the role chain with the same default → virtual → custom cascade as baseline files.
 * Virtual defaults participate when keyed as `topics/<topic>/<filename>.md` within
 * the appropriate role.
 *
 * Files within a topic are concatenated in alphabetical filename order and share
 * a single `=== TOPIC: <name> ===` header emitted by the caller.
 *
 * Exported so `attach_integration` can inject *only* the topic delta into its tool
 * result — baseline instructions are already in the system prompt and must not be
 * duplicated into conversation history (large attach results thrash auto-compact).
 */
export function resolveTopicFiles(
  roleChain: RoleDir[],
  topic: string,
  virtualDefaults?: VirtualDefaults,
): string {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();
  const topicPrefix = `topics/${topic}/`;

  // 1. Discover every filename that could contribute to this topic.
  const allFilenames = new Set<string>();
  for (const role of roleChain) {
    for (const filename of scanMdFiles(resolve(defaultDir, role, "topics", topic))) {
      allFilenames.add(filename);
    }
    const virtualForRole = virtualDefaults?.get(role);
    if (virtualForRole) {
      for (const key of virtualForRole.keys()) {
        if (key.startsWith(topicPrefix)) {
          allFilenames.add(key.slice(topicPrefix.length));
        }
      }
    }
    for (const filename of scanMdFiles(resolve(configDir, role, "topics", topic))) {
      allFilenames.add(filename);
    }
  }

  if (allFilenames.size === 0) return "";

  // 2. Resolve each filename through the role cascade (default → virtual → custom).
  const resolvedContents: Array<{ filename: string; content: string }> = [];

  for (const filename of allFilenames) {
    let resolvedContent: string | null = null;

    for (const role of roleChain) {
      const defaultPath = resolve(defaultDir, role, "topics", topic, filename);
      if (existsSync(defaultPath)) {
        resolvedContent = readFileSync(defaultPath, "utf-8");
      }

      const virtualContent = virtualDefaults?.get(role)?.get(`${topicPrefix}${filename}`);
      if (virtualContent !== undefined) {
        resolvedContent = virtualContent;
      }

      const customPath = resolve(configDir, role, "topics", topic, filename);
      if (existsSync(customPath)) {
        resolvedContent = readFileSync(customPath, "utf-8");
      }
    }

    if (resolvedContent !== null && resolvedContent.trim().length > 0) {
      resolvedContents.push({ filename, content: resolvedContent });
    }
  }

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
 * Scan for topic subfolder names under `{role}/topics/` in both default and custom dirs,
 * plus any topics represented by virtual defaults keyed as `topics/<name>/...`. Returns
 * a sorted deduplicated list. A topic "exists" for a role if any source (default, custom,
 * or virtual) contributes at least one file to it.
 */
function scanTopicNames(role: string, virtualDefaults?: VirtualDefaults): string[] {
  const names = new Set<string>();
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  for (const base of [defaultDir, configDir]) {
    const topicsRoot = resolve(base, role, "topics");
    if (!existsSync(topicsRoot)) continue;
    try {
      for (const entry of readdirSync(topicsRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name);
      }
    } catch {
      // Ignore — directory unreadable
    }
  }

  const virtualForRole = virtualDefaults?.get(role);
  if (virtualForRole) {
    for (const key of virtualForRole.keys()) {
      const parts = key.split("/");
      if (parts.length >= 3 && parts[0] === "topics" && parts[1]) {
        names.add(parts[1]);
      }
    }
  }

  return [...names].sort();
}

export interface RoleTopicListing {
  role: string;
  topic: string;
  files: InstructionFileEntry[];
}

/**
 * List topic files grouped by `(role, topic)`. Mirrors `listRoleDirFiles` for the
 * topic subfolder layout (`{role}/topics/<topic>/*.md`), so the Home Tab can render
 * topics alongside baseline files. Returns only topics that have at least one file
 * contributed from default, custom, or virtual sources.
 */
export function listRoleTopicDirFiles(virtualDefaults?: VirtualDefaults): RoleTopicListing[] {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const result: RoleTopicListing[] = [];

  for (const role of ALL_ROLE_DIRS) {
    const topics = scanTopicNames(role, virtualDefaults);
    for (const topic of topics) {
      const defaultFiles = new Set(scanMdFiles(resolve(defaultDir, role, "topics", topic)));
      const customFiles = new Set(scanMdFiles(resolve(configDir, role, "topics", topic)));

      const virtualFiles = new Set<string>();
      const virtualForRole = virtualDefaults?.get(role);
      if (virtualForRole) {
        const prefix = `topics/${topic}/`;
        for (const key of virtualForRole.keys()) {
          if (key.startsWith(prefix)) virtualFiles.add(key.slice(prefix.length));
        }
      }

      const allFiles = new Set([...defaultFiles, ...customFiles, ...virtualFiles]);
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

      result.push({ role, topic, files });
    }
  }

  return result;
}

/**
 * Read a specific topic file. Returns default + custom content so callers can
 * diff the override, mirroring `readRoleFile` for baseline files.
 */
export function readRoleTopicFile(
  role: string,
  topic: string,
  filename: string,
): {
  default_content: string | null;
  custom_content: string | null;
} {
  const defaultDir = getDefaultConfigurationDir();
  const configDir = getConfigurationDir();

  const defaultPath = resolve(defaultDir, role, "topics", topic, filename);
  const customPath = resolve(configDir, role, "topics", topic, filename);

  return {
    default_content: existsSync(defaultPath) ? readFileSync(defaultPath, "utf-8") : null,
    custom_content: existsSync(customPath) ? readFileSync(customPath, "utf-8") : null,
  };
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
