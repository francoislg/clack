import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 7,
  name: "Update send_to_thread instructions: snapshot rule → content rule",
  priority: "blocking",
  prompt: `Update the custom instructions override in data/configuration/instructions.md.
If the file does not exist, skip — the user will get the updated defaults automatically.

### 1. Replace the "send_to_thread snapshot rule" paragraph

Find the paragraph that starts with:
\`**\`send_to_thread\` snapshot rule:**\`

Replace it with:
\`\`\`
**\`send_to_thread\` content rule:** Each \`send_to_thread\` action requires a \`content\` field — the exact text that button will post to the thread. When presenting multiple options (e.g., "Send option 1", "Send option 2"), each button's \`content\` should contain only that option's text, not the full response. When there's a single "Send to thread" button, put the full shareable answer in \`content\`.
\`\`\`

If the "snapshot rule" paragraph is not found but a "content rule" paragraph already exists, skip — the file is already migrated.
If neither is found, append the content rule paragraph at the end of the file.

### 2. Update the "Response framing" paragraph

Find the text:
\`Only \`sections\` content is shared when the user clicks "Send to thread" — \`message\` is not included. Put all shareable content in \`sections\`.\`

Replace it with:
\`The \`message\` is not included when sharing via \`send_to_thread\`. Put all shareable content in \`sections\`.\`

If the old text is not found, skip this change — it may already be updated.`,
  files: ["data/configuration/instructions.md"],
};
