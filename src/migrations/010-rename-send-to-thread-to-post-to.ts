import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 10,
  name: "Rename send_to_thread to post_to in instruction overrides",
  priority: "blocking",
  prompt: `Rename all references of \`send_to_thread\` to \`post_to\` in user instruction override files.

### 1. Update data/configuration/instructions.md (if it exists)

Find all occurrences of \`send_to_thread\` and replace with \`post_to\`.
Find all occurrences of "Send to thread" (as a button label) and replace with "Post to thread".

Specific patterns to look for:
- \`\`send_to_thread\`\` → \`\`post_to\`\`
- \`send_to_thread\` → \`post_to\`
- "Send to thread" → "Post to thread"

If the file does not exist, skip — the user will get the updated defaults automatically.
If the file already uses \`post_to\` and has no \`send_to_thread\` references, skip — already migrated.

### 2. Update data/configuration/user/submit-response.md (if it exists)

Apply the same replacements as step 1.
If the file does not exist, skip.
If already migrated, skip.

Preserve all other content and formatting exactly as-is.`,
  files: [
    "data/configuration/instructions.md",
    "data/configuration/user/submit-response.md",
  ],
};
