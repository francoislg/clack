## Why

Claude Code skill plugins (`data/skill-plugins/<name>/`) contribute their **full skill-frontmatter catalog** to the baseline system prompt on every session — the `marketingskills` plugin alone adds ~15-20K tokens via its 32 skill descriptions, paid even on sessions that never touch marketing. The `add-lazy-mcp-loading` change shrank baseline for integrations; skills are now the single biggest remaining fixed cost. The Claude Agent SDK offers no `setPlugins()`-equivalent for mutating the plugin set mid-session, so skills cannot be lazy-attached the way MCP integrations are; we need a parallel Clack-owned catalog and on-demand body loader.

## What Changes

- New `skillPlugins` registry in `data/config.json`, keyed by plugin name, declaring `lazyLoad` (bool) and an operator-authored pack-level `description`. Plugins tagged `lazyLoad: true` are NOT passed to `--plugin-dir` at session start — their skills never enter the baseline.
- New "AVAILABLE SKILL PACKS" catalog block rendered in the user prompt (alongside AVAILABLE INTEGRATIONS), listing each lazy pack with its pack-level description (one line per pack — not per skill).
- Two new Clack MCP tools:
  - `list_skill_pack_skills({ pack })` — returns the full skill list of a lazy pack (name + description per skill). For browsing.
  - `load_skill({ pack, skill })` — returns the full SKILL.md body as the tool's text result. Caches per-session so repeated loads are idempotent.
- `data/default_configuration/user/integrations.md` gets a fallback rule: if Claude reaches for `Skill("<name>")` and the name is unknown, check AVAILABLE SKILL PACKS and try `load_skill(...)` instead.
- Claude-powered migration that scans user instruction files for references to skill names and rewrites them to the new tool-based flow, with a re-run-safe guard.
- Home Tab "Skill Plugins" section extended to group plugins into **Always loaded** (passed via `--plugin-dir`) vs **Lazy** (in the skillPlugins registry with `lazyLoad: true`), mirroring the MCP split added in `add-lazy-mcp-loading`.

## Capabilities

### New Capabilities

- `lazy-skill-loading`: Registry-driven lazy loading of Claude Code skill plugins — pack catalog in the prompt, `list_skill_pack_skills` and `load_skill` tools for on-demand loading, per-session caching of loaded skill bodies, operator configuration via `config.json`.

### Modified Capabilities

- `claude-code-integration`: The `plugins` option passed to the Agent SDK `query()` is filtered to exclude plugins tagged `lazyLoad: true` in the skillPlugins registry, and the prompt includes the skill-packs catalog.
- `lazy-mcp-loading`: The startup baseline smoke test is extended to include the skill-plugin set (`discoverEagerSkillPlugins`), the `AVAILABLE SKILL PACKS` catalog block, and a wired-up `SkillsManager` so the baseline it reports reflects what a real session receives for lazy and eager skill packs.

## Impact

- **Affected code**: `src/skillPlugins.ts` (extend `PluginInfo` with a `lazyLoad` boolean and add `discoverEagerPlugins` that filters it out), `src/claude/index.ts` (wire the filtered plugin set), `src/claude/promptBuilder.ts` (new catalog block), `src/tools/server.ts` (register the two new tools), new files `src/tools/query/listSkillPackSkills.ts` and `src/tools/query/loadSkill.ts`, `src/config.ts` (registry parser), `src/slack/homeTab.ts` (grouping), `data/default_configuration/user/integrations.md` (fallback rule).
- **New migration**: `018-lazy-skill-references` (Claude-powered, enhancement priority) rewrites instruction-file references to skill names.
- **Operator-facing**: one new config section (`skillPlugins: { <name>: { lazyLoad, description } }`), one new line in the Home Tab, no behavior change for plugins without an entry (backwards-compatible default).
- **Baseline token impact** (estimate, based on `marketingskills` as the canary): ~15-20K fewer baseline tokens per session once `marketingskills` is tagged lazy; measurable via the existing startup baseline smoke test.
- **Tool-name validator**: `list_skill_pack_skills` and `load_skill` must be added to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts`.
- **Session persistence**: optionally extend `SessionContext.mcpAttachHistory` (or add a parallel `skillLoadHistory`) to record per-session skill loads — useful for debugging but not strictly required.
