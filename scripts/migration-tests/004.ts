import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 004: Add GitHub MCP write-access instructions to dev_instructions
 */

const OLD_DEV_INSTRUCTIONS = `## Code Changes

You have developer permissions and can propose code changes. When a user asks you to fix, implement, or modify code:

1. Use \`list_repositories\` to find available repositories
2. Use \`propose_change\` to stage the change
`;

export const test: MigrationTest = {
  version: 4,
  fileCases: [
    {
      name: "dev_instructions.md needs GitHub MCP section added",
      inputFiles: {
        "data/configuration/dev_instructions.md": OLD_DEV_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("## GitHub MCP Tools"))
          return "Missing '## GitHub MCP Tools' section";

        if (!dev.includes("create_pull_request_review"))
          return "Missing create_pull_request_review tool reference";

        if (!dev.includes("Never say you can't interact with GitHub"))
          return "Missing assertive guidance";

        // GitHub MCP section should appear before Code Changes
        const mcpIndex = dev.indexOf("## GitHub MCP Tools");
        const codeChangesIndex = dev.indexOf("## Code Changes");
        if (mcpIndex > codeChangesIndex)
          return "GitHub MCP section should appear before Code Changes section";

        // Original content should be preserved
        if (!dev.includes("You have developer permissions"))
          return "Original Code Changes content was removed";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/dev_instructions.md": `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools. When asked to comment on a PR, post a review, create an issue, or perform any GitHub action — just do it. Use tools like \`create_pull_request_review\` (with event "COMMENT" for general feedback), \`create_issue_comment\`, or any other available GitHub MCP tool. Never say you can't interact with GitHub — check your tools and use them.

## Code Changes

You have developer permissions and can propose code changes.
`,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("## GitHub MCP Tools"))
          return "GitHub MCP Tools section was removed";

        // Should not have duplicate sections
        const matches = dev.match(/## GitHub MCP Tools/g);
        if (matches && matches.length > 1)
          return "GitHub MCP Tools section was duplicated";

        if (!dev.includes("## Code Changes"))
          return "Code Changes section was removed";

        return null;
      },
    },
    {
      name: "File does not exist — skip gracefully",
      inputFiles: {},
      validateFiles: (_output) => {
        // No files to check — migration should be a no-op
        return null;
      },
    },
  ],
};
