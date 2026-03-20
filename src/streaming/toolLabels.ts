import {
  loadToolMappings,
  interpolateLabel,
  applyArgConfigs,
  type ResolvedToolMapping,
} from "./toolMappingLoader.js";

/**
 * Group info for collapsing consecutive tool calls of the same type
 * into a single plan task. Only consecutive calls share a task —
 * when the tool type changes, a new task is created.
 */
export interface ToolGroupInfo {
  /** Category key — consecutive calls with the same key share a task. */
  key: string;
  /** Title shown when the group has 2+ items (e.g., "Reading files"). */
  title: string;
  /** Short description for this specific call, shown in the details list. */
  itemDetail: string;
}

const MCP_PREFIX_RE = /^mcp__([^_]+)__(.+)$/;

/** Parse a tool name into server name and raw tool name. */
function parseToolName(toolName: string): { serverName: string; rawToolName: string } {
  const match = toolName.match(MCP_PREFIX_RE);
  if (match) {
    return { serverName: match[1], rawToolName: match[2] };
  }
  return { serverName: "_builtins", rawToolName: toolName };
}

/** Resolve the mapping for a tool, augment args, and collect truncation limits. */
function resolve(toolName: string, toolArgs: Record<string, unknown>): {
  serverName: string;
  rawToolName: string;
  mapping: ResolvedToolMapping | undefined;
  args: Record<string, unknown>;
  truncations: Map<string, number>;
} {
  const { serverName, rawToolName } = parseToolName(toolName);
  const mapping = loadToolMappings().get(serverName);
  if (!mapping) return { serverName, rawToolName, mapping, args: toolArgs, truncations: new Map() };
  const { args, truncations } = applyArgConfigs(toolArgs, mapping.argConfigs);
  return { serverName, rawToolName, mapping, args, truncations };
}

/**
 * Get a human-readable label for a tool call.
 * Returns null if the tool should be excluded from task cards.
 *
 * Labels may contain Slack mrkdwn links (e.g., `<url|text>`) authored
 * directly in the config template. Arg values are sanitized but the
 * template structure (including link markup) is trusted.
 */
export function getToolLabel(toolName: string, toolArgs: Record<string, unknown>): string | null {
  const { serverName, rawToolName, mapping, args, truncations } = resolve(toolName, toolArgs);

  if (mapping) {
    if (mapping.hidden.has(rawToolName)) return null;

    // Conditional hiding: check arg patterns
    for (const rule of mapping.conditionalHidden) {
      if (rule.tool === rawToolName) {
        const val = String(args[rule.arg] ?? "");
        if (rule.regex.test(val)) return null;
      }
    }

    const template = mapping.labels.get(rawToolName);
    if (template) return interpolateLabel(template, args, truncations);

    if (mapping.defaultLabel) return interpolateLabel(mapping.defaultLabel, args, truncations);
  }

  // Generic MCP tool fallback: "mcp__foo__do_something" → "Checking Foo"
  if (serverName !== "_builtins") {
    const capitalized = serverName.charAt(0).toUpperCase() + serverName.slice(1);
    return `Checking ${capitalized}`;
  }

  return `Running ${toolName}`;
}

/**
 * Get grouping info for a tool call.
 * Returns null if the tool should not be grouped (gets its own individual task).
 */
export function getToolGroup(toolName: string, toolArgs: Record<string, unknown>): ToolGroupInfo | null {
  const { rawToolName, mapping, args, truncations } = resolve(toolName, toolArgs);
  if (!mapping) return null;

  // Check per-tool group
  const toolGroup = mapping.toolGroups.get(rawToolName);
  if (toolGroup) {
    const title = mapping.groupTitles.get(toolGroup.groupKey) ?? toolGroup.groupKey;
    const itemDetail = toolGroup.itemDetail
      ? interpolateLabel(toolGroup.itemDetail, args, truncations)
      : interpolateLabel(mapping.labels.get(rawToolName) ?? rawToolName, args, truncations);
    return { key: toolGroup.groupKey, title, itemDetail };
  }

  // Check file-level group — use interpolated label as itemDetail
  if (mapping.fileGroup) {
    const template = mapping.labels.get(rawToolName);
    const itemDetail = template
      ? interpolateLabel(template, args, truncations)
      : rawToolName;
    return { key: mapping.fileGroup.key, title: mapping.fileGroup.title, itemDetail };
  }

  return null;
}

/**
 * Get mrkdwn-rich details for a tool call (shown in the details field of task cards).
 * Returns null if no contextual details are available.
 *
 * Only Clack tools (our own) use hardcoded logic here. All other MCP tools
 * should use mrkdwn links directly in their label templates.
 */
export function getToolDetails(toolName: string, toolArgs: Record<string, unknown>): string | null {
  if (toolName === "mcp__clack__fetch_channel_messages") {
    const channel = typeof toolArgs.channel_id === "string" ? toolArgs.channel_id : "";
    return channel ? `<#${channel}>` : null;
  }
  if (toolName === "mcp__clack__fetch_slack_message") {
    const url = typeof toolArgs.url === "string" ? toolArgs.url : "";
    return url ? `<${url}|View message>` : null;
  }

  return null;
}
