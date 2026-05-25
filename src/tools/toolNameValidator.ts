import { getLoadedPlugins } from "../plugins/state.js";

/**
 * Every clack core tool name the `tools.push(...)` blocks in `src/tools/server.ts` can
 * register. Keep this in sync when adding/removing core tools. The runtime diagnostic warning
 * in `buildClackTools` is the safety net; this list drives create/update-time validation so
 * `requiredTools` typos surface before a job ever fires.
 */
export const CLACK_CORE_TOOL_NAMES: readonly string[] = [
  // Always-on query tools
  "list_repositories",
  "git_log",
  "deepen_history",
  "random_roll",
  // Slack-client-gated query tools
  "find_user",
  "find_emoji",
  "fetch_slack_message",
  "fetch_channel_messages",
  "upload_file",
  "stop_tracking",
  "add_reaction",
  "remove_reaction",
  "find_channel",
  "view_slack_image",
  "view_slack_file",
  // Read-only query tools
  "find_recent_interactions",
  "find_session_transcript",
  "find_sessions",
  "find_changes",
  "find_pull_requests",
  "resolve_review_thread",
  "attach_integration",
  "list_skill_pack_skills",
  "load_skill",
  "list_user_skills",
  // Admin-gated query tools
  "list_config_files",
  "read_config_file",
  "get_session_trace",
  // Action tools
  "propose_change",
  "request_update",
  "cancel_worker_run",
  "propose_skill_create",
  "propose_skill_update",
  "propose_skill_disable",
  "propose_skill_restore",
  "propose_config_update",
  "admin_read_file",
  "admin_write_file",
  "admin_restart_app",
  "admin_set_env",
  "admin_list_env",
  "admin_set_role",
  "admin_list_error_reports",
  "admin_read_error_report",
  "admin_delete_message",
  "list_auto_respond_rules",
  "add_auto_respond_rule",
  "update_auto_respond_rule",
  "toggle_auto_respond_rule",
  "delete_auto_respond_rule",
  // Scheduled-message tools
  "schedule_reminder",
  "list_reminders",
  "cancel_reminder",
  "create_scheduled_message",
  "list_scheduled_messages",
  "get_scheduled_message_runs",
  "cancel_scheduled_message",
  "update_scheduled_message",
  "run_scheduled_message_now",
  // Presentation
  "submit_response",
] as const;

export interface ToolNameValidationResult {
  valid: boolean;
  unrecognized: string[];
  /** Human-readable explanation for each unrecognized name (same order as `unrecognized`). */
  reasons: string[];
}

const FULL_NAME_PATTERN = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/;

/**
 * Parse a fully-qualified MCP tool name (`mcp__<server>__<tool>`) into its server and tool
 * parts. Returns null if the name doesn't match the expected shape.
 */
function parseFullName(fullName: string): { server: string; tool: string } | null {
  const match = FULL_NAME_PATTERN.exec(fullName);
  if (!match) return null;
  return { server: match[1], tool: match[2] };
}

/**
 * Validate that each name in `requiredTools` refers to a known tool — either a clack core
 * tool or a tool exported by a currently-loaded plugin. Bare tool names with no MCP prefix
 * are reported as invalid; the gate only matches full MCP-visible names.
 */
/**
 * Format a validation result as a user-facing error message suitable for tool error replies.
 * Returns null when the input is valid (nothing to report).
 */
export function formatRequiredToolNameError(result: ToolNameValidationResult): string | null {
  if (result.valid) return null;
  return `Invalid requiredTools entries:\n${result.reasons.map((r) => `- ${r}`).join("\n")}`;
}

export function validateRequiredToolNames(requiredTools: string[]): ToolNameValidationResult {
  const unrecognized: string[] = [];
  const reasons: string[] = [];
  const loadedPlugins = getLoadedPlugins().results;

  for (const name of requiredTools) {
    const parsed = parseFullName(name);
    if (!parsed) {
      unrecognized.push(name);
      reasons.push(
        `"${name}" is not a fully-qualified MCP tool name. Expected format: "mcp__<server>__<tool>" (e.g., "mcp__clack__fetch_channel_messages").`,
      );
      continue;
    }

    if (parsed.server === "clack") {
      if (!CLACK_CORE_TOOL_NAMES.includes(parsed.tool)) {
        unrecognized.push(name);
        reasons.push(
          `"${name}" is not a known clack core tool. Check the spelling of "${parsed.tool}".`,
        );
      }
      continue;
    }

    const plugin = loadedPlugins.find((p) => p.name === parsed.server);
    if (!plugin) {
      unrecognized.push(name);
      reasons.push(
        `"${name}" references plugin "${parsed.server}" which is not currently loaded. Available plugins: ${loadedPlugins.map((p) => p.name).join(", ") || "(none)"}.`,
      );
      continue;
    }
    const hasTool = plugin.tools.some((t) => t.name === parsed.tool);
    if (!hasTool) {
      const availableTools = plugin.tools.map((t) => t.name).join(", ");
      unrecognized.push(name);
      reasons.push(
        `"${name}" references tool "${parsed.tool}" which plugin "${parsed.server}" does not export. Available tools: ${availableTools || "(none)"}.`,
      );
    }
  }

  return { valid: unrecognized.length === 0, unrecognized, reasons };
}
