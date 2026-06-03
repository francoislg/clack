## MODIFIED Requirements

### Requirement: List Config Files Tool

The system SHALL provide a `list_config_files` MCP tool that returns instruction files grouped by role, with topic-scoped files surfaced under each role, and per-repository files grouped per repo. Files are addressed by semantic fields (`role`, `topic`, `file`, or `repo`, `file`) rather than path-prefixed strings. The tool SHALL accept an optional `query` string parameter: when omitted, it returns the full listing without reading file content; when provided, it case-insensitively substring-searches the content of every listed file (across both the default and custom layers) and returns only files that match, annotated with their hits.

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

#### Scenario: Omitting query preserves full listing behavior

- **WHEN** Claude calls `list_config_files` with no `query` (or an empty/whitespace-only `query`)
- **THEN** the response is the full listing as described above
- **AND** no file content is read
- **AND** no `matches` field is attached to file entries and no `summary` field is present

#### Scenario: Query filters listing to files whose content matches

- **GIVEN** the string `"octagonal_sign"` appears in `admin/topics/trivia/reveal-tone.md` but not in `dev/identity.md`
- **WHEN** Claude calls `list_config_files` with `query: "octagonal_sign"`
- **THEN** `admin/topics/trivia/reveal-tone.md` is present in the result
- **AND** `dev/identity.md` is absent
- **AND** roles, topic groups, and repo groups left with no matching files are omitted from the response

#### Scenario: Matching file entries are annotated with hits

- **GIVEN** a file matches the query
- **WHEN** Claude calls `list_config_files` with that `query`
- **THEN** the file entry includes a `matches` array
- **AND** each hit identifies the `layer` (`"default"` or `"custom"`), the 1-based `line` number, and a `snippet` of the matching line

#### Scenario: Both layers searched independently

- **GIVEN** a file whose default content contains the query but whose custom override does not (or vice versa)
- **WHEN** Claude calls `list_config_files` with that `query`
- **THEN** the file's `matches` include only hits from the layer(s) that actually contain the string, each tagged with the correct `layer`

#### Scenario: Search is case-insensitive

- **GIVEN** a file containing `"Medal"`
- **WHEN** Claude calls `list_config_files` with `query: "medal"`
- **THEN** the file is returned with a hit for that line

#### Scenario: Query matches nothing

- **WHEN** Claude calls `list_config_files` with a `query` that no file contains
- **THEN** the response is a valid listing with empty `roles`, `preAnalysis`, and `repos`
- **AND** no error is returned
- **AND** the `summary` reports zero matching files

#### Scenario: Search covers pre-analysis and repo files

- **GIVEN** the query string appears only in a `pre-analysis/*.md` file and a repo `changes_instructions.md`
- **WHEN** Claude calls `list_config_files` with that `query`
- **THEN** the matching pre-analysis file appears in `preAnalysis` with its hits
- **AND** the matching repo file appears under its repo in `repos` with its hits

#### Scenario: Non-admin user cannot access tool

- **GIVEN** a non-admin user
- **WHEN** the tool server is built
- **THEN** `list_config_files` is NOT registered
- **AND** Claude cannot call it regardless of prompt instructions
