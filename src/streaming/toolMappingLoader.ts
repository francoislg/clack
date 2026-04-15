import { readdirSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { getDefaultConfigurationDir, getConfigurationDir } from "../config.js";
import { getLoadedPlugins } from "../plugins/state.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw JSON structure of a tool mapping config file. */
export interface ToolEntryObject {
  label: string;
  group?: string;
  itemDetail?: string;
}

export interface ArgConfig {
  /** Source arg to extract from (supports dot-notation, e.g., "params.path_id"). */
  from?: string;
  /** Regex pattern — capture group 1 is used as the extracted value. */
  pattern?: string;
  /** Max chars for this arg's interpolated value. */
  truncate?: number;
}

export interface ConditionalHiddenRule {
  /** Tool name to match (raw name without MCP prefix). */
  tool: string;
  /** Argument name to test. */
  arg: string;
  /** Regex pattern — if the arg value matches, the tool call is hidden. */
  pattern: string;
}

export interface ToolMappingConfig {
  tools?: Record<string, string | ToolEntryObject>;
  default?: string;
  hidden?: string[];
  /** Pattern-based conditional hiding: hide tool calls when an arg matches a regex. */
  conditionalHidden?: ConditionalHiddenRule[];
  /** Shorthand: all tools share one group with this title. */
  group?: string;
  /** Explicit group key → display title mapping. */
  groups?: Record<string, string>;
  /** Per-arg behavior: extraction from other args, truncation limits. Real args take precedence over extracted values. */
  argOptions?: Record<string, ArgConfig>;
}

export interface ResolvedArgConfig {
  from?: string;
  regex?: RegExp;
  truncate?: number;
}

export interface ResolvedConditionalHiddenRule {
  tool: string;
  arg: string;
  regex: RegExp;
}

/** Parsed and resolved tool mapping ready for lookups. */
export interface ResolvedToolMapping {
  /** toolName → label template */
  labels: Map<string, string>;
  /** toolName → { group key, itemDetail template } */
  toolGroups: Map<string, { groupKey: string; itemDetail?: string }>;
  /** group key → display title */
  groupTitles: Map<string, string>;
  /** Arg name → config (extraction, truncation) */
  argConfigs: Map<string, ResolvedArgConfig>;
  /** Tools excluded from task cards */
  hidden: Set<string>;
  /** Pattern-based conditional hiding rules */
  conditionalHidden: ResolvedConditionalHiddenRule[];
  /** Fallback label template for unlisted tools */
  defaultLabel?: string;
  /** File-level group shorthand (key = filename, title = group value) */
  fileGroup?: { key: string; title: string };
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{([^}]+)\}/g;
const WORD_RE = /^\w+$/;
const DOT_PATH_RE = /^\w+(\.\w+)+$/;

/**
 * Apply arg configs: extract virtual args and store truncation limits.
 * Real args always win — extraction only fills in keys that don't already exist.
 * Returns augmented args and a truncation map for use during interpolation.
 */
export function applyArgConfigs(
  args: Record<string, unknown>,
  argConfigs: Map<string, ResolvedArgConfig>,
): { args: Record<string, unknown>; truncations: Map<string, number> } {
  const truncations = new Map<string, number>();
  if (argConfigs.size === 0) return { args, truncations };

  const augmented = { ...args };
  for (const [name, config] of argConfigs) {
    // Collect truncation limits
    if (config.truncate) truncations.set(name, config.truncate);

    // Extraction: only fill in keys that don't already exist
    if (config.from) {
      if (augmented[name] != null && augmented[name] !== "") continue;
      const sourceVal = resolveArg(args, config.from);
      if (sourceVal == null || sourceVal === "") continue;
      const strVal = String(sourceVal);
      if (config.regex) {
        const match = strVal.match(config.regex);
        if (match?.[1]) augmented[name] = match[1];
      } else {
        augmented[name] = strVal;
      }
    }
  }
  return { args: augmented, truncations };
}

/** Resolve a possibly dot-notated arg path (e.g., "params.path_id") from nested args. */
function resolveArg(args: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return args[path];
  let current: unknown = args;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Shorten a path to its last 2 segments. */
export function shortenPath(value: string): string {
  const parts = value.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : value;
}

/** Truncate a string to `max` chars, appending "…" if truncated. */
import { truncate } from "../text.js";

/**
 * Sanitize an interpolated arg value for safe Slack rendering.
 * - Strips <, >, @, !, newlines
 * - Shortens paths (values containing /)
 * - Optionally truncates to a configured max length
 */
export function sanitizeArgValue(value: string, maxLength?: number): string {
  // Strip dangerous characters
  let sanitized = value.replace(/[<>@!\n\r]/g, "");
  // URLs: don't shorten or truncate (they're used inside <url|text> links)
  if (sanitized.startsWith("http")) return sanitized;
  // Shorten file paths
  if (sanitized.includes("/")) {
    sanitized = shortenPath(sanitized);
  }
  // Per-arg truncation (only if configured)
  if (maxLength) {
    sanitized = truncate(sanitized, maxLength);
  }
  return sanitized;
}

/**
 * Interpolate a label template with tool args.
 *
 * Supports `{argName}` and fallback chains `{arg1|arg2|literal fallback}`.
 * Each `|`-separated segment is tried left-to-right:
 * - If it matches `\w+`, treat as arg name lookup
 * - Otherwise, treat as literal string
 * - In a multi-segment chain, the last segment is used as a literal
 *   if arg lookup fails (e.g., `{file_path|file}` → "file" when file_path is missing)
 *
 * Returns the final label, trimmed. Arg values are sanitized and optionally
 * truncated based on per-arg config (via `truncations` map).
 */
export function interpolateLabel(
  template: string,
  args: Record<string, unknown>,
  truncations?: Map<string, number>,
): string {
  const result = template.replace(PLACEHOLDER_RE, (_match, expr: string) => {
    const segments = expr.split("|");
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      if (WORD_RE.test(segment) || DOT_PATH_RE.test(segment)) {
        // Arg name lookup — supports dot-notation for nested args (e.g., "params.path_id")
        const val = resolveArg(args, segment);
        if (val != null && val !== "") {
          // Use the base arg name (last segment of dot path) for truncation lookup
          const baseName = segment.includes(".") ? segment.split(".").pop()! : segment;
          const maxLen = truncations?.get(segment) ?? truncations?.get(baseName);
          return sanitizeArgValue(String(val), maxLen);
        }
        // Last segment in a multi-segment chain: use as literal fallback
        if (isLast && segments.length > 1) {
          // For dot paths, use the last part as the literal (e.g., "params.path_id" → "path_id")
          return segment.includes(".") ? segment.split(".").pop()! : segment;
        }
      } else {
        // Literal fallback
        return segment;
      }
    }
    // All segments exhausted — return empty string
    return "";
  });
  // Strip broken mrkdwn links: empty URL/text, or URLs with empty path segments
  const cleaned = result.replace(/<([^|]*)\|([^>]*)>/g, (_m, url: string, text: string) => {
    if (!url || !text) return "";
    // Check for broken URLs (empty path segments from unresolved args)
    try {
      if (new URL(url).pathname.includes("//")) return text;
    } catch {
      // Not a URL — keep as-is
    }
    return `<${url}|${text}>`;
  });
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/**
 * Parse a raw ToolMappingConfig into a ResolvedToolMapping.
 * @param config The parsed JSON config
 * @param filename The config filename without extension (used as group key for file-level group)
 */
export function resolveConfig(config: ToolMappingConfig, filename: string): ResolvedToolMapping {
  const labels = new Map<string, string>();
  const toolGroups = new Map<string, { groupKey: string; itemDetail?: string }>();
  const groupTitles = new Map<string, string>();
  const hidden = new Set<string>(config.hidden ?? []);

  // Populate group titles from explicit groups map
  if (config.groups) {
    for (const [key, title] of Object.entries(config.groups)) {
      groupTitles.set(key, title);
    }
  }

  // File-level group shorthand
  let fileGroup: { key: string; title: string } | undefined;
  if (config.group) {
    fileGroup = { key: filename, title: config.group };
    groupTitles.set(filename, config.group);
  }

  // Process tool entries
  if (config.tools) {
    for (const [toolName, entry] of Object.entries(config.tools)) {
      if (typeof entry === "string") {
        labels.set(toolName, entry);
      } else {
        labels.set(toolName, entry.label);
        if (entry.group) {
          toolGroups.set(toolName, { groupKey: entry.group, itemDetail: entry.itemDetail });
        }
      }
    }
  }

  // Parse arg options
  const argConfigs = new Map<string, ResolvedArgConfig>();
  if (config.argOptions) {
    for (const [name, def] of Object.entries(config.argOptions)) {
      try {
        argConfigs.set(name, {
          from: def.from,
          regex: def.pattern ? new RegExp(def.pattern) : undefined,
          truncate: def.truncate,
        });
      } catch {
        // Invalid regex — skip
      }
    }
  }

  // Parse conditional hidden rules
  const conditionalHidden: ResolvedConditionalHiddenRule[] = [];
  if (config.conditionalHidden) {
    for (const rule of config.conditionalHidden) {
      try {
        conditionalHidden.push({ tool: rule.tool, arg: rule.arg, regex: new RegExp(rule.pattern) });
      } catch {
        logger.warn(`Skipping conditionalHidden rule with invalid pattern "${rule.pattern}"`);
      }
    }
  }

  return {
    labels,
    toolGroups,
    groupTitles,
    argConfigs,
    hidden,
    conditionalHidden,
    defaultLabel: config.default,
    fileGroup,
  };
}

// ---------------------------------------------------------------------------
// Environment variable substitution
// ---------------------------------------------------------------------------

const ENV_VAR_RE = /\$\{(\w+)\}/g;

/** Replace `${VAR_NAME}` placeholders with values from `process.env`. */
export function substituteEnvVars(raw: string): string {
  return raw.replace(ENV_VAR_RE, (_, varName) => {
    const value = process.env[varName];
    if (value == null) {
      logger.warn(`Environment variable ${varName} is not set (used in tool mapping config)`);
    }
    return value ?? "";
  });
}

// ---------------------------------------------------------------------------
// Two-tier loader with caching
// ---------------------------------------------------------------------------

let cachedMappings: Map<string, ResolvedToolMapping> | undefined;

/**
 * Load tool mapping configs from both tiers.
 * User configs in `data/configuration/tool_mapping/` fully replace
 * defaults in `data/default_configuration/tool_mapping/` per-file.
 */
export function loadToolMappings(): Map<string, ResolvedToolMapping> {
  if (cachedMappings) return cachedMappings;

  const mappings = new Map<string, ResolvedToolMapping>();
  const defaultDir = resolve(getDefaultConfigurationDir(), "tool_mapping");
  const userDir = resolve(getConfigurationDir(), "tool_mapping");

  // Collect filenames from both dirs (user overrides default)
  const fileMap = new Map<string, string>(); // filename → full path

  for (const dir of [defaultDir, userDir]) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue; // Directory doesn't exist
    }
    for (const file of files) {
      fileMap.set(file, resolve(dir, file));
    }
  }

  // Parse each file
  for (const [file, fullPath] of fileMap) {
    const serverName = basename(file, ".json");
    try {
      const raw = substituteEnvVars(readFileSync(fullPath, "utf-8"));
      const config = JSON.parse(raw) as ToolMappingConfig;
      mappings.set(serverName, resolveConfig(config, serverName));
    } catch (err) {
      logger.warn(`Skipping malformed tool mapping config ${file}: ${err}`);
    }
  }

  // Plugin tool mappings: one ResolvedToolMapping per plugin, keyed by the plugin's server name.
  // Plugin tools are served by each plugin's dedicated MCP server (`mcp__<plugin>__<tool>`),
  // so their mappings live under the plugin name (not merged into `clack`).
  // A file-based config at `data/configuration/tool_mapping/<plugin>.json` takes precedence over
  // programmatic mappings per the existing two-tier rules — programmatic entries fill in only for
  // tools not covered by the effective (user-override) file.
  for (const plugin of getLoadedPlugins().results) {
    if (plugin.toolMappings.size === 0) continue;
    const programmaticConfig = resolveConfig(
      { tools: Object.fromEntries(plugin.toolMappings) },
      plugin.name,
    );
    const existing = mappings.get(plugin.name);
    if (!existing) {
      mappings.set(plugin.name, programmaticConfig);
      continue;
    }
    // File-based config exists — it takes precedence. Fill in programmatic entries only for
    // tool names the file-based config does not cover.
    for (const [toolName, label] of programmaticConfig.labels) {
      if (!existing.labels.has(toolName)) existing.labels.set(toolName, label);
    }
    for (const [toolName, group] of programmaticConfig.toolGroups) {
      if (!existing.toolGroups.has(toolName)) existing.toolGroups.set(toolName, group);
    }
  }

  cachedMappings = mappings;
  return mappings;
}

/** Clear the cached tool mappings, forcing reload on next access. */
export function resetToolMappingCache(): void {
  cachedMappings = undefined;
}
