export interface VariableDefinition {
  /** Variable key used in instruction files, e.g. "BOT_NAME" */
  name: string;
  /** Human-readable description */
  description: string;
}

/**
 * Centralized registry of instruction template variables.
 * Dynamic state (repositories, sessions, config files) is now
 * queryable through clack MCP tools — only static config remains here.
 */
export const variableRegistry: VariableDefinition[] = [
  {
    name: "BOT_NAME",
    description: "The bot's display name (e.g., \"Clack\")",
  },
];
