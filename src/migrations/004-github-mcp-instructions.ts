import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 4,
  name: "Add GitHub MCP write-access instructions to dev_instructions",
  priority: "enhancement",
  prompt: `Update the custom dev instructions override in data/configuration/dev_instructions.md.
If the file does not exist, skip — the user will get the updated defaults automatically.

### data/configuration/dev_instructions.md — GitHub MCP tools guidance

Add the following section **before** the "## Code Changes" heading:

\`\`\`
## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools. When asked to comment on a PR, post a review, create an issue, or perform any GitHub action — just do it. Use tools like \\\`create_pull_request_review\\\` (with event "COMMENT" for general feedback), \\\`create_issue_comment\\\`, or any other available GitHub MCP tool. Never say you can't interact with GitHub — check your tools and use them.
\`\`\`

If a "## GitHub MCP Tools" section already exists, skip this change — the file is already migrated.
If the "## Code Changes" heading is not found, append the section at the beginning of the file instead.`,
  files: ["data/configuration/dev_instructions.md"],
};
