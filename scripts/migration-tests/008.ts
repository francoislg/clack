import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 008: split flat instruction overrides into cascading role directories
 */

// A customized instructions.md — has custom URL patterns and a custom identity tweak
const CUSTOMIZED_INSTRUCTIONS = `You are a **product expert** for Acme Corp, not a developer. You understand how the product works from a user's perspective. When you investigate code, you translate technical implementation into plain-English explanations that anyone on the team can understand.

You have access to clack tools that let you query repositories, active change sessions, and configuration files. Use the \`list_repositories\` tool to discover available repositories when needed.

You also have access to MCP integrations — use them to read and write data when relevant to the question.

While you cannot modify code directly, you CAN and SHOULD use MCP tools to take actions (e.g. create/update Linear tickets, query external services) when the user asks.

## URLs and MCP Tools
When messages contain URLs, check whether one of your available MCP integrations can fetch data for that service. Match the URL's domain to your MCP tools and call the appropriate tool directly — never try to open or fetch URLs.

URL parsing patterns:
- **Sentry** (\`*.sentry.io\`): \`https://{org}.sentry.io/issues/{issueId}\` → \`get_issue_details(organization_slug="{org}", issueId="{issueId}")\`
- **GitHub** (\`github.com\`): \`https://github.com/{owner}/{repo}/pull/{number}\` → \`get_pull_request(owner, repo, pullNumber)\`
- **GitHub issue**: \`https://github.com/{owner}/{repo}/issues/{number}\` → \`get_issue(owner, repo, issueNumber)\`
- **Datadog** (\`app.datadoghq.com\`): \`https://app.datadoghq.com/dashboard/{dashId}\` → \`get_dashboard(dashboard_id="{dashId}")\`

## How to Respond
- Give the answer directly. No preamble.
- Keep it short and to-the-point.
- **CRITICAL: Translate all technical findings into plain language.**
- Think of yourself as a translator: you READ code, but you SPEAK business.

## Critical: No Hallucination
- ONLY describe features that you have directly verified in the codebase.

## Investigate the Codebase SILENTLY
- Explore the code to understand how it works before answering.
- **CRITICAL: Do NOT output any text while investigating.**

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool with:
- **sections**: Your answer content
- **actions**: Buttons for the user to interact with.

**\`send_to_thread\` content rule:** Each \`send_to_thread\` action requires a \`content\` field.
`;

// A customized user_instructions.md with extra rules
const CUSTOM_USER_INSTRUCTIONS = `## Critical: Information Only
- Never suggest code changes, fixes, or solutions that would require modifying the codebase.
- Do not offer action buttons or choices related to fixing, changing, or modifying code.
- Your role is to explain how things currently work, not to recommend what should change.

## Additional Rule
- Always include a link to the relevant documentation when available.
`;

// A customized dev_instructions.md
const CUSTOM_DEV_INSTRUCTIONS = `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools.

## Code Changes

You have developer permissions and can propose code changes.
Use \`propose_change\` to stage changes.

### Auto-execute
Use \`auto: true\` when the user gives a clear directive.
`;

// Dev instructions with a custom section that should get its own file
const DEV_INSTRUCTIONS_WITH_CUSTOM_SECTION = `## GitHub MCP Tools

You have read AND write access to GitHub through MCP tools.

## Code Changes

You have developer permissions and can propose code changes.
Use \`propose_change\` to stage changes.

### Auto-execute
Use \`auto: true\` when the user gives a clear directive.

## Deployment Checklist

Before merging any PR that touches infrastructure:
1. Verify staging deploy succeeded
2. Check CloudWatch alarms are green
3. Notify #deployments channel

Always include the deploy checklist link in the PR description.
`;

// Admin instructions with extra custom section
const CUSTOM_ADMIN_INSTRUCTIONS = `## Configuration Updates

You can update bot configuration files when asked.

**Workflow:**
1. Use \`list_config_files\` to find the file
2. Use \`read_config_file\` to read its current content
3. Use \`propose_config_update\` to stage the update

## Team-Specific Rules
- Notify #ops channel when making config changes
- Always tag config changes with the requester's name
`;

// user_instructions.md that is identical to the default — should be skipped
const DEFAULT_USER_INSTRUCTIONS = `## Critical: Information Only
- Never suggest code changes, fixes, or solutions that would require modifying the codebase.
- Do not offer action buttons or choices related to fixing, changing, or modifying code (e.g. "Fix this bug", "Apply fix"). Only developers can request changes.
- Your role is to explain how things currently work, not to recommend what should change.
- If asked "how do I fix X?", explain what X does and why it behaves that way—do not propose code modifications.
`;

export const test: MigrationTest = {
  version: 8,
  fileCases: [
    {
      name: "Splits customized instructions.md into topic files",
      inputFiles: {
        "data/configuration/instructions.md": CUSTOMIZED_INSTRUCTIONS,
      },
      additionalOutputPaths: [
        "data/configuration/user/identity.md",
        "data/configuration/user/urls.md",
        "data/configuration/user/response-style.md",
        "data/configuration/user/information-guardrails.md",
        "data/configuration/user/submit-response.md",
        "data/configuration/user/instructions.md",
        "data/configuration/user/custom-rules.md",
      ],
      validateFiles: (output) => {
        // Old file should be deleted
        if (output["data/configuration/instructions.md"]) return "Old instructions.md still exists";

        // Key customizations should be preserved somewhere in the new files
        const allNewContent = Object.entries(output)
          .filter(([k]) => k.startsWith("data/configuration/user/"))
          .map(([, v]) => v)
          .join("\n");

        if (!allNewContent) return "No new user/ files were created";

        // The Acme Corp identity customization must be preserved
        if (!allNewContent.includes("Acme Corp"))
          return "Custom identity ('Acme Corp') was lost during split";

        // The Datadog URL pattern must be preserved
        if (!allNewContent.includes("Datadog") && !allNewContent.includes("datadoghq"))
          return "Custom URL pattern (Datadog) was lost during split";

        return null;
      },
    },
    {
      name: "Migrates customized user_instructions.md to user/changes.md",
      inputFiles: {
        "data/configuration/user_instructions.md": CUSTOM_USER_INSTRUCTIONS,
      },
      additionalOutputPaths: [
        "data/configuration/user/changes.md",
        "data/configuration/user/instructions.md",
      ],
      validateFiles: (output) => {
        if (output["data/configuration/user_instructions.md"])
          return "Old user_instructions.md still exists";

        const allNewContent = Object.entries(output)
          .filter(([k]) => k.startsWith("data/configuration/user/"))
          .map(([, v]) => v)
          .join("\n");

        if (!allNewContent) return "No new user/ files were created";

        // Custom content must be preserved
        if (!allNewContent.includes("Additional Rule"))
          return "Custom 'Additional Rule' section was lost";
        if (!allNewContent.includes("documentation when available"))
          return "Custom documentation rule was lost";

        return null;
      },
    },
    {
      name: "Migrates dev_instructions.md into dev/ directory",
      inputFiles: {
        "data/configuration/dev_instructions.md": CUSTOM_DEV_INSTRUCTIONS,
      },
      additionalOutputPaths: [
        "data/configuration/dev/github.md",
        "data/configuration/dev/changes.md",
        "data/configuration/dev/instructions.md",
      ],
      validateFiles: (output) => {
        if (output["data/configuration/dev_instructions.md"])
          return "Old dev_instructions.md still exists";

        const allNewContent = Object.entries(output)
          .filter(([k]) => k.startsWith("data/configuration/dev/"))
          .map(([, v]) => v)
          .join("\n");

        if (!allNewContent) return "No new dev/ files were created";

        // Core dev content must be preserved
        if (!allNewContent.includes("propose_change")) return "propose_change reference was lost";
        if (!allNewContent.includes("auto: true")) return "Auto-execute section was lost";

        return null;
      },
    },
    {
      name: "Migrates admin_instructions.md preserving custom sections",
      inputFiles: {
        "data/configuration/admin_instructions.md": CUSTOM_ADMIN_INSTRUCTIONS,
      },
      scanDirs: ["data/configuration/admin"],
      validateFiles: (output) => {
        if (output["data/configuration/admin_instructions.md"])
          return "Old admin_instructions.md still exists";

        const allNewContent = Object.entries(output)
          .filter(([k]) => k.startsWith("data/configuration/admin/"))
          .map(([, v]) => v)
          .join("\n");

        if (!allNewContent) return "No new admin/ files were created";

        // Custom team-specific rules must be preserved
        if (
          !allNewContent.includes("Team-Specific Rules") &&
          !allNewContent.includes("#ops channel")
        )
          return "Custom team-specific rules were lost";

        return null;
      },
    },
    {
      name: "Skips override when content matches default (dedup)",
      inputFiles: {
        "data/configuration/user_instructions.md": DEFAULT_USER_INSTRUCTIONS,
      },
      additionalOutputPaths: ["data/configuration/user/changes.md"],
      validateFiles: (output) => {
        if (output["data/configuration/user_instructions.md"])
          return "Old user_instructions.md still exists";

        // The content is identical to the default — no override should be created
        if (output["data/configuration/user/changes.md"])
          return "user/changes.md was created but content matches default — should have been skipped";

        return null;
      },
    },
    {
      name: "Custom sections get descriptive file names, not custom-rules.md",
      inputFiles: {
        "data/configuration/dev_instructions.md": DEV_INSTRUCTIONS_WITH_CUSTOM_SECTION,
      },
      scanDirs: ["data/configuration/dev"],
      validateFiles: (output) => {
        if (output["data/configuration/dev_instructions.md"])
          return "Old dev_instructions.md still exists";

        const devFiles = Object.keys(output).filter((k) => k.startsWith("data/configuration/dev/"));

        if (devFiles.length === 0) return "No new dev/ files were created";

        // The Deployment Checklist section must exist somewhere
        const allContent = devFiles.map((k) => output[k]).join("\n");
        if (!allContent.includes("Deployment Checklist"))
          return "Deployment Checklist section was lost";

        // It should NOT be in a generic "custom-rules.md" — it should have a descriptive name
        if (output["data/configuration/dev/custom-rules.md"]?.includes("Deployment Checklist"))
          return "Deployment Checklist was dumped into generic custom-rules.md instead of a descriptive file name";

        return null;
      },
    },
    {
      name: "No duplicate content across output files",
      inputFiles: {
        "data/configuration/dev_instructions.md": DEV_INSTRUCTIONS_WITH_CUSTOM_SECTION,
      },
      scanDirs: ["data/configuration/dev"],
      validateFiles: (output) => {
        const devFiles = Object.entries(output).filter(([k]) =>
          k.startsWith("data/configuration/dev/"),
        );

        // Check that "Deployment Checklist" appears in exactly one file
        const filesWithHomo = devFiles.filter(([, content]) =>
          content.includes("Deployment Checklist"),
        );
        if (filesWithHomo.length === 0) return "Deployment Checklist section was lost entirely";
        if (filesWithHomo.length > 1)
          return `Deployment Checklist is duplicated across ${filesWithHomo.length} files: ${filesWithHomo.map(([k]) => k).join(", ")}`;

        return null;
      },
    },
    {
      name: "Already migrated — new files exist, old files gone — no-op",
      inputFiles: {
        "data/configuration/user/identity.md": "Custom identity content",
        "data/configuration/user/changes.md": "Custom changes content",
      },
      validateFiles: (output) => {
        const identity = output["data/configuration/user/identity.md"];
        if (!identity) return "user/identity.md was removed";
        if (!identity.includes("Custom identity content"))
          return "user/identity.md content was modified";

        const changes = output["data/configuration/user/changes.md"];
        if (!changes) return "user/changes.md was removed";
        if (!changes.includes("Custom changes content"))
          return "user/changes.md content was modified";

        return null;
      },
    },
    {
      name: "No custom overrides — nothing to migrate",
      inputFiles: {},
      validateFiles: (_output) => {
        return null;
      },
    },
  ],
};
