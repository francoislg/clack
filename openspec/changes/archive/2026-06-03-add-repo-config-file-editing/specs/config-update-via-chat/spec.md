## ADDED Requirements

### Requirement: Centralized Per-Repo Instruction File Set

The system SHALL define the set of editable per-repository instruction files in a single centralized constant that every consumer imports. Adding or removing an editable per-repo file SHALL require editing only that one constant.

The set SHALL contain exactly the per-repo **markdown** instruction files: `changes_instructions.md`, `worktree_setup_instructions.md`, and `worktree_install_instructions.md`. It SHALL NOT contain `worktree_dirty_ignore.txt` (a non-markdown globs file).

#### Scenario: Single source of truth drives the schema enum

- **WHEN** the repo-mode `file` enum is constructed for `read_config_file` and `propose_config_update`
- **THEN** its members are derived from the centralized constant (not an inline literal list)
- **AND** the accepted file values are exactly `changes_instructions.md`, `worktree_setup_instructions.md`, `worktree_install_instructions.md`

#### Scenario: Single source of truth drives the file listing

- **WHEN** `list_config_files` enumerates each repository's files
- **THEN** the per-repo file names are derived from the same centralized constant
- **AND** all three markdown files appear for every configured repository

### Requirement: Repository-Scoped Config File Addressing

The system SHALL allow `read_config_file` and `propose_config_update` to address per-repository instruction files via a `repo` field, mutually exclusive with the role-based fields. In repo mode the caller passes `{ repo, file }`; the resolved path is `{repo}/{file}`.

#### Scenario: Exactly one of role or repo required

- **WHEN** Claude calls `read_config_file` or `propose_config_update` with both `role` and `repo`, or with neither
- **THEN** the tool rejects the call at the schema layer
- **AND** the error states that exactly one of `role` or `repo` must be provided

#### Scenario: Topic rejected in repo mode

- **WHEN** Claude calls a config tool with `repo` and a `topic` field
- **THEN** the tool rejects the call at the schema layer
- **AND** the error states that `topic` is not valid for repo-scoped files

#### Scenario: Repo-mode file restricted to the editable set

- **WHEN** Claude calls a config tool with `repo` and a `file` outside the centralized per-repo set (e.g. `worktree_dirty_ignore.txt`, `README.md`)
- **THEN** the tool rejects the call at the schema layer
- **AND** the error lists the allowed per-repo file names

#### Scenario: Unknown repository rejected at the tool layer

- **WHEN** Claude calls a config tool with a `repo` that is not a configured repository
- **THEN** the tool returns an error (does NOT stage an intent)
- **AND** the error lists the configured repository names

#### Scenario: Repo-mode path resolution

- **WHEN** Claude calls a config tool with `{ repo: "applauz-monorepo", file: "changes_instructions.md" }` for a configured repo
- **THEN** the tool resolves the path to `applauz-monorepo/changes_instructions.md`

## MODIFIED Requirements

### Requirement: Read Config File Tool

The system SHALL provide a `read_config_file` MCP tool that returns both default and custom content for an instruction file, available only to admin and owner users. The tool addresses files via semantic fields — either role-based (`role`, optional `topic`, `file`) or repo-based (`repo`, `file`) — rather than a single path string. Role and repo addressing are mutually exclusive (see "Repository-Scoped Config File Addressing").

#### Scenario: Read baseline file with both default and custom content

- **WHEN** Claude calls `read_config_file` with `{ role: "user", file: "identity.md" }`
- **AND** both a default and custom version exist on disk for `user/identity.md`
- **THEN** the tool returns `default_content` with the shipped default content
- **AND** returns `custom_content` with the override content

#### Scenario: Read baseline file with default only

- **WHEN** Claude calls `read_config_file` with `{ role: "dev", file: "changes.md" }`
- **AND** a default exists at `default_configuration/dev/changes.md` but no custom override
- **THEN** the tool returns `default_content` with the shipped content
- **AND** returns `custom_content` as `null`

#### Scenario: Read baseline file with custom only

- **WHEN** Claude calls `read_config_file` with `{ role: "user", file: "company-context.md" }`
- **AND** only a custom file exists (no shipped default)
- **THEN** the tool returns `default_content` as `null`
- **AND** returns `custom_content` with the file content

#### Scenario: Read topic-scoped file

- **WHEN** Claude calls `read_config_file` with `{ role: "dev", topic: "metabase", file: "queries.md" }`
- **AND** the file exists on disk at `data/configuration/dev/topics/metabase/queries.md`
- **THEN** the tool returns the file content under `custom_content`
- **AND** returns the default-tier content (if any) under `default_content`

#### Scenario: Read topic-scoped file with both default and custom content

- **WHEN** Claude calls `read_config_file` with `{ role: "dev", topic: "metabase", file: "rules.md" }`
- **AND** both `data/default_configuration/dev/topics/metabase/rules.md` and `data/configuration/dev/topics/metabase/rules.md` exist
- **THEN** the tool returns the shipped default under `default_content`
- **AND** returns the override under `custom_content`

#### Scenario: Read repo-scoped file

- **WHEN** Claude calls `read_config_file` with `{ repo: "applauz-monorepo", file: "changes_instructions.md" }` for a configured repo
- **THEN** the tool resolves `applauz-monorepo/changes_instructions.md`
- **AND** returns the shipped default (if any) under `default_content` and the override (if any) under `custom_content`

#### Scenario: Topic-scoped file not found

- **WHEN** Claude calls `read_config_file` with a topic-scoped reference that does not exist in either tier
- **THEN** the tool returns `default_content: null` and `custom_content: null`
- **AND** does not error

#### Scenario: Reject invalid role

- **WHEN** Claude calls `read_config_file` with a `role` that is not one of `user`, `dev`, `admin`, `owner` (e.g., `"developer"`)
- **THEN** the tool rejects the call at the schema layer
- **AND** the rejection identifies the allowed role values

#### Scenario: Reject path-traversal in topic

- **WHEN** Claude calls `read_config_file` with a `topic` containing characters outside the safe set (e.g., `"../../etc"` or `"foo/bar"`)
- **THEN** the tool rejects the call at the schema layer

#### Scenario: Reject filename without `.md` extension

- **WHEN** Claude calls `read_config_file` with a role-mode `file` that does not end in `.md` (e.g., `"identity"` or `"identity.txt"`)
- **THEN** the tool rejects the call at the schema layer

#### Scenario: Reject filename containing slashes

- **WHEN** Claude calls `read_config_file` with a role-mode `file` containing `/` (e.g., `"topics/metabase/rules.md"`)
- **THEN** the tool rejects the call at the schema layer
- **AND** the error message states that `file` must be a bare filename (no slashes) and explicitly directs the caller to use the `topic` field for topic-scoped paths

#### Scenario: Reject filename with disallowed characters

- **WHEN** Claude calls `read_config_file` with a role-mode `file` containing characters outside `[A-Za-z0-9_.-]` (e.g., `"my file.md"`, `"file@v2.md"`)
- **THEN** the tool rejects the call at the schema layer

### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call. The tool addresses target files via semantic fields — either role-based (`role`, optional `topic`, `file`) or repo-based (`repo`, `file`), mutually exclusive (see "Repository-Scoped Config File Addressing") — and stages the resolved write path under a ref ID. The `operation` field accepts `"append"`, `"replace"`, or `"delete"`; the `content` field is required for append/replace and forbidden for delete.

#### Scenario: Propose update to a baseline file

- **GIVEN** an admin or owner user asked Claude to update a baseline configuration file
- **WHEN** Claude calls `propose_config_update` with `{ role: "user", file: "identity.md", content, operation }`
- **THEN** the tool resolves the path to `user/identity.md`
- **AND** stages a `config_update` intent with that path and the resulting content under a ref ID

#### Scenario: Propose update to a topic-scoped file

- **GIVEN** an admin or owner user asked Claude to update an integration topic's instructions
- **WHEN** Claude calls `propose_config_update` with `{ role: "dev", topic: "metabase", file: "rules.md", content, operation }`
- **THEN** the tool resolves the path to `dev/topics/metabase/rules.md`
- **AND** stages a `config_update` intent with that path and the resulting content under a ref ID

#### Scenario: Propose update to a repo-scoped file

- **GIVEN** an admin or owner user asked Claude to update a repository's changes instructions
- **WHEN** Claude calls `propose_config_update` with `{ repo: "applauz-monorepo", file: "changes_instructions.md", content, operation }` for a configured repo
- **THEN** the tool resolves the path to `applauz-monorepo/changes_instructions.md`
- **AND** stages a `config_update` intent with that path and the resulting content under a ref ID

#### Scenario: Reject propose for unknown repo

- **WHEN** Claude calls `propose_config_update` with a `repo` that is not a configured repository
- **THEN** the tool returns an error and does NOT stage an intent
- **AND** the error lists the configured repository names

#### Scenario: Propose new file under a brand-new topic

- **GIVEN** an admin asks Claude to add instructions for an integration that has no instruction files yet
- **WHEN** Claude calls `propose_config_update` with `{ role: "user", topic: "newintegration", file: "rules.md", content, operation: "replace" }`
- **AND** no file currently exists at any tier for that path
- **THEN** the tool stages a `config_update` intent with the new path and the provided content
- **AND** when applied, the parent directory `data/configuration/user/topics/newintegration/` is created automatically before writing

#### Scenario: Replace operation overwrites the file with provided content

- **GIVEN** Claude calls `propose_config_update` with `operation: "replace"` and a baseline, topic-scoped, or repo-scoped target
- **WHEN** the tool resolves the file
- **THEN** it stages the provided `content` as the complete replacement (without reading current content)
- **AND** the staged intent's content equals the provided `content` byte-for-byte

#### Scenario: Operation field defaults to append when omitted

- **WHEN** Claude calls `propose_config_update` without an `operation` field
- **THEN** the tool treats the call as `operation: "append"`
- **AND** reads the current content per the append-operation precedence rules
- **AND** stages the combined result

#### Scenario: Append operation reads current content for baseline files

- **GIVEN** Claude calls `propose_config_update` with `operation: "append"` (or omitted) and a baseline `{ role, file }`
- **WHEN** the tool resolves the file
- **THEN** it reads the current file content via the same precedence as the cascade resolver (custom override, or default if no override)
- **AND** appends the provided content
- **AND** stages the combined result

#### Scenario: Append operation reads current content for topic files

- **GIVEN** Claude calls `propose_config_update` with `operation: "append"` and a topic-scoped `{ role, topic, file }`
- **WHEN** the tool resolves the file
- **THEN** it reads the current topic-file content (custom override, or default if no override)
- **AND** appends the provided content
- **AND** stages the combined result

#### Scenario: Append operation reads current content for repo files

- **GIVEN** Claude calls `propose_config_update` with `operation: "append"` and a repo-scoped `{ repo, file }`
- **WHEN** the tool resolves the file
- **THEN** it reads the current repo-file content (custom override, or default if no override)
- **AND** appends the provided content
- **AND** stages the combined result

#### Scenario: Propose delete of a baseline override

- **GIVEN** an admin asked Claude to remove a custom override on a baseline file
- **AND** a custom override exists at `data/configuration/user/identity.md`
- **WHEN** Claude calls `propose_config_update` with `{ role: "user", file: "identity.md", operation: "delete" }`
- **THEN** the tool resolves the path to `user/identity.md`
- **AND** stages a `config_update` intent shaped as `{ type: "config_update", operation: "delete", file: "user/identity.md" }` (no `content` field)

#### Scenario: Propose delete of a topic-scoped override

- **GIVEN** an admin asked Claude to remove a custom override on a topic-scoped file
- **AND** a custom override exists at `data/configuration/dev/topics/metabase/rules.md`
- **WHEN** Claude calls `propose_config_update` with `{ role: "dev", topic: "metabase", file: "rules.md", operation: "delete" }`
- **THEN** the tool resolves the path to `dev/topics/metabase/rules.md`
- **AND** stages a delete-shaped `config_update` intent under a ref ID

#### Scenario: Propose delete of a repo-scoped override

- **GIVEN** an admin asked Claude to remove a repo's customized instructions
- **AND** a custom override exists at `data/configuration/applauz-monorepo/changes_instructions.md`
- **WHEN** Claude calls `propose_config_update` with `{ repo: "applauz-monorepo", file: "changes_instructions.md", operation: "delete" }`
- **THEN** the tool resolves the path to `applauz-monorepo/changes_instructions.md`
- **AND** stages a delete-shaped `config_update` intent under a ref ID

#### Scenario: Refuse delete when no override exists

- **GIVEN** Claude calls `propose_config_update` with `operation: "delete"`
- **AND** no custom override file exists at the resolved path (only the shipped default, or nothing at all)
- **THEN** the tool returns an error and does NOT stage an intent
- **AND** the error explains that there is no custom override to delete

#### Scenario: Refuse delete with content payload

- **GIVEN** Claude calls `propose_config_update` with `operation: "delete"` AND a non-empty `content` field
- **THEN** the tool returns an error and does NOT stage an intent
- **AND** the error explains that `content` must be omitted when deleting

#### Scenario: Refuse append or replace with missing content

- **GIVEN** Claude calls `propose_config_update` with `operation: "append"` or `"replace"` and no `content` field
- **THEN** the tool returns an error and does NOT stage an intent

#### Scenario: Reject invalid role

- **WHEN** Claude calls `propose_config_update` with a `role` that is not `user`, `dev`, `admin`, or `owner`
- **THEN** the tool rejects the call at the schema layer

#### Scenario: Reject path-traversal in topic

- **WHEN** Claude calls `propose_config_update` with a `topic` containing characters outside the safe set
- **THEN** the tool rejects the call at the schema layer

#### Scenario: Non-admin user cannot access tool

- **GIVEN** a non-admin user
- **WHEN** the tool server is built
- **THEN** `propose_config_update` is NOT registered
- **AND** Claude cannot call it regardless of prompt instructions

### Requirement: List Config Files Tool

The system SHALL provide a `list_config_files` MCP tool that returns instruction files grouped by role, with topic-scoped files surfaced under each role, and per-repository files grouped per repo. Files are addressed by semantic fields (`role`, `topic`, `file`, or `repo`, `file`) rather than path-prefixed strings.

#### Scenario: List baseline and topic files grouped by role

- **WHEN** Claude calls `list_config_files`
- **THEN** the response contains a `roles` array
- **AND** each role entry contains a `role` name, a `files` array (baseline files), and a `topics` array (topic-scoped groups)
- **AND** each file entry includes its `file` name and source `status` (`"default"`, `"customized"`, `"custom-only"`, `"plugin"`, or `"plugin-customized"`)

#### Scenario: Topic groups list files for that topic only

- **GIVEN** `data/configuration/user/topics/metabase/rules.md` and `data/default_configuration/user/topics/metabase/setup.md` exist
- **WHEN** Claude calls `list_config_files`
- **THEN** the `user` role's `topics` array contains an entry with `topic: "metabase"` and a `files` array listing both `rules.md` (status `customized`) and `setup.md` (status `default`)

#### Scenario: Role with no topic files

- **GIVEN** a role directory has baseline files but no `topics/` subdirectory
- **WHEN** Claude calls `list_config_files`
- **THEN** that role's entry contains an empty `topics` array

#### Scenario: Multiple topics under a single role

- **GIVEN** `data/configuration/dev/topics/metabase/` and `data/configuration/dev/topics/monday/` both contain files
- **WHEN** Claude calls `list_config_files`
- **THEN** the `dev` role's `topics` array contains two entries (one per topic), each with its own `files` list

#### Scenario: Repo files grouped per repo

- **WHEN** Claude calls `list_config_files`
- **THEN** the response includes a `repos` array
- **AND** each entry has a `repo` name and a `files` list covering all three editable per-repo markdown files (`changes_instructions.md`, `worktree_setup_instructions.md`, `worktree_install_instructions.md`), each with its source status
- **AND** the file names are derived from the centralized per-repo file constant

#### Scenario: Role with no files at all

- **GIVEN** a role directory that exists in either tier but has zero `.md` files (and no `topics/` content)
- **WHEN** Claude calls `list_config_files`
- **THEN** the role is omitted from the `roles` array (consistent with the existing `listRoleDirFiles` behavior that skips empty role directories)
- **AND** the response remains a valid shape with no error

#### Scenario: Non-admin user cannot access tool

- **GIVEN** a non-admin user
- **WHEN** the tool server is built
- **THEN** `list_config_files` is NOT registered
- **AND** Claude cannot call it regardless of prompt instructions
