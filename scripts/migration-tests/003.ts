import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 003: auto-execute guidance for admin + config_update for dev
 */

const OLD_ADMIN_INSTRUCTIONS = `## Code Changes

You have developer permissions and can propose code changes. When a user asks you to fix, implement, or modify code:

1. Use \`list_repositories\` to find available repositories
2. Use \`find_sessions\` to check for resumable change sessions
3. Use \`propose_change\` to stage the change with a branch name, description, and target repo
4. Include a \`change\` action in your \`submit_response\` so the user can approve

When the user wants to resume a previous session, use \`find_sessions\` to look it up, then \`propose_change\` with the same branch.

When uncertain whether the user is asking a question or requesting a change, default to answering the question. However, when your answer identifies a bug or issue, offer a \`choice\` action (e.g. "Fix this bug") so the user can quickly request a fix.

## Configuration Updates

You can update bot configuration files when asked.
`;

const OLD_DEV_INSTRUCTIONS = `## Code Changes

You have developer permissions and can propose code changes.

When uncertain whether the user is asking a question or requesting a change, default to answering the question. However, when your answer identifies a bug or issue, offer a \`choice\` action (e.g. "Fix this bug") with \`workMode: true\` so the user can quickly request a fix.

### Auto-execute (\`auto: true\`)

You can set \`auto: true\` on any ref-based action (\`change\`, \`update\`, \`review\`, \`merge\`, \`close\`) to execute it immediately without a button click.

**Use \`auto: true\`** when the user gives a clear directive:
- "Fix this", "Do it", "Make this change"
- "Merge it", "Merge the PR"
- "Close the PR"
- "Update the PR with this: ..."
- Any direct imperative where intent is unambiguous

**Do NOT use \`auto: true\`** when:
- The intent is ambiguous or could be a question
- You are proactively suggesting a change the user hasn't explicitly asked for
- The user's request is vague and you want to confirm scope first
`;

export const test: MigrationTest = {
  version: 3,
  fileCases: [
    {
      name: "Both files need updating",
      inputFiles: {
        "data/configuration/admin_instructions.md": OLD_ADMIN_INSTRUCTIONS,
        "data/configuration/dev_instructions.md": OLD_DEV_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const admin = output["data/configuration/admin_instructions.md"];
        if (!admin) return "admin_instructions.md missing from output";

        // Should have auto-execute section
        if (!admin.includes("### Auto-execute"))
          return "Missing '### Auto-execute' section in admin_instructions";
        if (!admin.includes("config_update"))
          return "Missing 'config_update' in admin auto-execute list";
        if (!admin.includes("auto: true"))
          return "Missing 'auto: true' reference in admin_instructions";

        // workMode should be added
        if (!admin.includes("workMode: true"))
          return "Missing 'workMode: true' in admin_instructions";

        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        // Should have config_update in the list
        if (!dev.includes("config_update"))
          return "Missing 'config_update' in dev auto-execute list";

        return null;
      },
    },
    {
      name: "Only admin_instructions.md exists (no dev override)",
      inputFiles: {
        "data/configuration/admin_instructions.md": OLD_ADMIN_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const admin = output["data/configuration/admin_instructions.md"];
        if (!admin) return "admin_instructions.md missing from output";

        if (!admin.includes("### Auto-execute")) return "Missing '### Auto-execute' section";
        if (!admin.includes("config_update")) return "Missing 'config_update' in auto-execute list";

        return null;
      },
    },
    {
      name: "Only dev_instructions.md exists (no admin override)",
      inputFiles: {
        "data/configuration/dev_instructions.md": OLD_DEV_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("config_update"))
          return "Missing 'config_update' in dev auto-execute list";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/admin_instructions.md": `## Code Changes

When uncertain, offer a \`choice\` action (e.g. "Fix this bug") with \`workMode: true\` so the user can quickly request a fix.

### Auto-execute (\`auto: true\`)

You can set \`auto: true\` on any ref-based action (\`change\`, \`config_update\`, \`update\`, \`review\`, \`merge\`, \`close\`) to execute it immediately without a button click.

## Configuration Updates
`,
        "data/configuration/dev_instructions.md": `## Code Changes

### Auto-execute (\`auto: true\`)

You can set \`auto: true\` on any ref-based action (\`change\`, \`config_update\`, \`update\`, \`review\`, \`merge\`, \`close\`) to execute it immediately without a button click.
`,
      },
      validateFiles: (output) => {
        const admin = output["data/configuration/admin_instructions.md"];
        if (!admin) return "admin_instructions.md missing from output";

        if (!admin.includes("### Auto-execute"))
          return "Auto-execute section was removed from admin";
        if (!admin.includes("config_update")) return "config_update was removed from admin";

        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("config_update")) return "config_update was removed from dev";

        return null;
      },
    },
  ],
};
