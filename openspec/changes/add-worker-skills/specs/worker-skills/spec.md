## ADDED Requirements

### Requirement: Worker-Skill Storage and Two-Tier Resolution

The system SHALL recognize **worker skills** as `SKILL.md` files resolved through the existing two-tier instruction chain, where `configuration/<path>` overrides `default_configuration/<path>`. A worker skill SHALL be addressable in two scopes:

- **Global**: `skills/<slug>/SKILL.md`
- **Per-repo**: `{repo}/skills/<slug>/SKILL.md`, where `{repo}` is the run's repository name.

When the same `<slug>` resolves in both scopes for a given run, the **per-repo** skill SHALL win. Within a single scope, a file under `configuration/` SHALL mask the same-path file under `default_configuration/`. Resolution SHALL use the same path semantics as `{repo}/changes_instructions.md` (config tree, not the repository checkout).

#### Scenario: Built-in global skill resolves from default_configuration

- **GIVEN** `default_configuration/skills/rebase/SKILL.md` exists and no override exists
- **WHEN** worker skills are resolved for any repository
- **THEN** the `rebase` skill resolves with its body read from `default_configuration/skills/rebase/SKILL.md`

#### Scenario: Runtime override masks the built-in

- **GIVEN** both `default_configuration/skills/rebase/SKILL.md` and `configuration/skills/rebase/SKILL.md` exist
- **WHEN** the `rebase` skill is resolved
- **THEN** the body comes from `configuration/skills/rebase/SKILL.md`

#### Scenario: Per-repo skill masks the global skill of the same slug

- **GIVEN** a global `skills/rebase/SKILL.md` and a per-repo `{repo}/skills/rebase/SKILL.md` both resolve
- **WHEN** worker skills are resolved for `{repo}`
- **THEN** the per-repo `rebase` skill is the one surfaced and loadable

### Requirement: Worker-Skill Discovery

The system SHALL discover worker skills for a run by enumerating both the global and per-repo scopes, deriving each skill's `<slug>` from its directory name, and parsing the leading frontmatter for a `description`. Discovery SHALL reuse the shared `parseFrontmatter` / `extractBody` / `validateSlug` helpers. A directory whose slug is invalid, or whose `SKILL.md` is missing or has no non-empty `description`, SHALL be skipped with a debug log — discovery SHALL NOT throw. Frontmatter keys other than `description` SHALL be ignored.

#### Scenario: Valid skill discovered with trigger and body

- **GIVEN** `default_configuration/skills/rebase/SKILL.md` has frontmatter `description: "Rebase the current branch..."` and a markdown body
- **WHEN** discovery runs
- **THEN** the result includes a `rebase` entry whose description is the trimmed frontmatter value and whose body is the content after the frontmatter

#### Scenario: Skill missing a description is skipped

- **GIVEN** `skills/broken/SKILL.md` exists with no `description` in its frontmatter
- **WHEN** discovery runs
- **THEN** `broken` is not included in the result
- **AND** discovery completes without throwing

#### Scenario: Extra frontmatter keys are ignored

- **GIVEN** a skill's frontmatter contains `description`, `argument-hint`, and `allowed-tools`
- **WHEN** discovery runs
- **THEN** only `description` is read and the skill is included normally

#### Scenario: No skills present yields an empty result

- **GIVEN** neither scope contains any `skills/` directory
- **WHEN** discovery runs for a repository
- **THEN** the result is empty and no error is raised

### Requirement: WORKER SKILLS Catalog in the Execution Prompt

When at least one worker skill resolves for a change's repository, the worker execution system prompt SHALL include a `WORKER SKILLS` catalog block listing each resolved skill on its own line as `- <slug> — <description>`, alphabetized by slug, followed by a directive instructing Claude to call `load_skill({ skill: "<slug>" })` to apply one. When no worker skill resolves, the prompt SHALL be unchanged (no block).

#### Scenario: Catalog rendered when a skill resolves

- **GIVEN** the built-in `rebase` skill resolves for the run's repository
- **WHEN** the execution system prompt is assembled
- **THEN** it contains a `WORKER SKILLS` block listing `- rebase — Rebase the current branch on the latest master (or specified branch)`
- **AND** the block ends with a directive mentioning `load_skill({ skill: "<slug>" })`

#### Scenario: Catalog alphabetized

- **GIVEN** two worker skills `split-commit` and `rebase` resolve
- **WHEN** the catalog renders
- **THEN** `rebase` appears before `split-commit`

#### Scenario: No block when no skills resolve

- **GIVEN** no worker skills resolve for the repository
- **WHEN** the execution system prompt is assembled
- **THEN** no `WORKER SKILLS` block appears and the prompt is otherwise unchanged

### Requirement: load_skill Tool in Worker Mode

The worker tool set SHALL include a `load_skill({ skill })` tool that returns the resolved worker skill's body as the tool's text result, prefixed with a short preamble identifying the skill. The tool SHALL resolve the skill using the per-repo-masks-global and `configuration`-masks-`default_configuration` precedence for the run's repository, reading bodies through a process-level mtime-keyed cache so on-disk edits propagate within the same run without a restart. An unknown skill name SHALL return a clear error that points Claude back to the `WORKER SKILLS` catalog. The query-mode `pack`-based `load_skill` semantics SHALL NOT apply here; this tool takes no `pack` argument.

#### Scenario: Loads the resolved skill body

- **GIVEN** the `rebase` skill resolves for the run's repository
- **WHEN** Claude calls `load_skill({ skill: "rebase" })`
- **THEN** the tool returns text beginning with a preamble naming `rebase`
- **AND** the text contains the skill's body

#### Scenario: Edited body hot-reloads within the run

- **GIVEN** `load_skill({ skill: "rebase" })` was called and cached at mtime `T1`
- **AND** the resolved `SKILL.md` is rewritten to mtime `T2`
- **WHEN** `load_skill({ skill: "rebase" })` is called again
- **THEN** the body is re-read and the new content is returned

#### Scenario: Per-repo body wins at load time

- **GIVEN** a per-repo `{repo}/skills/rebase/SKILL.md` masks the global `rebase`
- **WHEN** Claude calls `load_skill({ skill: "rebase" })` during a run for `{repo}`
- **THEN** the per-repo body is returned

#### Scenario: Unknown skill rejected

- **WHEN** Claude calls `load_skill({ skill: "does-not-exist" })`
- **THEN** the tool returns an error naming the skill and directing Claude to the `WORKER SKILLS` catalog

### Requirement: Built-in Rebase Skill

The system SHALL ship a built-in `rebase` worker skill at `default_configuration/skills/rebase/SKILL.md` whose frontmatter `description` triggers on rebasing the current branch and whose body describes the branch-rebase procedure (detect target/default branch, fetch, check necessity, rebase, resolve conflicts or stop-and-ask when ambiguous, report). The skill SHALL be overridable via `configuration/skills/rebase/SKILL.md` and per-repo `{repo}/skills/rebase/SKILL.md` like any other worker skill.

#### Scenario: Rebase skill ships and is discoverable by default

- **GIVEN** a fresh install with no `configuration/` overrides
- **WHEN** worker skills are discovered for any repository
- **THEN** the `rebase` skill is present in the catalog and loadable via `load_skill({ skill: "rebase" })`

#### Scenario: Rebase skill is overridable

- **GIVEN** an operator writes `configuration/skills/rebase/SKILL.md`
- **WHEN** `load_skill({ skill: "rebase" })` is called
- **THEN** the operator's body is returned instead of the shipped default
