# instruction-system Specification

## Purpose
Role-based directory instruction files with two-tier resolution chain for composing system prompts. Files are organized into role directories and resolved through the cascading-config-resolver.
## Requirements
### Requirement: Instruction File Convention

The system SHALL use role-based directories with topic-specific files for instruction files.

#### Scenario: Role directories replace flat files
- **WHEN** building the system prompt
- **THEN** the system scans role directories (`user/`, `dev/`, `admin/`, `owner/`) instead of loading flat files
- **AND** flat files (`instructions.md`, `user_instructions.md`, `dev_instructions.md`, `admin_instructions.md`) are NOT used

#### Scenario: Dev instructions via cascading
- **GIVEN** the user is a dev AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "dev"]`
- **AND** `dev/*.md` files override matching `user/*.md` files

#### Scenario: Admin instructions via cascading
- **GIVEN** the user is an admin or owner AND changesWorkflow is enabled for the trigger
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "dev", "admin"]` (or including `"owner"` for owner)
- **AND** higher role files override matching lower role files

#### Scenario: Admin without changesWorkflow
- **GIVEN** the user is an admin or owner AND changesWorkflow is NOT enabled
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user", "admin"]`
- **AND** the dev layer is skipped entirely

#### Scenario: User/member instructions
- **GIVEN** the user is a member OR changesWorkflow is not enabled for a dev user
- **WHEN** building the system prompt
- **THEN** the system resolves instructions with role chain `["user"]` only

#### Scenario: Repository-scoped instruction files
- **GIVEN** a repository named `{repo-name}` is configured in `config.repositories`
- **WHEN** the system enumerates known instruction files
- **THEN** it includes `{repo-name}/changes_instructions.md` and `{repo-name}/worktree_setup_instructions.md`
- **AND** these files follow the same two-tier resolution chain
- **AND** they are NOT part of the role cascading system

### Requirement: Two-Tier Resolution Chain

The system SHALL resolve instruction files through a two-tier lookup within each role directory.

#### Scenario: Override exists in configuration
- **GIVEN** a file exists at `data/configuration/{role}/{filename}`
- **WHEN** the system resolves that instruction file for that role level
- **THEN** it uses the file from `data/configuration/{role}/`

#### Scenario: No override, use default
- **GIVEN** a file does not exist at `data/configuration/{role}/{filename}`
- **AND** a file exists at `data/default_configuration/{role}/{filename}`
- **WHEN** the system resolves that instruction file for that role level
- **THEN** it uses the file from `data/default_configuration/{role}/`

#### Scenario: Startup validation
- **WHEN** the system starts up
- **THEN** it validates that at least one instruction file exists in the `user/` directory (in either tier)
- **AND** fails fast with a descriptive error if no `user/` files are found

### Requirement: Prompt Composition

The system SHALL compose the final system prompt by resolving all files through the cascade and concatenating.

#### Scenario: Compose from cascaded files
- **WHEN** building the system prompt
- **THEN** the system resolves each unique filename through the role cascade
- **AND** concatenates all non-empty resolved files in alphabetical order by filename
- **AND** interpolates variables after concatenation

#### Scenario: Instruction files contain behavioral guidance only
- **WHEN** instruction files are authored or customized
- **THEN** they contain tone, style, and behavioral rules
- **AND** they do NOT contain XML format documentation or state dump placeholders
- **AND** dynamic state (repositories, sessions, config files) is available to Claude via query tools instead

### Requirement: Default Configuration Directory

The system SHALL ship default instruction files in role directories under `data/default_configuration/`. Slack rendering guidance (Block Kit formatting, Slack formatting, response style, rich submit-response composition) SHALL ship under the built-in topic folder `user/topics/response-rendering/` rather than as baseline files; the baseline `user/submit-response.md` SHALL be the contract stub defined by the `builtin-topics` capability.

#### Scenario: Default files included in repository
- **WHEN** the project is checked out
- **THEN** `data/default_configuration/user/` exists with baseline files (identity, submit-response contract stub, URLs, changes)
- **AND** `data/default_configuration/user/topics/response-rendering/` exists with the rendering-guidance files (Block Kit formatting, Slack formatting, response style, rich submit-response guidance)
- **AND** `data/default_configuration/dev/` exists with topic files (GitHub, changes)
- **AND** `data/default_configuration/admin/` exists with topic files (config updates)

#### Scenario: Default files copied to Docker image
- **WHEN** the Docker image is built
- **THEN** the `data/default_configuration/` directory including all role subdirectories is included in the image

#### Scenario: Re-homed operator override wins over shipped topic default
- **GIVEN** an operator override of a moved file re-homed at `data/configuration/user/topics/response-rendering/block-kit-formatting.md`
- **WHEN** a session with `response-rendering` attached assembles its prompt
- **THEN** the cascade resolver loads the operator's version in preference to the shipped file at `data/default_configuration/user/topics/response-rendering/block-kit-formatting.md`

## ADDED Requirements

### Requirement: Language Directive Injection in User-Facing Prompt Composition

When the configured language is not `"en"`, the user-facing system prompt composition pipeline (`buildSystemPrompt`) SHALL inject the language directive defined by the `localization` capability into the assembled prompt.

The directive SHALL be:
- Injected on every user-facing prompt path: Q&A queries (reactions, DMs, mentions, assistant), change-workflow runs (worker mode), scheduled-cron runs, plugin-triggered runs, follow-up runs, and PR-comment review runs.
- Omitted from the pre-analysis prompt path (which produces internal triage reasoning, never shown to users).
- Placed at the top of the assembled prompt, before any role-cascaded behavioral instructions, so that it functions as a top-level constraint rather than a tail addendum.
- Composed by reading the configured language code from `getConfig().language`, looking up the language metadata (EN name, native name) from the localization language registry, and rendering the directive template.

When the configured language is `"en"` (or absent), the prompt composition pipeline SHALL produce a prompt byte-identical to its pre-localization output. The directive renderer SHALL NOT emit blank lines, separators, or anchor comments when the directive is omitted.

#### Scenario: Directive injected on Q&A path when language is "fr"

- **GIVEN** the configured language is `"fr"`
- **WHEN** `buildSystemPrompt` is called for a DM, mention, reaction, or assistant Q&A run
- **THEN** the resulting prompt contains the rendered language directive
- **AND** the directive is positioned at the top of the assembled prompt, before any role-cascaded instructions

#### Scenario: Directive injected on change-workflow path when language is "fr"

- **GIVEN** the configured language is `"fr"`
- **WHEN** the change-workflow execution prompt is assembled (worker mode, follow-up, review, merge, close, update)
- **THEN** the assembled prompt contains the rendered language directive

#### Scenario: Directive injected on scheduled and plugin-triggered paths

- **GIVEN** the configured language is `"fr"`
- **WHEN** a scheduled cron job fires or a plugin-triggered run is invoked
- **THEN** the assembled prompt contains the rendered language directive

#### Scenario: Directive omitted on pre-analysis path

- **GIVEN** the configured language is `"fr"`
- **WHEN** the pre-analysis prompt is assembled (auto-respond rule evaluation, intent triage)
- **THEN** the assembled prompt does NOT contain a language directive
- **AND** pre-analysis output remains in English (internal reasoning, not user-facing)

#### Scenario: No directive and no whitespace artifact when language is "en"

- **GIVEN** the configured language is `"en"` (or absent)
- **WHEN** `buildSystemPrompt` runs
- **THEN** the assembled prompt is byte-identical to its pre-localization form
- **AND** the directive renderer contributes no blank lines, separators, or marker comments

#### Scenario: Directive uses native language name

- **GIVEN** the configured language is `"fr"`
- **WHEN** the directive is rendered
- **THEN** the rendered text refers to the language as both "French" and "Français"
- **AND** the source of the native name is the localization language registry, not a hard-coded literal in `buildSystemPrompt`
