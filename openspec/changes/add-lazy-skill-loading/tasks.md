## 1. Registry schema in `data/config.json`

- [x] 1.1 Add `SkillPluginEntry` (fields: `lazyLoad: boolean`, `description: string`) and `SkillPluginRegistry` types in `src/config.ts`, mirroring the shape of the existing `McpServerRegistryEntry` / `McpServerRegistry`. Add optional `skillPlugins?: SkillPluginRegistry` to `Config`.
- [x] 1.2 Implement `parseSkillPluginRegistry(raw)` validator: object-shape enforced, `lazyLoad` must be boolean (required), `description` must be a string and is REQUIRED whenever `lazyLoad: true` (reject lazy entries missing a description). Description MAY be omitted when `lazyLoad: false`.
- [x] 1.3 Wire `parseSkillPluginRegistry` into `loadConfig()` so invalid entries throw at startup with clear messages identifying the offending path.
- [x] 1.4 Unit tests in `src/config.test.ts` mirroring the `parseMcpServerRegistry` tests: valid registry, optional field, array rejection, missing lazyLoad, non-string description, non-object entry, lazy entry missing description (rejected).

## 2. Plugin discovery + filtering

- [x] 2.1 Extend `PluginInfo` in `src/skillPlugins.ts` with `lazyLoad: boolean` (defaulted from `config.skillPlugins[name]?.lazyLoad ?? false`). Use the same safe-config-getter pattern as the prior attempt (try/catch around `getConfig()` so tests that don't load config don't throw).
- [x] 2.2 Add `discoverEagerPlugins(): SdkPluginConfig[]` that filters out `lazyLoad: true` plugins. Keep the existing `discoverPlugins()` exported for Home Tab uses that need to see everything.
- [x] 2.3 In `src/claude/index.ts` `buildQuerySetup`, swap `plugins: discoverPlugins()` for `plugins: discoverEagerPlugins()`.
- [x] 2.4 Unit tests in `src/skillPlugins.test.ts`: `lazyLoad: true` excluded from `discoverEagerPlugins`, included in `discoverPluginInfo`; absent config entry defaults to eager; config parse failure safely falls back to eager (for robustness).

## 3. Pack-level catalog

- [x] 3.1 New `src/claude/skillPacksCatalog.ts` exporting `buildSkillPacksCatalog(registry)`. Returns the rendered block (intro line + sorted bullets + directive), or `""` when no lazy packs exist.
- [x] 3.2 Bullet format: `- <name> — <description>` where description comes from `config.skillPlugins[name].description` (guaranteed present for lazy-tagged entries by the config validator in task 1.2 — no fallback needed). Alphabetical by pack name.
- [x] 3.3 Inject the catalog in `src/claude/promptBuilder.ts` immediately after the existing `AVAILABLE INTEGRATIONS` block. Gated on the catalog being non-empty.
- [x] 3.4 Unit tests in `src/claude/skillPacksCatalog.test.ts`: alphabetical ordering, empty when no lazy packs, directive phrasing.

## 3.5 SkillsManager (parallels McpServerManager)

- [x] 3.5.1 New `src/claude/skillsManager.ts` exporting a `SkillsManager` class with: constructor taking `lazyPacks: Map<string, PackInfo>`, `registry: SkillPluginRegistry`, and a seed array of `loadedSkills`; methods `knowsLazyPack`, `isEagerPack`, `knownLazyPackNames`, `packDescription`, `listSkills`, `getSkill`, `readSkillBody`, `isSkillLoaded`, `markLoaded`, `catalog`.
- [x] 3.5.2 Same file exports `prepareSkillsSession(session, pluginInfos, registry, deps?)` — a factory that walks each lazy pack's `skills/` directory, parses each `SKILL.md` frontmatter (name + description), and builds the manager. Frontmatter parse failure on a single skill logs a warning and skips that skill rather than failing the whole session.
- [x] 3.5.3 Add `skillsManager?: SkillsManager` to `QueryToolContext` in `src/tools/types.ts`; wire it in `buildQueryContext`.
- [x] 3.5.4 In `src/claude/index.ts` `buildQuerySetup`, call `prepareSkillsSession(session, discoverSkillPluginInfo(), config.skillPlugins)` and pass the result into the tool context.
- [x] 3.5.5 Unit tests in `src/claude/skillsManager.test.ts`: construction, `knowsLazyPack`/`isEagerPack`, `listSkills` sorted alphabetically, `getSkill` found/missing, `isSkillLoaded` seeded from session, `markLoaded` idempotent, catalog output.

## 4. `list_skill_pack_skills` tool

- [x] 4.1 New file `src/tools/query/listSkillPackSkills.ts`; zod input `{ pack: z.string() }`.
- [x] 4.2 Validation: reject unknown pack names; reject packs that exist on disk but are NOT tagged `lazyLoad: true` (directs Claude to use native `Skill()` for those).
- [x] 4.3 For valid packs, walk `data/skill-plugins/<pack>/skills/*/SKILL.md`, parse frontmatter (name + description), return a plain-text bulleted list sorted by skill name. (Implementation moved into `SkillsManager` / `prepareSkillsSession`; the tool delegates.)
- [x] 4.4 Register in `src/tools/server.ts` only when `ctx.skillsManager` is populated (query-mode only).
- [x] 4.5 Add `list_skill_pack_skills` to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts`.
- [x] 4.6 Add a tool-mapping label in `data/default_configuration/tool_mapping/clack.json`: `"list_skill_pack_skills": "Listing skills in {pack}"`.
- [x] 4.7 Unit tests: successful listing, unknown pack, non-lazy pack rejected, empty pack returns sensible message.

## 5. `load_skill` tool

- [x] 5.1 New file `src/tools/query/loadSkill.ts`; zod input `{ pack: z.string(), skill: z.string() }`.
- [x] 5.2 Validation: reject unknown pack, non-lazy pack, and unknown skill within a valid pack (include "try list_skill_pack_skills" hint in the skill-not-found error).
- [x] 5.3 Read `data/skill-plugins/<pack>/skills/<skill>/SKILL.md` (via `SkillsManager.readSkillBody`) and return the full file contents prefixed with `Loaded skill '<skill>' from pack '<pack>'.\n\n---\n\n<body>`.
- [x] 5.4 Session-level cache: check via `SkillsManager.isSkillLoaded(pack, skill)`; if true, return the short-circuit message and skip the file read. On successful first load, `markLoaded` returns the full list and the tool persists it via `updateSession({ loadedSkills })`.
- [x] 5.5 Register in `src/tools/server.ts` alongside `list_skill_pack_skills` (same gating).
- [x] 5.6 Add `load_skill` to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts`.
- [x] 5.7 Add tool mapping: `"load_skill": "Loading skill {skill} from {pack}"`.
- [x] 5.8 Unit tests: first-time load, idempotent repeat within a single session, resumed-session short-circuit (a `loadedSkills` entry persisted in a prior turn still short-circuits on resume), unknown pack, unknown skill, non-lazy pack, file-read failure graceful error.

## 6. Session persistence

- [x] 6.1 Add `loadedSkills?: Array<{ pack: string; skill: string }>` to `SessionContext` in `src/sessions.ts`. Implicitly persisted via `stripRuntimeFields` inside `src/sessions.ts`; no changes needed in `src/changes/persistence.ts` (that file handles worker-mode change sessions, not Q&A sessions).
- [x] 6.2 Unit test: round-trip `loadedSkills` via `updateSession` + `getSession`.

## 7. Fallback rule in integrations.md

- [x] 7.1 Extend the baseline file `data/default_configuration/user/integrations.md` (top-level `user/` role file, always loaded — NOT a `topics/` file) with a new section about `Skill(...)` vs `load_skill(...)`. Include explicit "if `Skill('<name>')` returns unknown, check AVAILABLE SKILL PACKS and try `load_skill(...)`" fallback.
- [x] 7.2 Include two worked examples mirroring the format used for integrations (e.g., "user asks about pricing → call `load_skill('marketingskills', 'pricing-strategy')`").

## 8. Home Tab grouping

- [x] 8.1 In `src/slack/homeTab.ts` buildStatusSection, split the Skill Plugins list into **Eager** and **Lazy** lines based on the registry (mirroring the MCP Always/On-demand split).
- [x] 8.2 Surface the lazy/eager split visibly (sub-section headings) so operators can see at a glance which packs are excluded from baseline.
- [x] 8.3 Update `src/slack/homeTab.test.ts` fixtures to set `lazyLoad` on mock plugin infos and assert on grouped rendering.

## 9. Migration `018-lazy-skill-references`

- [x] 9.1 Use `/create-migration` to scaffold `src/migrations/018-lazy-skill-references.ts`. Claude-powered (enhancement priority), prompt-based.
- [x] 9.2 Prompt instructs Claude to scan every `.md` under `data/configuration/{role}/` (including `topics/`), find references to skills that belong to a lazy-tagged pack, and rewrite them from `Skill("<name>")` / "use the <name> skill" phrasings to `load_skill("<pack>", "<name>")`.
- [x] 9.3 Files list enumerates known source and destination paths the same way migration 017 did; files not on disk are surfaced as "does not exist yet" and left untouched.
- [x] 9.4 Unit tests in `src/migrations/018-lazy-skill-references.test.ts` — prompt-shape assertions (metadata, file list coverage, re-run guard, tool references, no-op when no lazy packs).

## 10. End-to-end verification

- [x] 10.1 `npm test` and `npx tsc` green. (2826 tests pass, no TS errors, `openspec validate --strict` clean.)
- [ ] 10.2 Smoke via the existing startup baseline test: tag `marketingskills` lazy in `data/config.json`, re-run the smoke, verify per-role totals drop by ~15K tokens (match §4 design estimate). _[Deferred — requires live config flip + restart; operator task.]_
- [ ] 10.3 Manual Slack test: flip `marketingskills` to lazy, ask a marketing question, confirm Claude calls `list_skill_pack_skills("marketingskills")` then `load_skill(...)` for the relevant skill. _[Deferred — requires running Slack workspace.]_
- [ ] 10.4 Manual Slack test: ask a non-marketing question, confirm neither `list_skill_pack_skills` nor `load_skill` is called and no marketing tokens are paid. _[Deferred — requires running Slack workspace.]_
- [ ] 10.5 Manual Slack test: thread continuation with a `load_skill` in the prior turn — confirm idempotent short-circuit message returned for the same pair on the next turn. _[Deferred — requires running Slack workspace.]_
- [ ] 10.6 Record the observed before/after baseline numbers in a note under `openspec/changes/add-lazy-skill-loading/` so reviewers can verify the token-drop claim. _[Deferred — depends on 10.2.]_
