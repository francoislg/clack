import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 3,
  name: "Add auto-execute guidance to admin instructions and config_update to dev instructions",
  priority: "blocking",
  prompt: `Update custom instruction override files in data/configuration/ with auto-execute guidance.
If a file does not exist, skip it — the user will get the updated defaults automatically.

### 1. data/configuration/admin_instructions.md — Add auto-execute section

This file is missing the \`### Auto-execute\` section entirely. Admin/owner users currently never see auto-execute guidance.

Find the line that contains:
\`offer a \\\`choice\\\` action (e.g. "Fix this bug")\`

If it does NOT already contain \`workMode: true\`, change it to:
\`offer a \\\`choice\\\` action (e.g. "Fix this bug") with \\\`workMode: true\\\` so the user can quickly request a fix\`

Then, immediately after that paragraph (before \`## Configuration Updates\`), insert the following section:

\`\`\`

### Auto-execute (\\\`auto: true\\\`)

You can set \\\`auto: true\\\` on any ref-based action (\\\`change\\\`, \\\`config_update\\\`, \\\`update\\\`, \\\`review\\\`, \\\`merge\\\`, \\\`close\\\`) to execute it immediately without a button click.

**Use \\\`auto: true\\\`** when the user gives a clear directive:
- "Fix this", "Do it", "Make this change"
- "Update the config to add X", "Add this instruction"
- "Merge it", "Merge the PR"
- "Close the PR"
- "Update the PR with this: ..."
- Any direct imperative where intent is unambiguous

**Do NOT use \\\`auto: true\\\`** when:
- The intent is ambiguous or could be a question
- You are proactively suggesting a change the user hasn't explicitly asked for
- The user's request is vague and you want to confirm scope first
\`\`\`

If the \`### Auto-execute\` section already exists, skip this change.

### 2. data/configuration/dev_instructions.md — Add config_update to auto-execute list

Find the line that contains:
\`You can set \\\`auto: true\\\` on any ref-based action (\\\`change\\\`, \\\`update\\\`, \\\`review\\\`, \\\`merge\\\`, \\\`close\\\`)\`

Replace it with:
\`You can set \\\`auto: true\\\` on any ref-based action (\\\`change\\\`, \\\`config_update\\\`, \\\`update\\\`, \\\`review\\\`, \\\`merge\\\`, \\\`close\\\`)\`

If \`config_update\` is already in the list, skip this change.`,
  files: ["data/configuration/admin_instructions.md", "data/configuration/dev_instructions.md"],
};
