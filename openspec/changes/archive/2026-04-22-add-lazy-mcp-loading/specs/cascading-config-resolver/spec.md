## ADDED Requirements

### Requirement: Topic Subfolders Within Role Directories

The system SHALL support a `topics/<topic-name>/` subfolder within each role directory for instructions that are only loaded when a specific integration or topic is active. Baseline resolution (without any active topics) SHALL NOT include these files.

#### Scenario: Topic subfolders ignored at baseline

- **GIVEN** `data/default_configuration/user/topics/metabase/metabase.md` exists
- **AND** no other files reference the `metabase` topic
- **WHEN** the resolver is called without an `activeTopics` argument (or with an empty set)
- **THEN** the content of `metabase.md` is NOT included in the resolved output

#### Scenario: Active topic file included

- **GIVEN** `data/default_configuration/user/topics/metabase/metabase.md` exists with content "Metabase rules"
- **WHEN** the resolver is called with `activeTopics = new Set(["metabase"])` and role chain `["user"]`
- **THEN** the content "Metabase rules" is included in the resolved output
- **AND** the section is prefixed with a topic header (`=== TOPIC: metabase ===`) for readability

#### Scenario: Topic files cascade default → custom per file

- **GIVEN** `default_configuration/user/topics/metabase/metabase.md` exists with default content
- **AND** `configuration/user/topics/metabase/metabase.md` exists with custom content
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase"])` and role chain `["user"]`
- **THEN** the custom content wins (same rule as baseline files)

#### Scenario: Additive topic file with no default counterpart

- **GIVEN** `configuration/user/topics/metabase/company-dashboards.md` exists
- **AND** no `default_configuration/user/topics/metabase/company-dashboards.md` exists
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase"])` and role chain `["user"]`
- **THEN** `company-dashboards.md` is included as an additive topic file alongside any other resolved `metabase` files

#### Scenario: Topic files cascade across role chain

- **GIVEN** `default_configuration/user/topics/metabase/metabase.md` exists with content "User-level rules"
- **AND** `default_configuration/dev/topics/metabase/metabase.md` exists with content "Dev-level rules"
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase"])` and role chain `["user", "dev"]`
- **THEN** the dev-level content wins (same override rule as baseline files)

#### Scenario: Multiple files within a single topic

- **GIVEN** `topics/metabase/metabase.md` and `topics/metabase/company-dashboards.md` both exist
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase"])`
- **THEN** both files are included under a single `=== TOPIC: metabase ===` header
- **AND** the files within the topic section are concatenated in alphabetical filename order (`company-dashboards.md` before `metabase.md`)
- **AND** no per-file header is emitted (only the one topic-level header)

#### Scenario: Multiple active topics concatenated under their headers

- **GIVEN** `topics/metabase/metabase.md` and `topics/monday/monday.md` both exist
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase", "monday"])`
- **THEN** both sets of content are included in the output
- **AND** each is prefixed with its own topic header (`=== TOPIC: metabase ===`, `=== TOPIC: monday ===`)
- **AND** topic sections appear in alphabetical order by topic name

#### Scenario: Empty topic file suppresses

- **GIVEN** `default_configuration/user/topics/metabase/metabase.md` has content
- **AND** `configuration/user/topics/metabase/metabase.md` is empty (or whitespace-only)
- **WHEN** the resolver runs with `activeTopics = new Set(["metabase"])` and role chain `["user"]`
- **THEN** `metabase.md` is NOT included in the resolved output (same rule as baseline files)

#### Scenario: Plugin virtual topic defaults

- **GIVEN** a plugin provides a virtual default for `user/topics/custom-topic/rules.md`
- **AND** no disk default or custom override exists for that path
- **WHEN** the resolver runs with `activeTopics = new Set(["custom-topic"])` and role chain `["user"]`
- **THEN** the plugin's virtual content is included in the resolved output

### Requirement: Baseline Resolution Unchanged

The system SHALL preserve exact behavior of baseline (non-topic) file resolution for backward compatibility.

#### Scenario: No activeTopics argument behaves like today

- **WHEN** `resolveInstructions(roleChain)` is called without an `activeTopics` argument
- **THEN** the returned string is byte-identical to what the pre-topic-support implementation would have returned for the same role chain and file layout
- **AND** files under `topics/` subfolders are fully ignored

#### Scenario: Empty activeTopics set behaves like no argument

- **WHEN** `resolveInstructions(roleChain, new Set())` is called
- **THEN** the returned string is byte-identical to `resolveInstructions(roleChain)`

### Requirement: Topic File Discovery in Home Tab

The system SHALL surface topic files in instruction-file listings alongside baseline files, with their topic-scoped path visible so admins can edit them.

#### Scenario: Listing includes topic files with topic-scoped path

- **GIVEN** `data/configuration/user/topics/metabase/metabase.md` exists
- **WHEN** the instruction-file listing is generated (for Home Tab or MCP tools)
- **THEN** the entry is listed with a path like `user/topics/metabase/metabase.md` (topic subfolder visible in the path)
- **AND** it can be edited through the same UI flow as baseline files
