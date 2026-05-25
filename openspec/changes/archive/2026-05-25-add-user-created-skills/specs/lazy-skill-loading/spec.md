## ADDED Requirements

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

## MODIFIED Requirements

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
