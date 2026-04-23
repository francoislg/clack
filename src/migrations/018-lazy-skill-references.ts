import type { Migration } from "./types.js";

/**
 * Claude-powered migration that rewrites references to skills that now live in
 * a lazy-tagged skill pack. Before lazy-loading, operators authored instruction
 * files that invoked `Skill("<name>")` or said "use the <name> skill" to pull
 * in skill guidance. Once a pack flips to `lazyLoad: true`, the SDK no longer
 * registers those skills — `Skill("<name>")` returns unknown.
 *
 * This migration walks every `.md` under `data/configuration/{role}/` (both
 * baseline and `topics/`) and rewrites:
 *
 *   - `Skill("ab-test-setup")` → `load_skill("marketingskills", "ab-test-setup")`
 *   - "use the pricing-strategy skill" → "use `load_skill("marketingskills", "pricing-strategy")`"
 *
 * Runs as a `prompt` migration because detecting skill-name mentions in
 * operator-authored prose requires semantic judgment; a regex over the
 * literal `Skill("...")` form would miss informal mentions.
 *
 * Re-run-safe: files that already contain `load_skill("<pack>", "<name>")`
 * for a pair are left untouched for that pair. The migration logs a short
 * summary of what was rewritten per file.
 */

export const migration: Migration = {
  version: 18,
  name: "Rewrite references to lazy-pack skills to use load_skill",
  priority: "enhancement",
  prompt: `Rewrite references to skills that now belong to a lazy-tagged Claude Code skill pack.

## Background

Clack now supports lazy-loading of skill plugins from \`data/skill-plugins/\`. When a plugin is tagged \`lazyLoad: true\` in \`config.json\` under the \`skillPlugins\` registry, its skills are NOT registered with the SDK at session start. Calling \`Skill("<name>")\` for those skills will fail with an "unknown skill" error.

Instead, Claude must use two new tools:
- \`list_skill_pack_skills("<pack>")\` — browse the skills in a pack.
- \`load_skill("<pack>", "<skill>")\` — apply a specific skill (returns SKILL.md body as the tool result).

Operators authoring instruction overrides under \`data/configuration/{role}/\` may have referenced skills assuming eager \`Skill(...)\` invocation. Once a pack flips to lazy, those references are broken at runtime.

## What To Do

For every instruction file listed below, rewrite any reference to a skill that belongs to a lazy-tagged pack.

### Step 1 — Identify lazy packs

Read \`data/config.json\` (provided in the file list). Look at the \`skillPlugins\` object:

\`\`\`json
{
  "skillPlugins": {
    "marketingskills": { "lazyLoad": true, "description": "..." },
    "devtools": { "lazyLoad": false, "description": "..." }
  }
}
\`\`\`

Only packs with \`"lazyLoad": true\` are in scope. If the registry is missing or no packs are tagged lazy, the migration is a no-op — emit a terse "no lazy packs configured, nothing to rewrite" summary and stop.

### Step 2 — Enumerate skills in each lazy pack

For each lazy pack \`<pack>\`, list the directories under \`data/skill-plugins/<pack>/skills/\`. Each directory name is a skill name. You can read the pack's \`.claude-plugin/plugin.json\` or \`.claude-plugin/marketplace.json\` if the pack maintains an explicit skill list in its manifest (field \`plugins[0].skills\`), otherwise fall back to directory names.

If the pack's \`skills/\` directory doesn't exist on disk, treat the pack as having zero skills and skip it.

### Step 3 — Rewrite references

For each instruction file, scan for mentions of any skill name that belongs to one of the lazy packs. Two forms to rewrite:

**A. Explicit \`Skill("<name>")\` calls**

Before:
\`\`\`
Use \`Skill("ab-test-setup")\` when the user asks about A/B tests.
\`\`\`

After:
\`\`\`
Use \`load_skill("marketingskills", "ab-test-setup")\` when the user asks about A/B tests.
\`\`\`

**B. Prose mentions of skill names**

Before:
\`\`\`
When the user asks about pricing, use the pricing-strategy skill to work through the framework.
\`\`\`

After:
\`\`\`
When the user asks about pricing, call \`load_skill("marketingskills", "pricing-strategy")\` to work through the framework.
\`\`\`

Only rewrite when the skill name is unambiguous — i.e., it's a known skill belonging to exactly one lazy pack, and the surrounding text makes it clear the reference is to that skill (not a generic English use of the word). When in doubt, leave the text alone.

### Step 4 — Re-run safety

Before rewriting, search the file for an existing \`load_skill("<pack>", "<skill>")\` call for the pair you're about to rewrite. If present, that reference has already been migrated — skip it. Do NOT double-wrap or duplicate.

## Preserve Operator Tone

Do not rephrase, paraphrase, or restructure content. Change only the specific tokens that need updating. Preserve original punctuation, casing, and markdown formatting.

## Files Out Of Scope

- \`data/default_configuration/\`: shipped defaults, read-only. You may not modify.
- Files that don't reference any lazy-pack skill: leave alone.
- Files where every potential rewrite already has a \`load_skill(...)\` form nearby: the migration already ran — skip.

## Output

Use the Write tool to update files in place. Emit a terse summary listing each file touched and what was rewritten. Files unchanged need not appear in the summary.`,
  files: [
    // Config (identifies lazy packs).
    "data/config.json",
    // User baseline instruction files (may contain Skill() references).
    "data/configuration/user/applauz-hubspot.md",
    "data/configuration/user/applauz.md",
    "data/configuration/user/asana-context.md",
    "data/configuration/user/gcp-logs.md",
    "data/configuration/user/github-applauz.md",
    "data/configuration/user/hockey-sports-analyst.md",
    "data/configuration/user/humor.md",
    "data/configuration/user/integrations.md",
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
    // Topic files (may also reference skills).
    "data/configuration/user/topics/asana/asana-context.md",
    "data/configuration/user/topics/gcp-observability/gcp-logs.md",
    "data/configuration/user/topics/hubspot/applauz-hubspot.md",
    "data/configuration/user/topics/metabase/metabase.md",
    "data/configuration/user/topics/monday/monday-integration.md",
    "data/configuration/user/topics/scheduling/scheduled-messages.md",
    "data/configuration/user/topics/sentry/sentry.md",
  ],
};
