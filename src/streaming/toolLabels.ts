/**
 * Maps tool names to human-readable labels for task card display.
 *
 * - String values are used as-is.
 * - Functions receive tool args and return a dynamic label.
 * - null means the tool is excluded from task cards (e.g., submit_response).
 */

type LabelEntry = string | ((args: Record<string, unknown>) => string) | null;

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

const TOOL_LABELS: Record<string, LabelEntry> = {
  // Built-in Claude Code tools
  Read: (args) => `Reading ${shortenPath(args.file_path) || "file"}`,
  Glob: "Searching for files",
  Grep: (args) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    return pattern ? `Searching for "${truncate(pattern, 40)}"` : "Searching codebase";
  },
  Write: (args) => `Writing ${shortenPath(args.file_path) || "file"}`,
  Edit: (args) => `Editing ${shortenPath(args.file_path) || "file"}`,
  Bash: (args) => {
    const desc = typeof args.description === "string" ? args.description : "";
    if (desc) return desc;
    const cmd = typeof args.command === "string" ? truncate(args.command, 60) : "";
    return cmd ? `Running \`${cmd}\`` : "Running command";
  },
  Skill: (args) => {
    const skill = typeof args.skill === "string" ? args.skill : "";
    return skill ? `Running skill ${skill}` : "Running skill";
  },

  // Query-mode clack tools
  mcp__clack__list_repositories: "Listing repositories",
  mcp__clack__git_log: "Reading git history",
  mcp__clack__deepen_history: "Loading more history",
  mcp__clack__find_sessions: "Finding sessions",
  mcp__clack__find_changes: "Finding changes",
  mcp__clack__find_pull_requests: "Finding pull requests",
  mcp__clack__find_user: "Looking up user",
  mcp__clack__list_config_files: "Listing config files",
  mcp__clack__read_config_file: "Reading config file",
  mcp__clack__fetch_channel_messages: "Reading channel messages",
  mcp__clack__fetch_slack_message: "Reading Slack message",
  mcp__clack__resolve_review_thread: "Resolving review thread",
  mcp__clack__submit_response: null, // The answer itself, not a step

  // Action tools (query mode)
  mcp__clack__propose_change: "Proposing change",
  mcp__clack__request_update: "Requesting update",
  mcp__clack__propose_config_update: "Proposing config update",

  // Worker-mode clack tools
  mcp__clack__git_push: "Pushing to remote",
  mcp__clack__ensure_pr: "Creating pull request",
  mcp__clack__merge_pr: "Merging pull request",
  mcp__clack__close_pr: "Closing pull request",
  mcp__clack__report_status: null, // Final status, not a step
};

// GitHub MCP tools with clean labels
const GITHUB_TOOL_LABELS: Record<string, LabelEntry> = {
  mcp__github__get_pull_request: "Reading pull request",
  mcp__github__get_pull_request_files: "Reading PR files",
  mcp__github__get_pull_request_status: "Checking PR status",
  mcp__github__get_pull_request_comments: "Reading PR comments",
  mcp__github__get_pull_request_reviews: "Reading PR reviews",
  mcp__github__create_pull_request_review: "Reviewing pull request",
  mcp__github__create_pull_request: "Creating pull request",
  mcp__github__merge_pull_request: "Merging pull request",
  mcp__github__update_pull_request: "Updating pull request",
  mcp__github__get_issue: "Reading issue",
  mcp__github__create_issue_comment: "Commenting on issue",
  mcp__github__list_issues: "Listing issues",
  mcp__github__search_code: "Searching code on GitHub",
  mcp__github__get_file_contents: "Reading file from GitHub",
};

// Sentry MCP tools
const SENTRY_TOOL_LABELS: Record<string, LabelEntry> = {
  mcp__sentry__search_issues: "Searching Sentry issues",
  mcp__sentry__search_events: "Searching Sentry events",
  mcp__sentry__search_issue_events: "Searching issue events",
  mcp__sentry__get_issue_details: "Reading Sentry issue",
  mcp__sentry__list_issues: "Listing Sentry issues",
  mcp__sentry__list_events: "Listing Sentry events",
  mcp__sentry__list_issue_events: "Listing issue events",
  mcp__sentry__update_issue: "Updating Sentry issue",
  mcp__sentry__analyze_issue_with_seer: "Analyzing issue with Seer",
  mcp__sentry__get_trace_details: "Reading trace details",
  mcp__sentry__get_event_attachment: "Reading event attachment",
  mcp__sentry__get_issue_tag_values: "Reading issue tags",
  mcp__sentry__find_organizations: "Finding Sentry organizations",
  mcp__sentry__find_projects: "Finding Sentry projects",
  mcp__sentry__find_releases: "Finding Sentry releases",
  mcp__sentry__find_teams: "Finding Sentry teams",
  mcp__sentry__find_dsns: "Finding DSNs",
  mcp__sentry__create_project: "Creating Sentry project",
  mcp__sentry__create_team: "Creating Sentry team",
  mcp__sentry__create_dsn: "Creating DSN",
  mcp__sentry__update_project: "Updating Sentry project",
  mcp__sentry__search_docs: "Searching Sentry docs",
  mcp__sentry__get_doc: "Reading Sentry docs",
  mcp__sentry__whoami: "Checking Sentry identity",
};

// Statsig MCP tools (read-only)
const STATSIG_TOOL_LABELS: Record<string, LabelEntry> = {
  mcp__statsig__Get_Audit_Logs: "Reading Statsig audit logs",
  mcp__statsig__Get_List_of_Gates: "Listing feature gates",
  mcp__statsig__Get_Gate_Details_by_ID: (args) => `Reading gate ${statsigId(args)}`,
  mcp__statsig__Get_Gate_Results: (args) => `Reading gate results for ${statsigId(args)}`,
  mcp__statsig__Get_List_of_Experiments: "Listing experiments",
  mcp__statsig__Get_Experiment_Details_by_ID: (args) => `Reading experiment ${statsigId(args)}`,
  mcp__statsig__Get_Experiment_Results: (args) => `Reading experiment results for ${statsigId(args)}`,
  mcp__statsig__Get_List_of_Dynamic_Configs: "Listing dynamic configs",
  mcp__statsig__Get_Dynamic_Config_Details_by_ID: (args) => `Reading dynamic config ${statsigId(args)}`,
  mcp__statsig__Get_List_of_Layers: "Listing layers",
  mcp__statsig__Get_Layer_Details_by_ID: (args) => `Reading layer ${statsigId(args)}`,
  mcp__statsig__Get_List_of_Metrics: "Listing metrics",
  mcp__statsig__Get_Metric_Definition_by_ID: (args) => `Reading metric ${statsigId(args)}`,
  mcp__statsig__Get_List_of_Metric_Sources: "Listing metric sources",
  mcp__statsig__Get_List_of_Segments: "Listing segments",
  mcp__statsig__Get_Segment_Details_by_ID: (args) => `Reading segment ${statsigId(args)}`,
};

/** Prefix-based fallbacks for tool families */
const PREFIX_LABELS: [string, string][] = [
  ["mcp__sentry__", "Checking Sentry"],
  ["mcp__statsig__", "Checking Statsig feature flags"],
  ["mcp__github__", "Checking GitHub"],
];

/**
 * Get a human-readable label for a tool call.
 * Returns null if the tool should be excluded from task cards.
 */
export function getToolLabel(toolName: string, toolArgs: Record<string, unknown>): string | null {
  const entry = TOOL_LABELS[toolName];
  if (entry === null) return null;
  if (typeof entry === "function") return entry(toolArgs);
  if (typeof entry === "string") return entry;

  // Check named MCP tool maps
  for (const map of [GITHUB_TOOL_LABELS, SENTRY_TOOL_LABELS, STATSIG_TOOL_LABELS]) {
    const entry = map[toolName];
    if (entry !== undefined) {
      return typeof entry === "function" ? entry(toolArgs) : entry;
    }
  }

  // Check prefix-based fallbacks
  for (const [prefix, label] of PREFIX_LABELS) {
    if (toolName.startsWith(prefix)) return label;
  }

  // Generic MCP tool fallback: "mcp__foo__do_something" → "Checking Foo"
  const mcpMatch = toolName.match(/^mcp__([^_]+)__/);
  if (mcpMatch) {
    const server = mcpMatch[1].charAt(0).toUpperCase() + mcpMatch[1].slice(1);
    return `Checking ${server}`;
  }

  return `Running ${toolName}`;
}

/**
 * Get grouping info for a tool call.
 * Returns null if the tool should not be grouped (gets its own individual task).
 */
export function getToolGroup(toolName: string, toolArgs: Record<string, unknown>): ToolGroupInfo | null {
  switch (toolName) {
    case "Read":
      return { key: "search", title: "Searching codebase", itemDetail: shortenPath(toolArgs.file_path) || "file" };
    case "Glob":
      return { key: "search", title: "Searching codebase", itemDetail: typeof toolArgs.pattern === "string" ? truncate(toolArgs.pattern, 30) : "files" };
    case "Grep":
      return { key: "search", title: "Searching codebase", itemDetail: typeof toolArgs.pattern === "string" ? `"${truncate(toolArgs.pattern, 30)}"` : "search" };
    case "Edit":
      return { key: "edit", title: "Editing files", itemDetail: shortenPath(toolArgs.file_path) || "file" };
    case "Write":
      return { key: "write", title: "Writing files", itemDetail: shortenPath(toolArgs.file_path) || "file" };
    case "Bash":
      return { key: "bash", title: "Running commands", itemDetail: bashItemDetail(toolArgs) };
    default:
      if (toolName.startsWith("mcp__github__")) {
        return { key: "github", title: "Checking GitHub", itemDetail: toolName.replace("mcp__github__", "") };
      }
      return null;
  }
}

/**
 * Get mrkdwn-rich details for a tool call (shown in the details field of task cards).
 * Returns null if no contextual details are available.
 */
export function getToolDetails(toolName: string, toolArgs: Record<string, unknown>): string | null {
  // Slack channel link
  if (toolName === "mcp__clack__fetch_channel_messages") {
    const channel = typeof toolArgs.channel_id === "string" ? toolArgs.channel_id : "";
    return channel ? `<#${channel}>` : null;
  }

  // Slack message link
  if (toolName === "mcp__clack__fetch_slack_message") {
    const url = typeof toolArgs.url === "string" ? toolArgs.url : "";
    return url ? `<${url}|View message>` : null;
  }

  // GitHub PR link
  if (toolName.startsWith("mcp__github__") && toolName.includes("pull_request")) {
    return prLink(toolArgs);
  }

  return null;
}

/** Format a clickable PR link from GitHub MCP tool args: <url|owner/repo#123> */
function prLink(args: Record<string, unknown>): string | null {
  const owner = typeof args.owner === "string" ? args.owner : "";
  const repo = typeof args.repo === "string" ? args.repo : "";
  const num = typeof args.pullNumber === "number" ? args.pullNumber : 0;
  if (!owner || !repo || !num) return null;
  return `<https://github.com/${owner}/${repo}/pull/${num}|${owner}/${repo}#${num}>`;
}

function statsigId(args: Record<string, unknown>): string {
  const id = args.id ?? args.name ?? args.gate_id ?? args.experiment_id ?? args.config_id ?? "";
  return typeof id === "string" && id ? truncate(id, 40) : "…";
}

function bashItemDetail(args: Record<string, unknown>): string {
  const desc = typeof args.description === "string" ? args.description : "";
  if (desc) return truncate(desc, 40);
  const cmd = typeof args.command === "string" ? truncate(args.command, 40) : "";
  return cmd || "command";
}

function shortenPath(value: unknown): string {
  if (typeof value !== "string") return "";
  // Show last 2 path segments for readability
  const parts = value.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : value;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 1) + "…" : str;
}
