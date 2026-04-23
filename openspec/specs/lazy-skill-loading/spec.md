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

The user prompt builder SHALL render an `AVAILABLE SKILL PACKS` block when at least one lazy-tagged plugin exists in the registry. Each entry SHALL display the pack name, the operator-supplied description, and a directive instructing Claude to call `list_skill_pack_skills("<pack>")` to browse or `load_skill("<pack>", "<skill>")` to apply a specific skill. The catalog SHALL be skipped entirely when no lazy packs are configured.

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

### Requirement: list_skill_pack_skills Tool

The `list_skill_pack_skills({ pack })` tool SHALL return the complete list of skills contained in a lazy-tagged plugin, one line per skill, each showing the skill name and its SKILL.md-frontmatter `description`. The tool SHALL reject unknown pack names and non-lazy packs with a clear error.

#### Scenario: Successful listing

- **GIVEN** `marketingskills` is lazy-tagged and contains 32 skills
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "marketingskills" })`
- **THEN** the tool returns text containing a bullet line per skill, e.g. `- ab-test-setup — When the user wants to plan, design, or implement an A/B test…`
- **AND** the bullets are sorted alphabetically by skill name
- **AND** the text returns Claude's next turn's tool_result; no SDK session mutation occurs

#### Scenario: Unknown pack returns error

- **WHEN** Claude calls `list_skill_pack_skills({ pack: "nonexistent" })`
- **THEN** the tool returns an error result listing the valid lazy pack names

#### Scenario: Non-lazy pack rejected

- **GIVEN** `othersskills` is present on disk but NOT tagged lazy in the registry
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "othersskills" })`
- **THEN** the tool returns an error explaining that `othersskills` is always-loaded and its skills are already available via the native `Skill(...)` tool

#### Scenario: Empty pack returns a clear message

- **GIVEN** `emptystuff` is lazy-tagged but its `skills/` directory contains no `SKILL.md` files
- **WHEN** Claude calls `list_skill_pack_skills({ pack: "emptystuff" })`
- **THEN** the tool returns a message such as `Pack 'emptystuff' has no skills available.` rather than an empty bullet list or an error

### Requirement: load_skill Tool

The `load_skill({ pack, skill })` tool SHALL return the full SKILL.md file contents (frontmatter + body) of the named skill as the tool's text result, prefixed with a short preamble identifying the pack and skill. Repeated calls for the same `(pack, skill)` pair within a session SHALL short-circuit and return a brief "already loaded" message without re-reading the file.

#### Scenario: First-time load returns body

- **GIVEN** `marketingskills/skills/ab-test-setup/SKILL.md` exists
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })` for the first time this session
- **THEN** the tool returns text starting with `Loaded skill 'ab-test-setup' from pack 'marketingskills'.`
- **AND** the returned text contains the full SKILL.md contents

#### Scenario: Repeat load is idempotent

- **GIVEN** `load_skill({ pack: "marketingskills", skill: "ab-test-setup" })` was called earlier in the same session
- **WHEN** Claude calls it again with the same arguments
- **THEN** the tool returns a brief "Skill already loaded this session: ab-test-setup. Refer to the prior load if you need the body."
- **AND** no file read occurs

#### Scenario: Unknown pack rejected

- **WHEN** Claude calls `load_skill({ pack: "nonexistent", skill: "ab-test-setup" })`
- **THEN** the tool returns an error listing the valid lazy pack names

#### Scenario: Unknown skill in valid pack rejected

- **GIVEN** `marketingskills` is lazy-tagged
- **WHEN** Claude calls `load_skill({ pack: "marketingskills", skill: "ghost-skill" })`
- **THEN** the tool returns an error including the skill name and guidance to call `list_skill_pack_skills("marketingskills")` to browse available skills

#### Scenario: Non-lazy pack rejected

- **GIVEN** `othersskills` is present on disk but NOT tagged lazy in the registry
- **WHEN** Claude calls `load_skill({ pack: "othersskills", skill: "some-skill" })`
- **THEN** the tool returns an error explaining that `othersskills` is always-loaded and its skills are already available via the native `Skill(...)` tool

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
