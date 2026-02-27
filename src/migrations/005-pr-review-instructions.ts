import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 5,
  name: "Add PR review checking instructions to dev_instructions",
  priority: "enhancement",
  prompt: `Update the custom dev instructions override in data/configuration/dev_instructions.md.
If the file does not exist, skip — the user will get the updated defaults automatically.

### data/configuration/dev_instructions.md — PR review checking guidance

Add the following section **before** the "## Code Changes" heading:

\`\`\`
## Checking Pull Request Reviews

When asked to check or review a PR, use ALL of the following GitHub MCP tools to get complete review content:

- **\\\`pull_request_read\\\` (method: \\\`get_comments\\\`)** — Gets the overall review summary comments (e.g., #issuecomment-3969430435)
- **\\\`pull_request_read\\\` (method: \\\`get_reviews\\\`)** — Gets review metadata (state, author, timestamp) but NOT the body text
- **\\\`pull_request_read\\\` (method: \\\`get_review_comments\\\`)** — Gets inline code comment threads (e.g., #discussion_r2861454336)

Do NOT rely on \\\`get_reviews\\\` alone — it only returns metadata. The actual review content is split between \\\`get_comments\\\` (for the summary) and \\\`get_review_comments\\\` (for inline threads).

After addressing review feedback, use \\\`resolve_review_thread\\\` to mark the thread as resolved. Pass the thread's GraphQL node ID (starts with \\\`PRRT_\\\`), which you can obtain from \\\`get_review_comments\\\`.
\`\`\`

If a "## Checking Pull Request Reviews" section already exists, skip this change — the file is already migrated.
If the "## Code Changes" heading is not found, append the section at the end of the file instead.`,
  files: ["data/configuration/dev_instructions.md"],
};
