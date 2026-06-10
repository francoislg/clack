# lazy-skill-loading Specification

## Purpose
Lazy-load Claude Code skill plugins on demand via `load_skill` tool, reducing baseline token cost. Plugins tagged `lazyLoad: true` in the `skillPlugins` registry are excluded from `--plugin-dir` at session start — their skill frontmatter never enters the baseline. A compact catalog in the user prompt advertises available lazy packs; `list_skill_pack_skills` browses a pack's skills; `load_skill` returns a specific SKILL.md body on demand. Loads persist on the session so repeats short-circuit across resumes.
## Requirements
### Requirement: Skill Plugin Registry in config.json

The system SHALL accept a `skillPlugins` registry in `data/config.json`, keyed by plugin name (the directory name under `data/skill-plugins/`). Each entry SHALL declare `lazyLoad: boolean`; when `lazyLoad: true`, the entry SHALL also declare `description: string` (a human-readable summary rendered in the AVAILABLE SKILL PACKS catalog). The parser SHALL reject non-object entries, non-boolean `lazyLoad`, non-string `description`, and lazy-tagged entries missing a description, at startup. Absent entries SHALL be treated as `lazyLoad: false` (backwards-compatible with pre-lazy behavior). The registry field itself SHALL be optional — configs without it MUST remain valid.

#### Scenario: Valid registry parses successfully

- **WHEN** `config.json` contains `"skillPlugins": { "marketingskills": { "lazyLoad": true, "description": "Marketing playbooks" } }`
- **THEN** `loadConfig()` returns a Config whose `skillPlugins.marketingskills.lazyLoad` is `true` and `.description` equals `"Marketing playbooks"`

#### Scenario: Missing entry defaults to eager loading

- **GIVEN** `config.json` has no `skillPlugins` field
- **AND** a plugin `othersskills` exists in `data/skill-plugins/`
- **WHEN** the plugin discovery runs for session setup
- **THEN** `othersskills` is treated as `lazyLoad: false`
- **AND** is passed via `--plugin-dir` at session start

#### Scenario: Invalid lazyLoad type rejected

- **WHEN** `config.json` contains `"skillPlugins": { "x": { "lazyLoad": "true" } }`
- **THEN** `loadConfig()` throws a clear error identifying `skillPlugins.x.lazyLoad` as requiring boolean

#### Scenario: Non-object entry rejected

- **WHEN** `config.json` contains `"skillPlugins": { "x": "lazy" }`
- **THEN** `loadConfig()` throws a clear error identifying `skillPlugins.x` as requiring an object

#### Scenario: Lazy entry missing description rejected

- **WHEN** `config.json` contains `"skillPlugins": { "x": { "lazyLoad": true } }`
- **THEN** `loadConfig()` throws a clear error identifying `skillPlugins.x` as requiring a `description` string when `lazyLoad` is `true`

### Requirement: Lazy-Tagged Plugins Excluded From --plugin-dir

The session orchestrator SHALL filter out plugins whose `skillPlugins[name].lazyLoad === true` before passing the plugin list to the Claude Agent SDK `query()` options. Lazy-tagged plugins SHALL NOT appear as `--plugin-dir` entries for the session, so their skill frontmatter never enters the baseline system prompt.

#### Scenario: Lazy plugin omitted from SDK plugin set

- **GIVEN** `data/skill-plugins/marketingskills/` exists and is tagged `lazyLoad: true` in the registry
- **WHEN** `buildQuerySetup` assembles the `plugins` option for `query()`
- **THEN** the returned list does NOT include `marketingskills` as a `local` plugin
- **AND** the SDK session is spawned without `--plugin-dir .../marketingskills`

#### Scenario: Non-lazy plugin still included

- **GIVEN** `data/skill-plugins/other/` exists and is NOT tagged lazy (no registry entry or `lazyLoad: false`)
- **WHEN** `buildQuerySetup` assembles the `plugins` option
- **THEN** `other` appears in the returned list as a `{ type: "local", path }` entry

### Requirement: AVAILABLE SKILL PACKS Catalog in the Prompt

The user prompt builder SHALL render an `AVAILABLE SKILL PACKS` block when at least one lazy-tagged plugin exists in the registry, OR when `userSkills.enabled === true` and at least one enabled user skill exists. Each lazy-pack entry SHALL display the pack name, the operator-supplied description, and a directive instructing Claude to call `list_skill_pack_skills("<pack>")` to browse or `load_skill("<pack>", "<skill>")` to apply a specific skill. When user skills are enabled and present, a "USER SKILLS" subsection SHALL appear listing enabled user skills. The catalog SHALL be skipped entirely when no lazy packs are configured AND either user skills are disabled or no enabled skills exist.

#### Scenario: Catalog rendered when a lazy pack exists

- **GIVEN** the registry has `marketingskills` tagged lazy with description "Marketing playbooks: CRO, copywriting, SEO"
- **WHEN** the prompt is built for a session
- **THEN** the prompt contains a section headed `AVAILABLE SKILL PACKS`
- **AND** the section lists `- marketingskills — Marketing playbooks: CRO, copywriting, SEO`
- **AND** the section ends with guidance instructing Claude to call `list_skill_pack_skills` or `load_skill` when a question matches a pack

#### Scenario: Catalog omitted when no lazy packs

- **GIVEN** the registry has no `lazyLoad: true` entries
- **WHEN** the prompt is built
- **THEN** no `AVAILABLE SKILL PACKS` section appears

#### Scenario: Catalog alphabetized

- **GIVEN** two lazy packs `zebrastuff` and `anvilstuff`
- **WHEN** the catalog renders
- **THEN** `anvilstuff` appears before `zebrastuff` in the bullet list

### Requirement: USER SKILLS Subsection in the Catalog

When `userSkills.enabled === true` and at least one enabled user skill exists under `data/user-skills/`, the user-prompt catalog block SHALL include a "USER SKILLS" subsection beneath the existing pack listing. Each enabled (non-disabled) user skill SHALL render on its own line as `- <slug> — <description>` where `<description>` is the trimmed frontmatter `description` field. The subsection SHALL end with a directive instructing Claude to call `load_skill({ pack: "user-skills", skill: "<slug>" })` to fetch the body. Disabled skills (those with `disabledAt` set in `.meta.json`) SHALL be excluded from the rendering.

The subsection SHALL be alphabetized by slug. If `userSkills.enabled === false` or no enabled user skills exist, the subsection SHALL be omitted entirely (no header, no empty list).

When the `AVAILABLE SKILL PACKS` block would be empty without the user-skills entries (no lazy packs configured but at least one user skill exists), the block header SHALL still render and the "USER SKILLS" subsection SHALL appear directly under it.

#### Scenario: User skills rendered inline

- **GIVEN** `userSkills.enabled === true`
- **AND** `data/user-skills/copy-improver/` (enabled) and `data/user-skills/meeting-notes/` (enabled) exist
- **WHEN** the user prompt is built
- **THEN** the catalog block contains a `USER SKILLS:` subsection
- **AND** the subsection lists `- copy-improver — <description>` and `- meeting-notes — <description>` (alphabetized)
- **AND** the subsection ends with a directive mentioning `load_skill({ pack: "user-skills", skill: "<name>" })`

#### Scenario: Disabled skills excluded

- **GIVEN** `copy-improver` is enabled and `meeting-notes` has `disabledAt` set
- **WHEN** the prompt is built
- **THEN** the subsection lists only `copy-improver`
- **AND** `meeting-notes` does not appear

#### Scenario: Subsection omitted when no enabled user skills

- **GIVEN** `userSkills.enabled === true` but `data/user-skills/` is empty (or contains only disabled skills)
- **WHEN** the prompt is built
- **THEN** no `USER SKILLS:` subsection is rendered

#### Scenario: Subsection omitted when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **AND** `data/user-skills/` contains enabled skill directories
- **WHEN** the prompt is built
- **THEN** no `USER SKILLS:` subsection is rendered

#### Scenario: Catalog block header renders for user-skills-only case

- **GIVEN** no lazy-tagged plugins in `skillPlugins` registry
- **AND** at least one enabled user skill exists
- **AND** `userSkills.enabled === true`
- **WHEN** the prompt is built
- **THEN** the `AVAILABLE SKILL PACKS` header is rendered
- **AND** the `USER SKILLS:` subsection appears directly under it

#### Scenario: Triggers hot-reload between turns

- **GIVEN** `copy-improver` is rendered in the catalog for turn N
- **WHEN** between turn N and turn N+1, the SKILL.md frontmatter `description` is edited on disk
- **AND** the prompt is built for turn N+1
- **THEN** the catalog reflects the new description (no restart needed)

### Requirement: list_skill_pack_skills Tool

The `list_skill_pack_skills({ pack })` tool SHALL return the complete list of skills contained in a lazy-tagged plugin, one line per skill, each showing the skill name and its SKILL.md-frontmatter `description`. The tool SHALL reject unknown pack names and non-lazy packs with a clear error. The synthetic `user-skills` pack SHALL also be rejected with a directive pointing Claude to the inline `USER SKILLS:` catalog subsection (the user-skills triggers are already visible in the baseline prompt — no enumeration is needed).

#### Scenario: Successful listing of a lazy pack

- **GIVEN** `marketingskills` is lazy-tagged and contains 32 skills
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "marketingskills" })`
- **THEN** the tool returns text containing a bullet line per skill, e.g. `- ab-test-setup — When the user wants to plan, design, or implement an A/B test…`
- **AND** the bullets are sorted alphabetically by skill name
- **AND** the text returns Claude's next turn's tool_result; no SDK session mutation occurs

#### Scenario: user-skills pack listing rejected with redirect

- **GIVEN** `userSkills.enabled === true`
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "user-skills" })`
- **THEN** the tool returns an error directing Claude to consult the `USER SKILLS:` subsection of the catalog block already present in the prompt
- **AND** the tool does NOT enumerate the user-skills

#### Scenario: Unknown pack returns error

- **WHEN** Claude calls `list_skill_pack_skills({ pack: "nonexistent" })`
- **THEN** the tool returns an error listing the valid lazy pack names

#### Scenario: Non-lazy pack rejected

- **GIVEN** `othersskills` is present on disk but NOT tagged lazy in the registry
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "othersskills" })`
- **THEN** the tool returns an error explaining that `othersskills` is always-loaded and its skills are already available via the native `Skill(...)` tool

#### Scenario: Empty pack returns a clear message

- **GIVEN** `emptystuff` is lazy-tagged but its `skills/` directory contains no `SKILL.md` files
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "emptystuff" })`
- **THEN** the tool returns a message such as `Pack 'emptystuff' has no skills available.` rather than an empty bullet list or an error

### Requirement: load_skill Tool

The `load_skill({ pack, skill })` tool SHALL return the full SKILL.md file contents (frontmatter + body) of the named skill as the tool's text result, prefixed with a short preamble identifying the pack and skill.

For lazy-plugin packs (entries in `skillPlugins` registry with `lazyLoad: true`): repeated calls for the same `(pack, skill)` pair within a session SHALL short-circuit and return a brief "already loaded" message without re-reading the file.

For the synthetic `user-skills` pack (available when `userSkills.enabled === true`): the tool SHALL read from `data/user-skills/<skill>/SKILL.md`, consulting a process-level mtime-keyed cache. Repeat calls SHALL re-check `mtimeMs` and re-read on mismatch so edits propagate within the same session. Disabled skills (those with `disabledAt` in `.meta.json`) SHALL be rejected as "unknown skill". User-skills loads SHALL NOT be appended to `session.loadedSkills` (since the cache handles in-session repeats and we want freshness on mtime change rather than session-level dedup).

#### Scenario: First-time load of a lazy-pack skill returns body

- **GIVEN** `marketingskills/skills/ab-test-setup/SKILL.md` exists
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })` for the first time this session
- **THEN** the tool returns text starting with `Loaded skill 'ab-test-setup' from pack 'marketingskills'.`
- **AND** the returned text contains the full SKILL.md contents

#### Scenario: Repeat load of a lazy-pack skill is idempotent

- **GIVEN** `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })` was called earlier in the same session
- **WHEN** Claude calls it again with the same arguments
- **THEN** the tool returns a brief "Skill already loaded this session: ab-test-setup. Refer to the prior load if you need the body."
- **AND** no file read occurs

#### Scenario: First-time load of a user-skills skill returns body

- **GIVEN** `data/user-skills/copy-improver/SKILL.md` exists and is enabled
- **AND** the user-skills body cache has no entry for `copy-improver`
- **WHEN** Claude calls `load_skill({ pack: "user-skills", skill: "copy-improver" })`
- **THEN** the file is read from disk
- **AND** the tool returns text starting with `Loaded skill 'copy-improver' from pack 'user-skills'.`
- **AND** the cache stores `(copy-improver, mtime, body)`

#### Scenario: Repeat user-skills load with unchanged mtime returns cached body

- **GIVEN** the cache holds `(copy-improver, mtime=T1, body)`
- **AND** the file on disk still has mtime `T1`
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called again
- **THEN** the cached body is returned without re-reading
- **AND** the tool returns the same content as the first call (full body, not the "already loaded" short-circuit)

#### Scenario: User-skills mtime mismatch triggers re-read

- **GIVEN** the cache holds `(copy-improver, mtime=T1, oldBody)`
- **AND** the file on disk has been written and now has mtime `T2`
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called
- **THEN** the file is re-read
- **AND** the returned body matches the new on-disk content
- **AND** the cache is updated to `(copy-improver, mtime=T2, newBody)`

#### Scenario: Disabled user skill rejected

- **GIVEN** `copy-improver` has `disabledAt` set in `.meta.json`
- **WHEN** Claude calls `load_skill({ pack: "user-skills", skill: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as not found

#### Scenario: Unknown pack rejected

- **WHEN** Claude calls `load_skill({ pack: "nonexistent", skill: "ab-test-setup" })`
- **THEN** the tool returns an error listing the valid lazy pack names (and `user-skills` if `userSkills.enabled`)

#### Scenario: Unknown skill in valid lazy pack rejected

- **GIVEN** `marketingskills` is lazy-tagged
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ghost-skill" })`
- **THEN** the tool returns an error including the skill name and guidance to call `list_skill_pack_skills("marketingskills")` to browse available skills

#### Scenario: Unknown skill in user-skills pack rejected

- **GIVEN** `userSkills.enabled === true` and no skill named `ghost-skill` exists under `data/user-skills/`
- **WHEN** Claude calls `load_skill({ pack: "user-skills", skill: "ghost-skill" })`
- **THEN** the tool returns an error including the skill name and guidance to consult the `USER SKILLS:` subsection of the catalog

#### Scenario: Non-lazy lazy-plugin pack rejected

- **GIVEN** `othersskills` is present on disk but NOT tagged lazy in the registry
- **WHEN** Claude calls `load_skill({ pack: "othersskills", skill: "some-skill" })`
- **THEN** the tool returns an error explaining that `othersskills` is always-loaded and its skills are already available via the native `Skill(...)` tool

#### Scenario: user-skills pack unavailable when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **WHEN** Claude calls `load_skill({ pack: "user-skills", skill: "any" })`
- **THEN** the tool returns an error identifying `user-skills` as not a valid pack (consistent with "unknown pack" handling)

#### Scenario: File read failure surfaces a clear error

- **GIVEN** `marketingskills/skills/ab-test-setup/SKILL.md` is listed by the pack but missing or unreadable on disk
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })`
- **THEN** the tool returns an error identifying the pack/skill pair and the underlying read failure
- **AND** no entry is appended to `session.loadedSkills`

### Requirement: Session-Level Load Tracking

Successful `load_skill` invocations SHALL be recorded on the session as a `loadedSkills: Array<{ pack, skill }>` list so repeated calls short-circuit and resumed sessions do not re-trigger the "first-time" path for already-loaded skills.

#### Scenario: Persisted across session persistence cycle

- **WHEN** `load_skill` succeeds for `(marketingskills, ab-test-setup)` in turn 1
- **AND** the session is persisted and resumed for turn 2
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })` in turn 2
- **THEN** the tool returns the "already loaded this session" short-circuit (no file read)

#### Scenario: Load history survives alongside attachedIntegrations

- **GIVEN** a session with `attachedIntegrations: ["metabase"]` and `loadedSkills: [{ pack: "marketingskills", skill: "ab-test-setup" }]`
- **WHEN** the session is serialized to disk and reloaded
- **THEN** both fields round-trip intact

### Requirement: Fallback Instruction for Skill() Misuse

The baseline `integrations.md` SHALL include a rule instructing Claude that if it calls `Skill("<name>")` and receives an "unknown skill" error, it SHOULD inspect the AVAILABLE SKILL PACKS catalog and try `load_skill("<pack>", "<name>")` before giving up.

#### Scenario: Fallback rule present in default configuration

- **WHEN** `data/default_configuration/user/integrations.md` is read
- **THEN** the content includes a section describing the `Skill()`-vs-`load_skill` distinction and the fallback behavior

### Requirement: Skill-plugin manifest read is schema-driven

Skill-plugin discovery SHALL parse a plugin's manifest JSON against a narrow zod schema rather than a blind `as` cast, preserving its graceful contract: a missing/unreadable/invalid manifest SHALL fall back to the current defaults (name = directory basename, skill count = 0), never throw.

#### Scenario: Missing or malformed manifest falls back to defaults

- **WHEN** a skill plugin has no manifest, an unreadable manifest, or one that fails schema validation
- **THEN** discovery uses the directory basename as the name and a zero skill count, exactly as today

#### Scenario: A valid manifest is read unchanged

- **WHEN** a well-formed plugin manifest is present
- **THEN** the discovered plugin info matches the pre-migration result

