import type { Migration } from "./types.js";

/**
 * Claude-powered migration that classifies user instruction files into two buckets:
 *
 *   1. **General / trigger** (stays in the baseline `{role}/*.md`): when-to-use hints,
 *      topic routing, "if the user mentions X, attach Y integration". Loaded every turn
 *      so Claude knows which integrations exist and when to reach for them.
 *
 *   2. **Specific / how-to** (moves to `{role}/topics/<mcp-name>/*.md`): MCP tool names,
 *      call signatures, example queries, environment-specific IDs/URLs, step-by-step
 *      workflows that only make sense once the tool is attached. Loaded lazily when
 *      `attach_integration("<mcp-name>")` activates the topic.
 *
 * Runs as a `prompt` migration because the classification requires semantic judgment —
 * static string-matching is brittle on operator-authored prose.
 *
 * The `files` list enumerates every source and destination path this migration might
 * touch. Files not present on disk are surfaced to Claude as "does not exist yet" and
 * left untouched. Operators with files outside this list can re-run the reclassification
 * manually or author a follow-up migration.
 */

export const migration: Migration = {
  version: 17,
  name: "Split instruction files into general triggers (baseline) and topic-specific how-tos",
  priority: "enhancement",
  prompt: `Reclassify the user instruction override files for Clack's lazy-MCP-loading architecture.

## Background

Clack now supports two instruction layers per role:

- **Baseline** (\`data/configuration/{role}/*.md\`): always loaded on every turn. Claude sees this content at all times.
- **Topic** (\`data/configuration/{role}/topics/<mcp-name>/*.md\`): loaded only when Claude calls \`attach_integration("<mcp-name>")\` mid-session.

Because topic content is NOT loaded by default, operators need their baseline files to contain enough routing information for Claude to know *which* integration to attach for a given question. Tool usage details, example API calls, environment-specific IDs and URLs — those belong in topic files since they only make sense once the tool is attached.

## Classification Rule

For every \`.md\` file listed below, examine each section (typically introduced by a \`#\` or \`##\` heading). Classify each section into one of two buckets:

### Bucket A — General / Trigger (BASELINE)

Content that tells Claude **when to reach for an integration, what question patterns match, and which \`attach_integration(...)\` call to make**. Keep this in the baseline. Examples:

- "When users ask about analytics dashboards or business metrics → call \`attach_integration("metabase")\` first, then use the Metabase tools."
- "If the user mentions a Sentry alert, an issue ID, or pastes a sentry.io URL, attach the \`sentry\` integration before investigating."
- "For 'when can we ship?' or release questions, attach \`monday\` to check the roadmap board."
- Routing tables that match URLs/keywords to integration names.
- High-level product or team context ("we use Monday for roadmap, Asana for engineering tasks").

### Bucket B — Specific / How-To (TOPIC)

Content that only makes sense **once the tools are available in the session**. Move this into \`data/configuration/{role}/topics/<mcp-name>/<filename>\`. Examples:

- Tool names and call signatures (e.g., \`mcp__metabase__search\`, \`mcp__sentry__get_issue\`).
- Example SQL queries, API call arguments, expected payload shapes.
- Environment-specific identifiers: database IDs, table names, workspace/org IDs, dashboard URLs, production project slugs.
- Step-by-step workflows that reference those tool names (e.g., "1. search → 2. retrieve → 3. execute").
- Sample input/output pairs.

## Where to Put Things

1. **Figure out which MCP server each file is about.** Read \`data/mcp.json\` (provided below in system prompt). The keys are the server names — \`sentry\`, \`metabase\`, \`asana\`, \`hubspot\`, \`monday\`, \`gcp-observability\`, etc. A file named \`metabase.md\` is about \`metabase\`; a file named \`applauz-hubspot.md\` is about \`hubspot\`; a file named \`monday-integration.md\` is about \`monday\`; a file named \`scheduled-messages.md\` is about \`scheduling\` (instructions-only topic, no MCP server — still valid).

   If a file is NOT clearly about any single MCP server (e.g., \`investigation-depth.md\`, \`humor.md\`, \`response-style.md\`, personas, general policies), leave it completely untouched. These are general baseline files that don't need splitting.

2. **For integration-specific files** (either at baseline \`{role}/<name>.md\` or already under \`{role}/topics/<mcp>/<name>.md\`):

   a. **If the file is pure Bucket B** (all tool usage / examples / env specifics), move the whole file to \`data/configuration/{role}/topics/<mcp-name>/<filename>\`. If it's already there, leave it in place.

   b. **If the file is pure Bucket A** (all routing/trigger), keep it at baseline \`data/configuration/{role}/<filename>\`. If it's currently under \`topics/\`, move it back to baseline.

   c. **If the file is mixed** (both buckets), split it:
      - Write a trimmed baseline file at \`data/configuration/{role}/<filename>\` containing only Bucket A content. Include an explicit "use \`attach_integration("<mcp-name>")\` when…" line if the original didn't have one.
      - Write a topic file at \`data/configuration/{role}/topics/<mcp-name>/<filename>\` containing only Bucket B content. Start with a brief header noting what this topic covers.
      - Delete the original's Bucket B content from its existing location.

3. **Preserve operator tone and wording.** Don't rephrase, don't paraphrase. Move sections as-is, only adjusting to add the \`attach_integration(...)\` trigger line where it's missing.

4. **Re-run safety.** If the target destination already contains content that looks like a previous migration output (e.g., already has the \`attach_integration\` trigger line, or baseline is already stripped of tool names), SKIP that file — do not overwrite.

## What to Ignore

- Files that are not about any MCP server: leave them alone.
- Files with no clear ## / # section breaks: treat as a single section and classify the whole file.
- \`data/default_configuration/\` files: read-only for comparison (you may not modify them).

## Output

Write the new/updated files via the Write tool. Delete the old file only when you've successfully moved its content elsewhere and the old location should no longer exist. The migration engine will call Read/Write for you — you have access only to the files explicitly listed.

Do not emit any free-form text response except a terse summary of what moved.`,
  files: [
    // Reference: the MCP server registry (read-only for classification).
    "data/mcp.json",
    // Source baseline files (may need splitting).
    "data/configuration/user/applauz-hubspot.md",
    "data/configuration/user/applauz.md",
    "data/configuration/user/asana-context.md",
    "data/configuration/user/gcp-logs.md",
    "data/configuration/user/github-applauz.md",
    "data/configuration/user/hockey-sports-analyst.md",
    "data/configuration/user/humor.md",
    "data/configuration/user/investigation-depth.md",
    "data/configuration/user/jonathan-persona.md",
    "data/configuration/user/metabase.md",
    "data/configuration/user/monday-integration.md",
    "data/configuration/user/nth.md",
    "data/configuration/user/perks.md",
    "data/configuration/user/response-style.md",
    "data/configuration/user/scheduled-messages.md",
    "data/configuration/user/sentry.md",
    "data/configuration/user/urls-admin.md",
    "data/configuration/user/when-not-to-respond.md",
    // Existing topic files (may need splitting back out to baseline).
    "data/configuration/user/topics/asana/asana-context.md",
    "data/configuration/user/topics/gcp-observability/gcp-logs.md",
    "data/configuration/user/topics/hubspot/applauz-hubspot.md",
    "data/configuration/user/topics/metabase/metabase.md",
    "data/configuration/user/topics/monday/monday-integration.md",
    "data/configuration/user/topics/scheduling/scheduled-messages.md",
    "data/configuration/user/topics/sentry/sentry.md",
  ],
};
