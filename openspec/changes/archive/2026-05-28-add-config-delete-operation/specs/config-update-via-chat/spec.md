# Config Update Via Chat — Delta

## MODIFIED Requirements

### Requirement: Config Update Detection

The system SHALL detect config update intent via the `propose_config_update` MCP tool call. The tool addresses target files via semantic fields (`role`, optional `topic`, `file`) and stages the resolved write path under a ref ID. The `operation` field accepts `"append"`, `"replace"`, or `"delete"`; the `content` field is required for append/replace and forbidden for delete.

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

### Requirement: Config Update Confirmation Flow

The system SHALL show a preview and require explicit confirmation before writing or deleting config files. The action button label SHALL reflect the staged operation.

#### Scenario: Show preview with Apply Update button for write operations

- **GIVEN** Claude called `propose_config_update` with `operation: "append"` or `"replace"` and included a `config_update` action in `submit_response`
- **WHEN** the response is rendered
- **THEN** the sections from `submit_response` show the preview (Claude controls the diff/preview content)
- **AND** the `config_update` action renders as an "Apply Update" button
- **AND** a `reject` action renders as a dismiss button

#### Scenario: Show Remove Override button when deleting an override with a default

- **GIVEN** Claude called `propose_config_update` with `operation: "delete"`
- **AND** the target path has both a custom override and a shipped default
- **WHEN** the response is rendered
- **THEN** the `config_update` action renders as a "Remove Override" button (or its localized equivalent)

#### Scenario: Show Delete File button when deleting a custom-only file

- **GIVEN** Claude called `propose_config_update` with `operation: "delete"`
- **AND** the target path has a custom override but NO shipped default
- **WHEN** the response is rendered
- **THEN** the `config_update` action renders as a "Delete File" button (or its localized equivalent)

#### Scenario: Apply config update — write

- **GIVEN** a pending config update staged via tool with `operation: "write"` (append or replace, both stored as write at the intent layer)
- **WHEN** an admin clicks the action button
- **THEN** the system resolves the staged intent by ref ID
- **AND** verifies the user is an admin
- **AND** validates the file path is within a known role or repository directory
- **AND** writes the content via `writeInstructionFile()`
- **AND** replies confirming the update was applied

#### Scenario: Apply config update — delete

- **GIVEN** a pending config update staged via tool with `operation: "delete"`
- **WHEN** an admin clicks the action button
- **THEN** the system resolves the staged intent by ref ID
- **AND** verifies the user is an admin
- **AND** calls `deleteInstructionFile()` on the staged path
- **AND** replies confirming the override was removed (or the file was deleted) — the confirmation wording reflects whether a default existed at the path

#### Scenario: Apply delete when override has been removed between staging and click

- **GIVEN** a pending delete intent staged via tool
- **AND** the override at the target path no longer exists (e.g., removed via the Home Tab in the meantime)
- **WHEN** an admin clicks the action button
- **THEN** the system catches the `File not found` error from `deleteInstructionFile()`
- **AND** posts an ephemeral error explaining the override is already gone
- **AND** does NOT crash the handler

#### Scenario: Dismiss config update

- **GIVEN** a pending config update staged via tool (any operation)
- **WHEN** a user clicks the dismiss/reject button
- **THEN** the ephemeral message is deleted
- **AND** no file is written or deleted

### Requirement: Config Update Auto-Execute

The system SHALL support auto-execution of config updates (including deletes) when Claude sets `auto: true`, enabling immediate file writes or deletions for clear user directives without requiring a button click.

#### Scenario: Auto-execute config write on clear directive

- **GIVEN** an admin or owner user gives a clear directive to update configuration (e.g., "update the config to add X")
- **AND** Claude calls `propose_config_update` with `operation: "append"` or `"replace"` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>", auto: true }`
- **THEN** the system writes the config file immediately via `writeInstructionFile()`
- **AND** posts a confirmation message in the thread
- **AND** does NOT render a button for the config_update action

#### Scenario: Auto-execute config delete on clear directive

- **GIVEN** an admin or owner user gives a clear directive to remove an override (e.g., "remove my override on `user/identity.md`")
- **AND** Claude calls `propose_config_update` with `operation: "delete"` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>", auto: true }`
- **THEN** the system deletes the override immediately via `deleteInstructionFile()`
- **AND** posts a confirmation message in the thread
- **AND** does NOT render a button for the config_update action

#### Scenario: Proposal mode for exploratory config discussions

- **GIVEN** an admin or owner user is exploring or discussing a potential config change (e.g., "maybe we should add X")
- **AND** Claude calls `propose_config_update` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>" }` (no `auto` or `auto: false`)
- **THEN** the system renders the operation-appropriate action button
- **AND** the config file is NOT written or deleted until the user clicks the button

#### Scenario: Auto-execute config write failure

- **GIVEN** a config update action has `auto: true` and a write-shaped intent
- **WHEN** `writeInstructionFile()` throws an error
- **THEN** the system posts an error message in the thread
- **AND** does NOT crash or affect the posted response

#### Scenario: Auto-execute config delete failure

- **GIVEN** a config update action has `auto: true` and a delete-shaped intent
- **WHEN** `deleteInstructionFile()` throws an error (e.g., file not found)
- **THEN** the system posts an error message in the thread
- **AND** does NOT crash or affect the posted response
