import {
  loadToolMappings,
  loadServerOverrides,
  interpolateLabel,
  applyArgConfigs,
  applyArgEnrichers,
  type ResolvedToolMapping,
  type ToolArgs,
} from "./toolMappingLoader.js";
import { getTaskCardMaxDetails } from "../config.js";
import { t } from "../i18n/t.js";

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
  /**
   * Cap on detail lines rendered for this group's task card. The renderer
   * keeps incrementing the header `(<count>)` past this cap, but stops
   * appending new detail lines once it is reached.
   * Resolution: per-group config → global `taskCards.maxDetailsPerGroup` → built-in default.
   */
  maxDetails: number;
}

// Lazy first capture so on-demand server names (e.g. `trivia_management`, where `:` from the
// `<plugin>:<key>` full name is substituted to `_` on the wire) still resolve correctly.
const MCP_PREFIX_RE = /^mcp__(.+?)__(.+)$/;

/** Parse a tool name into server name and raw tool name. */
function parseToolName(toolName: string): { serverName: string; rawToolName: string } {
  const match = toolName.match(MCP_PREFIX_RE);
  if (match) {
    return { serverName: match[1], rawToolName: match[2] };
  }
  return { serverName: "_builtins", rawToolName: toolName };
}

/** Resolve the mapping for a tool, augment args, and collect truncation limits. */
function resolve(
  toolName: string,
  toolArgs: Record<string, unknown>,
): {
  serverName: string;
  rawToolName: string;
  mappingKey: string;
  labelSuffix: string | undefined;
  hasOverride: boolean;
  mapping: ResolvedToolMapping | undefined;
  args: Record<string, unknown>;
  truncations: Map<string, number>;
} {
  const { serverName, rawToolName } = parseToolName(toolName);
  const override = loadServerOverrides().get(serverName);
  const mappingKey = override?.mappingName ?? serverName;
  const labelSuffix = override?.label;
  const hasOverride = override !== undefined;
  // Run registered arg enrichers first so synthetic args (e.g. {name} looked up from a
  // cron job by id) are visible to applyArgConfigs and the template interpolator.
  const enrichedArgs = applyArgEnrichers(toolName, toolArgs as ToolArgs);
  const mapping = loadToolMappings().get(mappingKey);
  if (!mapping)
    return {
      serverName,
      rawToolName,
      mappingKey,
      labelSuffix,
      hasOverride,
      mapping,
      args: enrichedArgs,
      truncations: new Map(),
    };
  const { args, truncations } = applyArgConfigs(enrichedArgs, mapping.argConfigs);
  return {
    serverName,
    rawToolName,
    mappingKey,
    labelSuffix,
    hasOverride,
    mapping,
    args,
    truncations,
  };
}

/** Append an environment label suffix `(label)` if one was configured for this server. */
function withSuffix(label: string, suffix: string | undefined): string {
  return suffix ? `${label} (${suffix})` : label;
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
  const { serverName, rawToolName, mappingKey, labelSuffix, mapping, args, truncations } = resolve(
    toolName,
    toolArgs,
  );

  if (mapping) {
    if (mapping.hidden.has(rawToolName)) return null;

    // Conditional hiding: check arg patterns
    for (const rule of mapping.conditionalHidden) {
      if (rule.tool === rawToolName) {
        const val = String(args[rule.arg] ?? "");
        if (rule.regex.test(val)) return null;
      }
    }

    // Per-tool labels intentionally skip the suffix: when a tool runs inside a group,
    // the group banner already carries "(env)", so repeating it on every sub-item is noise.
    const template = mapping.labels.get(rawToolName);
    if (template) return interpolateLabel(template, args, truncations);

    if (mapping.defaultLabel)
      return withSuffix(interpolateLabel(mapping.defaultLabel, args, truncations), labelSuffix);
  }

  // Generic MCP tool fallback: "mcp__foo__do_something" → "Checking Foo".
  // When an override is in play, capitalize the mapping name (e.g. "mongodb") rather than
  // the wire server name (e.g. "mongodb-prod") so the suffix carries the env distinction.
  if (serverName !== "_builtins") {
    const base = mappingKey;
    const capitalized = base.charAt(0).toUpperCase() + base.slice(1);
    return withSuffix(t("streamer.tool_label_checking", { name: capitalized }), labelSuffix);
  }

  return t("streamer.tool_label_running", { tool: toolName });
}

/**
 * Get grouping info for a tool call.
 * Returns null if the tool should not be grouped (gets its own individual task).
 */
export function getToolGroup(
  toolName: string,
  toolArgs: Record<string, unknown>,
): ToolGroupInfo | null {
  const { serverName, rawToolName, labelSuffix, hasOverride, mapping, args, truncations } = resolve(
    toolName,
    toolArgs,
  );
  if (!mapping) return null;

  // When several wire servers share a mapping file via toolMapping.name, namespace the
  // group key with the wire server name so `mongodb-dev` and `mongodb-prod` task cards
  // do not collapse into one another inside slackStreamer's openGroup tracking.
  const namespaceKey = (key: string): string => (hasOverride ? `${serverName}:${key}` : key);

  // Check per-tool group
  const toolGroup = mapping.toolGroups.get(rawToolName);
  if (toolGroup) {
    const baseTitle = mapping.groupTitles.get(toolGroup.groupKey) ?? toolGroup.groupKey;
    const title = withSuffix(baseTitle, labelSuffix);
    const itemDetail = toolGroup.itemDetail
      ? interpolateLabel(toolGroup.itemDetail, args, truncations)
      : interpolateLabel(mapping.labels.get(rawToolName) ?? rawToolName, args, truncations);
    return {
      key: namespaceKey(toolGroup.groupKey),
      title,
      itemDetail,
      maxDetails: resolveGroupMaxDetails(mapping, toolGroup.groupKey),
    };
  }

  // Check file-level group — use interpolated label as itemDetail
  if (mapping.fileGroup) {
    const template = mapping.labels.get(rawToolName);
    const itemDetail = template ? interpolateLabel(template, args, truncations) : rawToolName;
    return {
      key: namespaceKey(mapping.fileGroup.key),
      title: withSuffix(mapping.fileGroup.title, labelSuffix),
      itemDetail,
      maxDetails: resolveGroupMaxDetails(mapping, mapping.fileGroup.key),
    };
  }

  return null;
}

/**
 * Resolve the detail-line cap for a group key:
 * per-group override → global `taskCards.maxDetailsPerGroup` → built-in default.
 */
function resolveGroupMaxDetails(mapping: ResolvedToolMapping, groupKey: string): number {
  const perGroup = mapping.groupMaxDetails.get(groupKey);
  if (perGroup !== undefined) return perGroup;
  return getTaskCardMaxDetails();
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
