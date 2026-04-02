import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 8,
  name: "Split flat instruction overrides into cascading role directories",
  priority: "blocking",
  prompt: `Migrate custom instruction override files from the old flat structure to the new cascading role-directory structure.

## Context

The instruction system has been redesigned. Previously, there were flat files:
- \`instructions.md\` — monolithic base instructions (identity, URLs, response style, guardrails, submit_response, delivery context actions)
- \`user_instructions.md\` — user-level role instructions ("Information Only" restriction)
- \`dev_instructions.md\` — dev-level role instructions (GitHub MCP tools, code changes workflow, auto-execute)
- \`admin_instructions.md\` — admin-level role instructions (config updates, auto-execute for config)

Now, instructions are organized in role directories with topic-specific files:
- \`user/identity.md\` — product expert persona, tool access
- \`user/urls.md\` — URL → MCP tool mapping
- \`user/response-style.md\` — how to respond, investigate silently
- \`user/information-guardrails.md\` — no hallucination rules
- \`user/submit-response.md\` — submit_response usage, delivery context actions
- \`user/changes.md\` — "Information Only" restriction (overridden by dev/changes.md for devs)
- \`dev/github.md\` — GitHub MCP tools, PR review
- \`dev/changes.md\` — propose_change workflow, auto-execute
- \`admin/config-updates.md\` — config management, smart file placement

The corresponding default files are provided to you (prefixed with \`data/default_configuration/\`). These represent the shipped defaults.

## Migration Rules

These files are user customizations. Your job is to split them into the right new files, but ONLY if the resulting content meaningfully differs from the corresponding default file.

For each old file that exists:

### \`instructions.md\` (the monolithic base file)

Split this file into topic files. Identify sections by their ## headings and move them:
- Opening paragraphs (before any ## heading): identity/persona → \`user/identity.md\`
- "## URLs and MCP Tools" section → \`user/urls.md\`
- "## How to Respond" section → \`user/response-style.md\`
- "## Critical: No Hallucination" section → \`user/information-guardrails.md\`
- "## Investigate the Codebase SILENTLY" section → append to \`user/response-style.md\`
- "## Submitting Your Response" and everything below it (### subsections, delivery context, etc.) → \`user/submit-response.md\`
- Any sections that don't match the above → create a new file in \`user/\` with a descriptive kebab-case name derived from the section heading (e.g., "## Team Policies" → \`user/team-policies.md\`)

If you can't reliably identify sections (no clear ## headings), write the entire content to \`user/instructions.md\` as a safe fallback.

### \`user_instructions.md\`

This maps to \`user/changes.md\`. Before writing, compare the old file's content against \`data/default_configuration/user/changes.md\`. If the user's version contains the same rules as the default (even if it's missing some bullet points or has slightly different wording), SKIP writing — do not create the override file. Only write \`user/changes.md\` if the user added entirely new sections or substantially different rules that don't exist in the default.

### \`dev_instructions.md\`

Split by topic. Each section goes to EXACTLY ONE file — never write the same content to multiple files:
- "## GitHub MCP Tools" and "## Checking Pull Request Reviews" sections → \`dev/github.md\`
- "## Code Changes" section — ONLY up to the next ## heading (do NOT include subsequent ## sections) → \`dev/changes.md\`
- Any other ## sections that don't match the above → create a new file in \`dev/\` with a descriptive kebab-case name derived from the section heading (e.g., "## Deployment Checklist" → \`dev/deployment-checklist.md\`)

If you can't reliably separate, write everything to \`dev/instructions.md\`.

### \`admin_instructions.md\`

Split by topic:
- "## Configuration Updates" section (including ### subsections) → \`admin/config-updates.md\`
- Any other sections → create a new file in \`admin/\` with a descriptive kebab-case name derived from the section heading

If you can't reliably separate, write everything to \`admin/instructions.md\`.

### General Rules

- **Each section goes to exactly ONE file.** Never write the same content to multiple output files.
- **CRITICAL — Dedup against defaults.** Before writing ANY output file, compare its content against the corresponding default file in \`data/default_configuration/\`. If the content conveys the same meaning — even if wording differs slightly (e.g., missing a parenthetical example, minor rephrasing, whitespace differences) — do NOT write the override file. Only write an override when the user has added, removed, or substantially changed content compared to the default.
- **Never overwrite** a new file that already exists (migration already ran).
- If an old file doesn't exist, skip it silently.
- The old flat files will be automatically deleted after you finish. Do not modify them — just create the new files.
- Preserve the user's content exactly — don't reformat, reword, or rewrite.
- When writing a section to a file, include the section heading (## line).`,
  files: [
    // Old files to read
    "data/configuration/instructions.md",
    "data/configuration/user_instructions.md",
    "data/configuration/dev_instructions.md",
    "data/configuration/admin_instructions.md",
    // Default files to compare against
    "data/default_configuration/user/identity.md",
    "data/default_configuration/user/urls.md",
    "data/default_configuration/user/response-style.md",
    "data/default_configuration/user/information-guardrails.md",
    "data/default_configuration/user/submit-response.md",
    "data/default_configuration/user/changes.md",
    "data/default_configuration/dev/github.md",
    "data/default_configuration/dev/changes.md",
    "data/default_configuration/admin/config-updates.md",
    // New files to potentially create
    "data/configuration/user/identity.md",
    "data/configuration/user/urls.md",
    "data/configuration/user/response-style.md",
    "data/configuration/user/information-guardrails.md",
    "data/configuration/user/submit-response.md",
    "data/configuration/user/changes.md",
    "data/configuration/user/instructions.md",
    "data/configuration/dev/github.md",
    "data/configuration/dev/changes.md",
    "data/configuration/dev/instructions.md",
    "data/configuration/admin/config-updates.md",
    "data/configuration/admin/instructions.md",
  ],
  dedupAgainst: {
    "data/configuration/user/identity.md": "data/default_configuration/user/identity.md",
    "data/configuration/user/urls.md": "data/default_configuration/user/urls.md",
    "data/configuration/user/response-style.md":
      "data/default_configuration/user/response-style.md",
    "data/configuration/user/information-guardrails.md":
      "data/default_configuration/user/information-guardrails.md",
    "data/configuration/user/submit-response.md":
      "data/default_configuration/user/submit-response.md",
    "data/configuration/user/changes.md": "data/default_configuration/user/changes.md",
    "data/configuration/dev/github.md": "data/default_configuration/dev/github.md",
    "data/configuration/dev/changes.md": "data/default_configuration/dev/changes.md",
    "data/configuration/admin/config-updates.md":
      "data/default_configuration/admin/config-updates.md",
  },
  deleteAfter: [
    "data/configuration/instructions.md",
    "data/configuration/user_instructions.md",
    "data/configuration/dev_instructions.md",
    "data/configuration/admin_instructions.md",
  ],
};
