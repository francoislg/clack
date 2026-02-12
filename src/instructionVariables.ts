export interface VariableDefinition {
  /** Variable key used in instruction files, e.g. "REPOSITORIES_LIST" */
  name: string;
  /** Human-readable description */
  description: string;
  /** "always" = available in all instruction files, "dev-admin" = only meaningful in dev/admin instructions */
  availability: "always" | "dev-admin";
}

/**
 * Centralized registry of all instruction template variables.
 * This is the single source of truth for what variables exist, what they do,
 * and when they're available.
 */
export const variableRegistry: VariableDefinition[] = [
  {
    name: "REPOSITORIES_LIST",
    description: "Formatted list of configured repositories",
    availability: "always",
  },
  {
    name: "BOT_NAME",
    description: "The bot's display name (e.g., \"Clack\")",
    availability: "always",
  },
  {
    name: "MCP_INTEGRATIONS",
    description: "List of configured MCP server names",
    availability: "always",
  },
  {
    name: "CHANGE_REQUEST_BLOCK",
    description: "Change request detection guidelines and output format",
    availability: "dev-admin",
  },
  {
    name: "RESUMABLE_SESSIONS",
    description: "Active resumable change sessions",
    availability: "dev-admin",
  },
  {
    name: "AVAILABLE_VARIABLES",
    description: "Auto-generated reference table of all available variables",
    availability: "dev-admin",
  },
];

/**
 * Build a markdown table documenting all available variables.
 * Excludes AVAILABLE_VARIABLES itself to avoid self-reference.
 */
export function buildAvailableVariablesTable(): string {
  const rows = variableRegistry
    .filter((v) => v.name !== "AVAILABLE_VARIABLES")
    .map((v) => {
      const available = v.availability === "always" ? "Always" : "Dev/admin instructions only";
      return `> | \`{${v.name}}\` | ${v.description} | ${available} |`;
    })
    .join("\n");

  return `> **Note for admins editing instruction files:**
> The following variables are automatically replaced when instructions are loaded. You can use them in any instruction file:
>
> | Variable | Description | Available |
> |----------|-------------|-----------|
${rows}
>
> Variables not available in the current context resolve to empty text.`;
}
