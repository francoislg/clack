import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 005: Add PR review checking instructions to dev_instructions
 */

const DEV_INSTRUCTIONS_WITHOUT_SECTION = `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools. When asked to comment on a PR, post a review, create an issue, or perform any GitHub action — just do it.

## Code Changes

You have developer permissions and can propose code changes.
`;

const DEV_INSTRUCTIONS_ALREADY_MIGRATED = `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools.

## Checking Pull Request Reviews

When asked to check or review a PR, use ALL of the following GitHub MCP tools to get complete review content:

- **\`pull_request_read\` (method: \`get_comments\`)** — Gets the overall review summary comments
- **\`pull_request_read\` (method: \`get_reviews\`)** — Gets review metadata (state, author, timestamp) but NOT the body text
- **\`pull_request_read\` (method: \`get_review_comments\`)** — Gets inline code comment threads

Do NOT rely on \`get_reviews\` alone — it only returns metadata.

After addressing review feedback, use \`resolve_review_thread\` to mark the thread as resolved. Pass the thread's GraphQL node ID (starts with \`PRRT_\`), which you can obtain from \`get_review_comments\`.

## Code Changes

You have developer permissions and can propose code changes.
`;

const DEV_INSTRUCTIONS_NO_CODE_CHANGES = `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools.
`;

export const test: MigrationTest = {
  version: 5,
  fileCases: [
    {
      name: "dev_instructions.md needs PR review section added before Code Changes",
      inputFiles: {
        "data/configuration/dev_instructions.md": DEV_INSTRUCTIONS_WITHOUT_SECTION,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("## Checking Pull Request Reviews"))
          return "Missing '## Checking Pull Request Reviews' section";

        if (!dev.includes("pull_request_read")) return "Missing pull_request_read tool reference";

        if (!dev.includes("get_comments")) return "Missing get_comments method reference";

        if (!dev.includes("get_review_comments"))
          return "Missing get_review_comments method reference";

        if (!dev.includes("Do NOT rely on")) return "Missing warning about get_reviews limitation";

        if (!dev.includes("resolve_review_thread"))
          return "Missing resolve_review_thread tool reference";

        // PR review section should appear before Code Changes
        const reviewIndex = dev.indexOf("## Checking Pull Request Reviews");
        const codeChangesIndex = dev.indexOf("## Code Changes");
        if (codeChangesIndex !== -1 && reviewIndex > codeChangesIndex)
          return "PR review section should appear before Code Changes section";

        // Original content should be preserved
        if (!dev.includes("You have developer permissions"))
          return "Original Code Changes content was removed";

        if (!dev.includes("## GitHub MCP Tools")) return "GitHub MCP Tools section was removed";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/dev_instructions.md": DEV_INSTRUCTIONS_ALREADY_MIGRATED,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("## Checking Pull Request Reviews"))
          return "PR review section was removed";

        // Should not have duplicate sections
        const matches = dev.match(/## Checking Pull Request Reviews/g);
        if (matches && matches.length > 1) return "PR review section was duplicated";

        if (!dev.includes("## Code Changes")) return "Code Changes section was removed";

        return null;
      },
    },
    {
      name: "No Code Changes heading — appends at end",
      inputFiles: {
        "data/configuration/dev_instructions.md": DEV_INSTRUCTIONS_NO_CODE_CHANGES,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("## Checking Pull Request Reviews"))
          return "Missing '## Checking Pull Request Reviews' section";

        if (!dev.includes("pull_request_read")) return "Missing pull_request_read tool reference";

        if (!dev.includes("resolve_review_thread"))
          return "Missing resolve_review_thread tool reference";

        // Original content should be preserved
        if (!dev.includes("## GitHub MCP Tools")) return "GitHub MCP Tools section was removed";

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
