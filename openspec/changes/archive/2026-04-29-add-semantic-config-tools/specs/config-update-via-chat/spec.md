## MODIFIED Requirements

### Requirement: Read Config File Tool

The system SHALL provide a `read_config_file` MCP tool that returns both default and custom content for an instruction file, available only to admin and owner users. The tool addresses files via semantic fields (`role`, optional `topic`, `file`) rather than a single path string.

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

- **WHEN** Claude calls `read_config_file` with a `file` that does not end in `.md` (e.g., `"identity"` or `"identity.txt"`)
- **THEN** the tool rejects the call at the schema layer

#### Scenario: Reject filename containing slashes

- **WHEN** Claude calls `read_config_file` with a `file` containing `/` (e.g., `"topics/metabase/rules.md"`)
- **THEN** the tool rejects the call at the schema layer
- **AND** the error message states that `file` must be a bare filename (no slashes) and explicitly directs the caller to use the `topic` field for topic-scoped paths

#### Scenario: Reject filename with disallowed characters

- **WHEN** Claude calls `read_config_file` with a `file` containing characters outside `[A-Za-z0-9_.-]` (e.g., `"my file.md"`, `"file@v2.md"`)
- **THEN** the tool rejects the call at the schema layer

### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call. The tool addresses target files via semantic fields (`role`, optional `topic`, `file`) and stages the resolved write path under a ref ID.

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

#### Scenario: Propose new file under a brand-new topic

- **GIVEN** an admin asks Claude to add instructions for an integration that has no instruction files yet
- **WHEN** Claude calls `propose_config_update` with `{ role: "user", topic: "newintegration", file: "rules.md", content, operation: "replace" }`
- **AND** no file currently exists at any tier for that path
- **THEN** the tool stages a `config_update` intent with the new path and the provided content
- **AND** when applied, the parent directory `data/configuration/user/topics/newintegration/` is created automatically before writing

#### Scenario: Replace operation overwrites the file with provided content

- **GIVEN** Claude calls `propose_config_update` with `operation: "replace"` and a baseline or topic-scoped target
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

The system SHALL provide a `list_config_files` MCP tool that returns instruction files grouped by role, with topic-scoped files surfaced under each role. Files are addressed by semantic fields (`role`, `topic`, `file`) rather than path-prefixed strings.

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
- **AND** each entry has a `repo` name and a `files` list scoped to that repo's instruction files (e.g., `changes_instructions.md`, `worktree_setup_instructions.md`)

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

## REMOVED Requirements

### Requirement: Resolved View for Admins

**Reason**: The resolved-view feature was implemented as a schema overload — passing a role name (e.g., `"dev"`) as the `file` parameter triggered a different code path that returned the cascaded view. Switching to semantic fields (`role`, `topic?`, `file`) makes this overload incoherent. Removing it now keeps the tool surface clean. If the use case re-emerges, it gets a dedicated tool (e.g., `resolve_role_instructions`) with its own schema, including support for active topics in the resolved view.

**Migration**: Admins who previously asked Claude "what does a dev see?" now get the answer by listing files for the role and reading them individually, or by waiting for a future dedicated resolved-view tool. The replacement tool is out of scope for this change.
