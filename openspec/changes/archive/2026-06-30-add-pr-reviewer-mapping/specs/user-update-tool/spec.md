## ADDED Requirements

### Requirement: update_user MCP Tool

The system SHALL provide an `update_user` MCP tool that mutates fields on a user's registry record using omit-to-keep / explicit-null-to-clear semantics over an explicit, typed argument schema. The tool SHALL NOT accept a free-form data bag; its writable surface is fixed by a zod schema that is the single source of truth. The tool SHALL target a user by `user_id` and SHALL be able to set or clear `display_name` (root identity) and `github.username`. On success the tool SHALL return the updated record's resolved identity; on a rejected write it SHALL return an error result naming the offending field and apply no changes.

#### Scenario: Omitted field is kept

- **WHEN** Claude calls `update_user` with `{ user_id, github: { username: "octo" } }` and no `display_name` key
- **THEN** the user's `github.username` is set to `"octo"`
- **AND** the existing `display_name` is left unchanged

#### Scenario: Explicit null clears a field

- **WHEN** Claude calls `update_user` with `{ user_id, github: null }`
- **THEN** the user's `github` field is removed from the record
- **AND** other fields are left unchanged

#### Scenario: Plugin namespace data is not writable

- **WHEN** Claude attempts to write plugin namespace data through `update_user`
- **THEN** the tool schema offers no argument that targets `plugins.<name>`
- **AND** existing plugin namespaces on the record are preserved across the update

#### Scenario: Unknown user_id follows the registry's placeholder behavior

- **WHEN** `update_user` is called (with an authorized field) for a `user_id` that has no existing record
- **THEN** it delegates to the registry write-through, which creates a placeholder record carrying the applied field
- **AND** does not reject the call solely because the user was previously unknown

#### Scenario: Writes go through the serialized registry chain

- **WHEN** `update_user` mutates a record
- **THEN** the write is funneled through the registry's serialized write chain so concurrent mutations do not lose updates
- **AND** the change is persisted to `data/state/users.json`

### Requirement: update_user Field-Level Permission Gating

The system SHALL enforce per-field write permissions on `update_user`, resolved from the calling Slack user's identity and role. The `display_name` field SHALL be writable only by the user themselves or by an admin-or-higher caller. The `github.username` field SHALL be writable by ANY user (any role, including editing another user's mapping), so a wrong GitHub attribution can be corrected by whoever notices it. Plugin namespace data SHALL NOT be writable through this tool by anyone.

#### Scenario: User updates their own display name

- **WHEN** a non-admin user calls `update_user` to set `display_name` on their own `user_id`
- **THEN** the update is allowed

#### Scenario: Admin updates another user's display name

- **WHEN** an admin-or-higher caller sets `display_name` on a different user's `user_id`
- **THEN** the update is allowed

#### Scenario: Non-admin cannot change another user's display name

- **WHEN** a non-admin user calls `update_user` to set `display_name` on a different user's `user_id`
- **THEN** the tool rejects the `display_name` write with a clear permission error
- **AND** does not silently drop the field

#### Scenario: Anyone can set any user's github username

- **WHEN** any user (including a non-admin) calls `update_user` to set `github.username` on a different user's `user_id`
- **THEN** the update is allowed

#### Scenario: Multi-field call is rejected atomically when one field is unauthorized

- **WHEN** a non-admin caller calls `update_user` with both `display_name` and `github.username` for a different user (authorized for `github.username`, unauthorized for `display_name`)
- **THEN** the entire call is rejected with a permission error naming `display_name`
- **AND** neither field is applied — the record is left unchanged
