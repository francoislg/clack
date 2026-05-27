import { readdirSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { getDefaultConfigurationDir, getConfigurationDir, getConfig } from "../config.js";
import { getLoadedPlugins } from "../plugins/state.js";
import type { ToolMapping } from "../plugins/sdk.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A user-facing label value that may be either a plain string (single language,
 * treated as English) or a language map like `{ "en": "...", "fr": "..." }`.
 * Resolved to the workspace's configured language at load time via
 * {@link resolveLocalized}, falling back to `en` then to any present value.
 */
export type LocalizedString = string | Record<string, string>;

/** Raw JSON structure of a tool mapping config file. */
export interface ToolEntryObject {
  label: LocalizedString;
  group?: string;
  itemDetail?: LocalizedString;
  /** Suppress this tool's invocations from the Slack streaming task-card UI. */
  hidden?: boolean;
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

/** Per-group entry when callers need to override task-card rendering. */
export interface GroupEntryObject {
  title: LocalizedString;
  /** Cap on detail lines rendered for this group's task card. Overrides the global default. */
  maxDetails?: number;
}

export interface ToolMappingConfig {
  tools?: Record<string, string | ToolEntryObject>;
  default?: LocalizedString;
  hidden?: string[];
  /** Pattern-based conditional hiding: hide tool calls when an arg matches a regex. */
  conditionalHidden?: ConditionalHiddenRule[];
  /** Shorthand: all tools share one group with this title. */
  group?: LocalizedString;
  /** Cap on detail lines for the file-level group (paired with `group`). */
  maxDetails?: number;
  /** Explicit group key → display title (string form) or full entry (object form with `maxDetails`). */
  groups?: Record<string, string | GroupEntryObject>;
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
  /** group key → per-group cap on detail lines (absent ⇒ use global default) */
  groupMaxDetails: Map<string, number>;
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

/** Active workspace language, defaulting to "en" when config isn't loaded (e.g. in tests). */
function activeLang(): string {
  try {
    return getConfig().language ?? "en";
  } catch {
    return "en";
  }
}

/**
 * Resolve a {@link LocalizedString} to a concrete string for the active language.
 * Plain strings pass through unchanged. Language maps pick the active language,
 * then fall back to `en`, then to any present value (so a partially-translated
 * map never renders empty).
 */
export function resolveLocalized(value: LocalizedString, lang?: string): string;
export function resolveLocalized(
  value: LocalizedString | undefined,
  lang?: string,
): string | undefined;
export function resolveLocalized(
  value: LocalizedString | undefined,
  lang: string = activeLang(),
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value[lang] ?? value.en ?? Object.values(value)[0];
}

/**
 * Parse a raw ToolMappingConfig into a ResolvedToolMapping.
 * @param config The parsed JSON config
 * @param filename The config filename without extension (used as group key for file-level group)
 */
export function resolveConfig(config: ToolMappingConfig, filename: string): ResolvedToolMapping {
  const labels = new Map<string, string>();
  const toolGroups = new Map<string, { groupKey: string; itemDetail?: string }>();
  const groupTitles = new Map<string, string>();
  const groupMaxDetails = new Map<string, number>();
  const hidden = new Set<string>(config.hidden ?? []);

  // Populate group titles (and optional per-group maxDetails) from the explicit groups map.
  // Each value may be a plain title string (legacy form) or `{ title, maxDetails? }` (object form).
  if (config.groups) {
    for (const [key, entry] of Object.entries(config.groups)) {
      if (typeof entry === "string") {
        groupTitles.set(key, entry);
      } else {
        groupTitles.set(key, resolveLocalized(entry.title));
        const max = entry.maxDetails;
        if (typeof max === "number" && Number.isFinite(max) && Number.isInteger(max) && max >= 0) {
          groupMaxDetails.set(key, max);
        } else if (max !== undefined) {
          logger.warn(
            `Tool mapping '${filename}' group '${key}' has invalid maxDetails ${JSON.stringify(max)}; ignoring`,
          );
        }
      }
    }
  }

  // File-level group shorthand (and its optional sibling maxDetails).
  let fileGroup: { key: string; title: string } | undefined;
  if (config.group) {
    const groupTitle = resolveLocalized(config.group);
    fileGroup = { key: filename, title: groupTitle };
    groupTitles.set(filename, groupTitle);
    const max = config.maxDetails;
    if (typeof max === "number" && Number.isFinite(max) && Number.isInteger(max) && max >= 0) {
      groupMaxDetails.set(filename, max);
    } else if (max !== undefined) {
      logger.warn(
        `Tool mapping '${filename}' has invalid maxDetails ${JSON.stringify(max)}; ignoring`,
      );
    }
  }

  // Process tool entries
  if (config.tools) {
    for (const [toolName, entry] of Object.entries(config.tools)) {
      if (typeof entry === "string") {
        labels.set(toolName, entry);
      } else {
        labels.set(toolName, resolveLocalized(entry.label));
        if (entry.group) {
          toolGroups.set(toolName, {
            groupKey: entry.group,
            itemDetail: resolveLocalized(entry.itemDetail),
          });
        }
        if (entry.hidden) {
          hidden.add(toolName);
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
    groupMaxDetails,
    argConfigs,
    hidden,
    conditionalHidden,
    defaultLabel: resolveLocalized(config.default),
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
      files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
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

  // Plugin tool mappings: one ResolvedToolMapping per wire MCP server. The default server's
  // tools (`mcp__<plugin>__<tool>`) are keyed under `<plugin>`; on-demand server tools
  // (`mcp__<plugin>_<serverKey>__<tool>`) are keyed under `<plugin>_<serverKey>` so the
  // `parseToolName` lookup in `toolLabels.ts` finds them. A file-based config at
  // `data/configuration/tool_mapping/<wireServerName>.json` takes precedence over programmatic
  // mappings per the existing two-tier rules.
  for (const plugin of getLoadedPlugins().results) {
    if (plugin.toolMappings.size === 0) continue;

    const serverKeyByToolName = new Map<string, string | undefined>();
    for (const tool of plugin.tools) {
      serverKeyByToolName.set(tool.name, tool.serverKey);
    }

    const toolsByWireServerName = new Map<string, Record<string, ToolMapping>>();
    for (const [toolName, mapping] of plugin.toolMappings) {
      const serverKey = serverKeyByToolName.get(toolName);
      const wireServerName = serverKey === undefined ? plugin.name : `${plugin.name}_${serverKey}`;
      let bucket = toolsByWireServerName.get(wireServerName);
      if (!bucket) {
        bucket = {};
        toolsByWireServerName.set(wireServerName, bucket);
      }
      bucket[toolName] = mapping;
    }

    for (const [wireServerName, tools] of toolsByWireServerName) {
      const programmaticConfig = resolveConfig({ tools }, wireServerName);
      const existing = mappings.get(wireServerName);
      if (!existing) {
        mappings.set(wireServerName, programmaticConfig);
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
      for (const toolName of programmaticConfig.hidden) {
        existing.hidden.add(toolName);
      }
    }
  }

  cachedMappings = mappings;
  return mappings;
}

// ---------------------------------------------------------------------------
// Per-server tool-mapping overrides (config.mcpServers[name].toolMapping)
// ---------------------------------------------------------------------------

/** Result of resolving a server's `toolMapping` override. */
export interface ServerOverride {
  /** Mapping file/key to look up in `loadToolMappings()` instead of the wire server name. */
  mappingName: string;
  /** Optional environment label appended as `(label)` to rendered task titles. */
  label?: string;
}

let cachedServerOverrides: Map<string, ServerOverride> | undefined;

/**
 * Load per-server tool-mapping overrides from `config.mcpServers[name].toolMapping`.
 *
 * Lets several MCP server entries share a single mapping file (`name`) and append
 * an environment label (`label`) to rendered task titles. Cached on first call.
 *
 * Returns an empty map if config has not been loaded yet (e.g. in unit tests that
 * exercise `getToolLabel` without booting the app).
 */
export function loadServerOverrides(): Map<string, ServerOverride> {
  if (cachedServerOverrides) return cachedServerOverrides;
  const map = new Map<string, ServerOverride>();
  let registry: Record<string, { toolMapping?: { name: string; label?: string } }> | undefined;
  try {
    registry = getConfig().mcpServers;
  } catch {
    // Config not loaded — leave map empty.
  }
  if (registry) {
    for (const [serverName, entry] of Object.entries(registry)) {
      if (entry.toolMapping) {
        map.set(serverName, {
          mappingName: entry.toolMapping.name,
          label: entry.toolMapping.label,
        });
      }
    }
  }
  cachedServerOverrides = map;
  return map;
}

/** Clear the cached tool mappings, forcing reload on next access. */
export function resetToolMappingCache(): void {
  cachedMappings = undefined;
  cachedServerOverrides = undefined;
}

/**
 * Test-only: seed the server-overrides cache so unit tests can exercise the
 * `toolMapping.name` / `toolMapping.label` behavior without booting the full
 * config. Call `resetToolMappingCache()` afterwards to clear.
 */
export function __setServerOverridesForTest(overrides: Map<string, ServerOverride>): void {
  cachedServerOverrides = overrides;
}

// ---------------------------------------------------------------------------
// Per-tool args enrichers
// ---------------------------------------------------------------------------

/**
 * JSON-shaped value space for tool call arguments. Tool args come off the MCP wire as
 * JSON, so values are constrained to JSON primitives + arrays + nested objects of the
 * same shape.
 */
export type ToolArgValue = string | number | boolean | null | ToolArgValue[] | ToolArgs;
export interface ToolArgs {
  [key: string]: ToolArgValue;
}

/**
 * Synchronous hook for augmenting a tool call's args before label interpolation. Enrichers
 * let call-site code surface synthetic args (e.g. a `name` looked up from external state
 * by `id`) that Claude did not directly pass. Use this when a `{name|id}`-style fallback
 * template needs an arg the tool's schema doesn't carry.
 *
 * Enrichers MUST be synchronous — label generation is on the streaming hot path.
 */
export type ArgEnricher = (args: ToolArgs) => ToolArgs;

const argEnrichers = new Map<string, ArgEnricher[]>();

/**
 * Register an enricher for a fully-qualified MCP tool name (e.g. `mcp__clack__cancel_scheduled_message`).
 * Registering the same function reference twice for the same tool name is a no-op.
 */
export function registerArgEnricher(toolName: string, fn: ArgEnricher): void {
  const existing = argEnrichers.get(toolName);
  if (!existing) {
    argEnrichers.set(toolName, [fn]);
    return;
  }
  if (existing.includes(fn)) return;
  existing.push(fn);
}

/**
 * Run any enrichers registered for `toolName` against `args`, in registration order. When an
 * enricher throws, the system logs a warning and falls back to the args produced by the
 * preceding enricher (or the original args if the first enricher throws). Label generation
 * never crashes on enricher failure.
 */
export function applyArgEnrichers(toolName: string, args: ToolArgs): ToolArgs {
  const enrichers = argEnrichers.get(toolName);
  if (!enrichers || enrichers.length === 0) return args;
  let current = args;
  for (const enricher of enrichers) {
    try {
      current = enricher(current);
    } catch (err) {
      logger.warn(
        `Tool arg enricher for ${toolName} threw — falling back to un-enriched args:`,
        err,
      );
    }
  }
  return current;
}

/** Test-only: clear all registered enrichers. */
export function clearArgEnrichers(): void {
  argEnrichers.clear();
}
