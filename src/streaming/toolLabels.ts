/**
 * Maps tool names to human-readable labels for task card display.
 *
 * - String values are used as-is.
 * - Functions receive tool args and return a dynamic label.
 * - null means the tool is excluded from task cards (e.g., submit_response).
 */

type LabelEntry = string | ((args: Record<string, unknown>) => string) | null;

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
  Bash: "Running command",

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

/** Prefix-based fallbacks for tool families */
const PREFIX_LABELS: [string, string][] = [
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

  // Check prefix-based fallbacks
  for (const [prefix, label] of PREFIX_LABELS) {
    if (toolName.startsWith(prefix)) return label;
  }

  return `Running ${toolName}`;
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
