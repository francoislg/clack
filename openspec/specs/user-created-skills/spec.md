# user-created-skills Specification

## Purpose
Enable org members to author reusable skills directly from Slack, persisted on disk and available in every Claude session. Skills are discoverable via the Home Tab, loadable on-demand via `load_skill`, and manageable (create, update, disable, restore) through intent-staged Slack actions.
## Requirements
### Requirement: userSkills Config Block

The system SHALL accept an optional `userSkills` block in `data/config.json` with an `enabled: boolean` field. When `enabled` is `false` or the block is absent, the feature SHALL be fully inert: none of the new MCP tools are registered, the prompt catalog renders no "USER SKILLS" subsection, the Home Tab Skills section is hidden, and the `data/user-skills/` directory is ignored even if it contains files. The parser SHALL reject non-object `userSkills`, non-boolean `enabled`, and unknown sibling keys with clear errors.

#### Scenario: Default disabled when block absent

- **GIVEN** `data/config.json` contains no `userSkills` field
- **WHEN** `loadConfig()` runs
- **THEN** the returned Config has `userSkills.enabled === false` (or `userSkills` is `undefined` and consumers treat that as disabled)
- **AND** no user-skills MCP tools are registered for new sessions

#### Scenario: Explicit enable

- **GIVEN** `data/config.json` contains `"userSkills": { "enabled": true }`
- **WHEN** `loadConfig()` runs
- **THEN** `getConfig().userSkills.enabled` is `true`

#### Scenario: Invalid type rejected

- **GIVEN** `data/config.json` contains `"userSkills": { "enabled": "yes" }`
- **WHEN** `loadConfig()` runs
- **THEN** a clear error identifying `userSkills.enabled` as requiring boolean is thrown

#### Scenario: Toggling enabled hot-reloads via lifecycle

- **GIVEN** Clack is running with `userSkills.enabled: false`
- **WHEN** an admin edits `data/config.json` to set `userSkills.enabled: true`
- **THEN** the existing config watcher triggers a full lifecycle reload
- **AND** subsequent new sessions register the user-skills MCP tools
- **AND** subsequent prompt builds include the "USER SKILLS" subsection (when at least one enabled skill exists)

### Requirement: User Skill Storage Layout

When `userSkills.enabled === true`, the system SHALL recognize user-authored skills under `data/user-skills/<slug>/` where each `<slug>` directory contains:
- `SKILL.md` — YAML frontmatter (`name`, `description`) followed by the body
- `.meta.json` — a JSON sidecar with `{ ownerUserId, createdAt, updatedAt, disabledAt?, editableByAnyone? }`

The `name` field in the SKILL.md frontmatter MUST equal the directory slug. Directories missing `SKILL.md` or `.meta.json` SHALL be ignored (logged at debug level). The `data/user-skills/` directory does NOT need to exist for the feature to be enabled; an empty pack is valid. The optional `editableByAnyone` field SHALL default to `false` when absent.

#### Scenario: Discovery finds well-formed skills

- **GIVEN** `data/user-skills/copy-improver/SKILL.md` exists with frontmatter `name: copy-improver` and a non-empty description
- **AND** `data/user-skills/copy-improver/.meta.json` exists with valid JSON
- **WHEN** the user-skills discovery scans the directory
- **THEN** `copy-improver` is returned in the result list with its metadata

#### Scenario: Directory missing SKILL.md is ignored

- **GIVEN** `data/user-skills/broken/.meta.json` exists but `data/user-skills/broken/SKILL.md` does not
- **WHEN** discovery scans
- **THEN** `broken` is NOT included in the result list
- **AND** a debug-level log records the skip reason

#### Scenario: Directory missing .meta.json is ignored

- **GIVEN** `data/user-skills/orphan/SKILL.md` exists but `data/user-skills/orphan/.meta.json` does not
- **WHEN** discovery scans
- **THEN** `orphan` is NOT included in the result list

#### Scenario: Frontmatter name mismatch is ignored

- **GIVEN** `data/user-skills/foo/SKILL.md` has frontmatter `name: bar`
- **WHEN** discovery scans
- **THEN** the skill is NOT included in the result list
- **AND** a debug-level log records the name mismatch

#### Scenario: Meta without editableByAnyone is valid

- **GIVEN** `data/user-skills/legacy/.meta.json` has `{ ownerUserId, createdAt, updatedAt }` and no `editableByAnyone`
- **WHEN** discovery scans
- **THEN** `legacy` is included with `editableByAnyone` resolved to `false`

### Requirement: Slug Validation

The system SHALL validate slugs against the Claude Code skill spec: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, length 1 to 64. Validation SHALL run both at the MCP tool layer (rejecting bad input before staging) and at the handler layer (defense in depth). The description (frontmatter `description` / "trigger") SHALL be 1 to 1024 characters after trimming.

#### Scenario: Valid slug accepted

- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", ... })`
- **THEN** the tool stages the intent

#### Scenario: Uppercase rejected

- **WHEN** Claude calls `propose_skill_create({ name: "CopyImprover", ... })`
- **THEN** the tool returns a validation error identifying the slug as requiring lowercase

#### Scenario: Leading hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "-bad", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to start with a hyphen

#### Scenario: Double hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "double--hyphen", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to contain consecutive hyphens

#### Scenario: Trailing hyphen rejected

- **WHEN** Claude calls `propose_skill_create({ name: "trailing-", ... })`
- **THEN** the tool returns a validation error identifying the slug as not allowed to end with a hyphen

#### Scenario: Over-length slug rejected

- **WHEN** Claude calls `propose_skill_create({ name: "a".repeat(65), ... })`
- **THEN** the tool returns a validation error identifying the 64-char limit

#### Scenario: Empty description rejected

- **WHEN** Claude calls `propose_skill_create({ name: "x", description: "  ", body: "..." })`
- **THEN** the tool returns a validation error identifying the description as required and non-empty after trimming

#### Scenario: Over-length description rejected

- **WHEN** Claude calls `propose_skill_create({ name: "x", description: "a".repeat(1025), body: "..." })`
- **THEN** the tool returns a validation error identifying the 1024-char limit

### Requirement: propose_skill_create Tool

The `propose_skill_create({ name, description, body })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL be available to any user permitted by `canCreateUserSkill(role)` (member or higher). The tool SHALL stage a `skill_create` intent containing `{ slug, description, body, ownerUserId }` and return a ref ID for embedding in `submit_response`. The tool SHALL reject calls when a skill with the same slug already exists (whether enabled or disabled).

#### Scenario: Successful staging

- **GIVEN** the caller is a member and the slug `copy-improver` does not yet exist
- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", description: "...", body: "..." })`
- **THEN** the tool returns text including a ref ID and a summary of the staged skill
- **AND** the intent store contains an entry of type `skill_create` keyed by that ref

#### Scenario: Slug collision rejected

- **GIVEN** `data/user-skills/copy-improver/` already exists (enabled or disabled)
- **WHEN** Claude calls `propose_skill_create({ name: "copy-improver", ... })`
- **THEN** the tool returns an error identifying the slug as already taken
- **AND** the tool guidance suggests updating the existing skill or choosing a different slug

#### Scenario: Tool unavailable when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **WHEN** Claude attempts to call `propose_skill_create`
- **THEN** the tool is not registered for the session and the call fails at the SDK layer (or is rejected by the server with "tool not available")

### Requirement: propose_skill_update Tool

The `propose_skill_update({ name, description?, body?, editable_by_anyone? })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_update` intent. At least one of `description`, `body`, or `editable_by_anyone` MUST be provided. Editing CONTENT (`description`/`body`) SHALL be allowed only when `canEditUserSkillContent(role, ownerUserId, callerUserId, editableByAnyone)` is true. When `editable_by_anyone` is provided, the tool SHALL additionally require `canManageUserSkill(role, ownerUserId, callerUserId)` and reject otherwise. The tool SHALL reject updates to disabled skills, directing the caller to use `propose_skill_restore` first.

#### Scenario: Owner can stage content update

- **GIVEN** `copy-improver` is owned by Slack user U123 and the caller is U123
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool stages a `skill_update` intent and returns a ref ID

#### Scenario: Admin can stage update on someone else's skill

- **GIVEN** `copy-improver` is owned by U123 and the caller is an admin U456
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", description: "..." })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Non-owner member can stage content update on everyone-editable skill

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone: true` and the caller is member U789
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Non-owner member rejected on a default skill

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone` absent and the caller is U789 (member, non-owner)
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool returns an error identifying the caller as lacking edit permission for that skill

#### Scenario: Non-manager rejected when setting editable_by_anyone

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone: true` and the caller is member U789
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", editable_by_anyone: false })`
- **THEN** the tool returns an error identifying that changing the editable-by-everyone setting requires owner or admin

#### Scenario: Owner can set editable_by_anyone

- **GIVEN** `copy-improver` is owned by U123 and the caller is U123
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", editable_by_anyone: true })`
- **THEN** the tool stages a `skill_update` intent carrying `editableByAnyone: true` and returns a ref ID

#### Scenario: Update to unknown slug rejected

- **WHEN** Claude calls `propose_skill_update({ name: "ghost", body: "..." })`
- **THEN** the tool returns an error identifying the skill as not found

#### Scenario: Update to disabled skill rejected

- **GIVEN** `copy-improver` has `disabledAt` set in its `.meta.json`
- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver", body: "..." })`
- **THEN** the tool returns an error directing the caller to restore the skill first

#### Scenario: Missing all fields rejected

- **WHEN** Claude calls `propose_skill_update({ name: "copy-improver" })`
- **THEN** the tool returns a validation error identifying at least one of `description`, `body`, or `editable_by_anyone` as required

### Requirement: propose_skill_disable Tool

The `propose_skill_disable({ name })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_disable` intent. Permission gate is `canManageUserSkill(role, ownerUserId, callerUserId)` — owner OR admin+ — and SHALL NOT be widened by `editableByAnyone`. Already-disabled skills SHALL be rejected.

#### Scenario: Owner can stage disable

- **GIVEN** `copy-improver` is owned by U123, enabled, and the caller is U123
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Disable on already-disabled skill rejected

- **GIVEN** `copy-improver` has `disabledAt` already set
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as already disabled

#### Scenario: Non-owner non-admin rejected even when editableByAnyone

- **GIVEN** `copy-improver` has `editableByAnyone: true` and caller U789 is not the owner and not admin+
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the caller as lacking permission

### Requirement: propose_skill_restore Tool

The `propose_skill_restore({ name })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL stage a `skill_restore` intent that clears `disabledAt`. Permission gate is `canManageUserSkill(role, ownerUserId, callerUserId)` — owner OR admin+ — and SHALL NOT be widened by `editableByAnyone`. Restore SHALL reject skills that are not currently disabled.

#### Scenario: Owner can stage restore on their disabled skill

- **GIVEN** `copy-improver` is owned by U123 and `disabledAt` is set
- **WHEN** the caller U123 calls `propose_skill_restore({ name: "copy-improver" })`
- **THEN** the tool stages the intent and returns a ref ID

#### Scenario: Restore on enabled skill rejected

- **GIVEN** `copy-improver` has no `disabledAt`
- **WHEN** Claude calls `propose_skill_restore({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as not disabled

#### Scenario: Non-manager rejected even when editableByAnyone

- **GIVEN** `copy-improver` has `editableByAnyone: true`, `disabledAt` set, and caller U789 is a non-owner member
- **WHEN** Claude calls `propose_skill_restore({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the caller as lacking permission

### Requirement: editableByAnyone Attribute

A user skill SHALL support an optional `editableByAnyone: boolean` attribute, persisted in its `.meta.json` sidecar alongside `ownerUserId`/`disabledAt`. When absent, it SHALL be treated as `false` (no migration of pre-existing skills required). When `true`, the skill's CONTENT (frontmatter description and body) MAY be edited by any user permitted by `canCreateUserSkill` (member or higher), in addition to the owner and admins+. The attribute SHALL NOT widen who may disable, restore, or change the attribute itself. The attribute SHALL be preserved across content updates, disable, and restore unless explicitly changed by a manager.

#### Scenario: Absent attribute reads as false

- **GIVEN** `data/user-skills/copy-improver/.meta.json` exists without an `editableByAnyone` field
- **WHEN** the skill is read from disk
- **THEN** its `editableByAnyone` resolves to `false`

#### Scenario: Attribute round-trips through meta

- **GIVEN** a skill written with `editableByAnyone: true`
- **WHEN** the skill is re-read from disk
- **THEN** its `editableByAnyone` is `true`

#### Scenario: Attribute preserved across content update

- **GIVEN** `copy-improver` has `editableByAnyone: true`
- **WHEN** a content-only update (new body, no `editableByAnyone` provided) is applied
- **THEN** the persisted `.meta.json` still has `editableByAnyone: true`

#### Scenario: Attribute preserved across disable and restore

- **GIVEN** `copy-improver` has `editableByAnyone: true`
- **WHEN** the skill is disabled and later restored
- **THEN** `editableByAnyone` remains `true` in `.meta.json` throughout

### Requirement: Home Tab editable-by-everyone Badge

When `userSkills.enabled === true`, the Home Tab Skills section SHALL render an "editable by everyone" badge on the row of any skill whose `editableByAnyone` is `true`, mirroring the existing disabled-badge pattern. The badge text SHALL be sourced through `t()` with parity-tested en + fr strings.

#### Scenario: Badge shown for everyone-editable skill

- **GIVEN** `copy-improver` has `editableByAnyone: true`
- **WHEN** the Home Tab Skills section renders
- **THEN** the `copy-improver` row displays the editable-by-everyone badge

#### Scenario: No badge for default skill

- **GIVEN** `meeting-notes` has no `editableByAnyone` (or `false`)
- **WHEN** the Home Tab Skills section renders
- **THEN** the `meeting-notes` row displays no editable-by-everyone badge

### Requirement: Permission-Aware Edit Modal

The Home Tab edit modal SHALL be scoped to the viewer's capability. The modal builder SHALL accept whether the viewer can MANAGE the skill (`canManageUserSkill`). When the viewer can manage, the modal SHALL render the editable-by-everyone checkbox (initial state reflecting the current attribute) and the Disable/Restore lifecycle button. When the viewer can edit content but NOT manage (i.e., a member editing an everyone-editable skill they do not own), the modal SHALL render only the description and body inputs — no checkbox and no lifecycle button. The Home Tab edit button itself SHALL be shown whenever the viewer can edit content (`canEditUserSkillContent`).

#### Scenario: Owner sees full modal

- **GIVEN** `copy-improver` is owned by U123 and U123 opens the edit modal
- **WHEN** the modal renders
- **THEN** it includes the description/body inputs, the editable-by-everyone checkbox, and the Disable button

#### Scenario: Non-owner member sees content-only modal on everyone-editable skill

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone: true` and member U789 opens the edit modal
- **WHEN** the modal renders
- **THEN** it includes the description/body inputs
- **AND** it does NOT include the editable-by-everyone checkbox
- **AND** it does NOT include the Disable button

#### Scenario: Edit button hidden when content not editable

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone` absent/false and member U789 views the Home Tab
- **WHEN** the Skills section renders
- **THEN** the `copy-improver` row shows no Edit button for U789

#### Scenario: Edit button shown to member on everyone-editable skill

- **GIVEN** `copy-improver` is owned by U123 with `editableByAnyone: true` and member U789 views the Home Tab
- **WHEN** the Skills section renders
- **THEN** the `copy-improver` row shows an Edit button for U789

### Requirement: Setting editableByAnyone from the Home Tab

The Home Tab edit-submit handler SHALL persist the editable-by-everyone checkbox value only after re-checking `canManageUserSkill` for the submitting user. A submission from a user who cannot manage the skill SHALL NOT change `editableByAnyone` (the checkbox is not rendered for them; the handler also ignores any attempt defense-in-depth) while still allowing the permitted content edit to proceed.

#### Scenario: Owner enables everyone-editing via checkbox

- **GIVEN** owner U123 opens the edit modal for `copy-improver`, checks the editable-by-everyone box, and submits
- **WHEN** the submission is processed
- **THEN** the handler re-checks `canManageUserSkill("...", "U123", "U123")` (passes)
- **AND** persists `editableByAnyone: true` in `.meta.json`

#### Scenario: Owner disables everyone-editing via checkbox

- **GIVEN** owner U123 opens the edit modal for an everyone-editable `copy-improver`, unchecks the box, and submits
- **WHEN** the submission is processed
- **THEN** the handler persists `editableByAnyone: false` (or removes it)

#### Scenario: Member content edit does not alter the flag

- **GIVEN** member U789 edits the body of an everyone-editable `copy-improver` and submits
- **WHEN** the submission is processed
- **THEN** the new body is persisted
- **AND** `editableByAnyone` is left unchanged (the manage re-check fails, so no flag write)

### Requirement: list_user_skills Tool

The `list_user_skills({ owner? })` MCP tool SHALL be registered when `userSkills.enabled === true` and SHALL return all enabled user skills (or all when no filter), each line showing the slug, description, owner Slack user ID, and "(disabled)" badge if applicable. An optional `owner` arg filters by `ownerUserId`. The tool SHALL be available to anyone with tool access (no role gate).

#### Scenario: List all enabled skills

- **GIVEN** three enabled user skills and one disabled
- **WHEN** Claude calls `list_user_skills({})`
- **THEN** the tool returns text listing all four skills, with the disabled one marked

#### Scenario: Filter by owner

- **GIVEN** `copy-improver` owned by U123 and `meeting-notes` owned by U456
- **WHEN** Claude calls `list_user_skills({ owner: "U123" })`
- **THEN** the tool returns only `copy-improver`

#### Scenario: Empty pack

- **GIVEN** no user skills exist
- **WHEN** Claude calls `list_user_skills({})`
- **THEN** the tool returns a clear "no user skills found" message

### Requirement: Slack Action Handler for Skill Intents

The system SHALL register a Slack action handler matching `^clack_skill_action_\d+$` that decodes the action value to `{ sessionId, ref }`, restores the staged intent, re-checks permissions defense-in-depth, and applies the action atomically (writes `SKILL.md` and `.meta.json` together; updates `.meta.json` only for disable/restore). On successful apply, the handler SHALL post a confirmation reply in the originating thread. Defense-in-depth re-checks SHALL use the split predicates: content edits re-check `canEditUserSkillContent` (with the skill's current `editableByAnyone`); a `skill_update` carrying an `editableByAnyone` change additionally re-checks `canManageUserSkill`; disable/restore re-check `canManageUserSkill`.

#### Scenario: Create intent applied

- **GIVEN** a staged `skill_create` intent for slug `copy-improver`
- **WHEN** the requester clicks the confirm button
- **THEN** the handler creates `data/user-skills/copy-improver/SKILL.md` with the frontmatter and body
- **AND** creates `data/user-skills/copy-improver/.meta.json` with `ownerUserId`, `createdAt`, `updatedAt` set to the same timestamp
- **AND** posts a confirmation in the thread

#### Scenario: Update intent applied

- **GIVEN** a staged `skill_update` intent for slug `copy-improver` with new body
- **WHEN** the requester clicks confirm
- **THEN** the handler overwrites `SKILL.md` with the new content
- **AND** sets `.meta.json.updatedAt` to the current timestamp
- **AND** preserves `ownerUserId`, `createdAt`, and `editableByAnyone`

#### Scenario: Update intent carrying flag change re-checks management

- **GIVEN** a staged `skill_update` intent that sets `editableByAnyone: true`, created when the caller could manage the skill
- **AND** the caller's role/ownership has changed so they can no longer manage it
- **WHEN** the button is clicked
- **THEN** the handler re-evaluates `canManageUserSkill` and rejects the flag write
- **AND** posts an ephemeral error explaining the missing permission

#### Scenario: Disable intent applied

- **GIVEN** a staged `skill_disable` intent for `copy-improver`
- **WHEN** the requester clicks confirm
- **THEN** the handler writes `.meta.json` with `disabledAt` set to the current timestamp
- **AND** does NOT touch `SKILL.md`
- **AND** preserves `editableByAnyone`
- **AND** the skill no longer appears in the prompt catalog on subsequent turns

#### Scenario: Restore intent applied

- **GIVEN** a staged `skill_restore` intent for a disabled `copy-improver`
- **WHEN** the requester clicks confirm
- **THEN** the handler writes `.meta.json` with `disabledAt` removed
- **AND** preserves `editableByAnyone`
- **AND** the skill reappears in the prompt catalog on subsequent turns

#### Scenario: Defense-in-depth content permission re-check

- **GIVEN** a staged `skill_update` content edit created when the caller could edit content
- **AND** the caller's role/ownership/flag basis has changed so they no longer can
- **WHEN** the button is clicked
- **THEN** the handler re-evaluates `canEditUserSkillContent(role, ownerId, callerId, editableByAnyone)` and rejects if it fails
- **AND** posts an ephemeral error explaining the missing permission

#### Scenario: Slug collision at apply time

- **GIVEN** a staged `skill_create` intent for slug `x`
- **AND** between staging and confirm, another user created a skill named `x`
- **WHEN** the button is clicked
- **THEN** the handler detects the collision and aborts without overwriting
- **AND** posts an error explaining the collision

### Requirement: Permission Predicates

The system SHALL expose the following permission helpers in `src/permissions.ts`:
- `canCreateUserSkill(role: UserRole): boolean` returns `true` for `member`, `dev`, `admin`, and `owner`.
- `canEditUserSkillContent(role: UserRole, ownerUserId: string, callerUserId: string, editableByAnyone: boolean): boolean` gates editing a skill's description/body. It returns `true` when `role` is `admin` or `owner`, OR when `ownerUserId === callerUserId`, OR when `editableByAnyone === true` and `canCreateUserSkill(role)` is true (member or higher).
- `canManageUserSkill(role: UserRole, ownerUserId: string, callerUserId: string): boolean` gates disabling, restoring, and changing the `editableByAnyone` attribute. It returns `true` when `role` is `admin` or `owner`, OR when `ownerUserId === callerUserId`. It is NOT affected by `editableByAnyone`.

All helpers SHALL be pure (no I/O) so they can be used uniformly at the tool gate, handler defense-in-depth, and Home Tab visibility checks.

#### Scenario: Member can create

- **WHEN** `canCreateUserSkill("member")` is called
- **THEN** it returns `true`

#### Scenario: Owner can edit content of their own

- **WHEN** `canEditUserSkillContent("member", "U123", "U123", false)` is called
- **THEN** it returns `true`

#### Scenario: Non-owner member cannot edit content of a default skill

- **WHEN** `canEditUserSkillContent("member", "U123", "U999", false)` is called
- **THEN** it returns `false`

#### Scenario: Non-owner member can edit content of an everyone-editable skill

- **WHEN** `canEditUserSkillContent("member", "U123", "U999", true)` is called
- **THEN** it returns `true`

#### Scenario: Admin can edit any content

- **WHEN** `canEditUserSkillContent("admin", "U123", "U999", false)` is called
- **THEN** it returns `true`

#### Scenario: Owner can manage their own

- **WHEN** `canManageUserSkill("member", "U123", "U123")` is called
- **THEN** it returns `true`

#### Scenario: Non-owner member cannot manage even when editableByAnyone

- **GIVEN** the skill has `editableByAnyone: true`
- **WHEN** `canManageUserSkill("member", "U123", "U999")` is called
- **THEN** it returns `false`

#### Scenario: Admin can manage anything

- **WHEN** `canManageUserSkill("admin", "U123", "U999")` is called
- **THEN** it returns `true`

### Requirement: mtime-Keyed Body Cache

The system SHALL maintain a process-level cache for user-skill bodies keyed by `slug → { mtime, body }`. On every `load_skill` call against the `user-skills` pack, the implementation SHALL `statSync` the on-disk `SKILL.md`, compare `mtimeMs` against the cached entry, and re-read from disk on mismatch. Disabled skills SHALL be excluded from cache lookups (returned as "not found"). The cache SHALL be cleared on full lifecycle reloads.

#### Scenario: Fresh load reads from disk

- **GIVEN** no cache entry for slug `copy-improver`
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called
- **THEN** the SKILL.md is read from disk
- **AND** the cache stores `(slug, mtime, body)`

#### Scenario: Repeat load with unchanged mtime returns cached body

- **GIVEN** the cache holds `(copy-improver, mtime=T1, body)`
- **AND** the file on disk still has mtime `T1`
- **WHEN** `load_skill` is called again
- **THEN** the cached body is returned without re-reading
- **AND** the cache is unchanged

#### Scenario: mtime mismatch triggers re-read

- **GIVEN** the cache holds `(copy-improver, mtime=T1, oldBody)`
- **AND** the file on disk has been written and now has mtime `T2`
- **WHEN** `load_skill` is called
- **THEN** the file is re-read
- **AND** the cache is updated to `(copy-improver, mtime=T2, newBody)`

#### Scenario: Disabled skill not loadable

- **GIVEN** `copy-improver` has `disabledAt` set
- **WHEN** `load_skill({ pack: "user-skills", skill: "copy-improver" })` is called
- **THEN** the tool returns an error identifying the skill as not found
- **AND** the cache is not populated

#### Scenario: Cache cleared on lifecycle reload

- **GIVEN** the cache holds entries for two enabled skills
- **WHEN** a lifecycle reload triggered by `config.json` change occurs
- **THEN** the cache is cleared
- **AND** the next `load_skill` call re-reads from disk

### Requirement: configWatcher Observability for User Skills

The system SHALL extend `startConfigWatcher` (in `src/configWatcher.ts`) to recursively watch `data/user-skills/` when `userSkills.enabled === true`. Change events SHALL clear the body cache for the affected slug (best-effort — if the path can't be resolved to a slug, the entire user-skills body cache is cleared) and log an INFO line. The watcher is best-effort; correctness of body freshness comes from the mtime check in `load_skill`.

#### Scenario: SKILL.md change clears cache entry

- **GIVEN** the watcher is running and the body cache holds an entry for `copy-improver`
- **WHEN** `data/user-skills/copy-improver/SKILL.md` is written to disk
- **THEN** the watcher fires and clears the cache entry for `copy-improver`
- **AND** logs an INFO line identifying the change

#### Scenario: New skill directory picked up by next discovery

- **GIVEN** the watcher is running
- **WHEN** `data/user-skills/new-skill/SKILL.md` is created
- **THEN** the watcher fires for the parent directory
- **AND** the next prompt-build discovery scan finds `new-skill`

### Requirement: Tool Name Validator Registration

The four new MCP tool names (`propose_skill_create`, `propose_skill_update`, `propose_skill_disable`, `propose_skill_restore`, `list_user_skills`) SHALL be added to `CLACK_CORE_TOOL_NAMES` in `src/tools/toolNameValidator.ts` so the validator does not reject them when assembling the tool list.

#### Scenario: Validator accepts new tool names

- **WHEN** the tool name validator is asked to validate the assembled tool list including the user-skills tools
- **THEN** all five names pass validation

### Requirement: User-skill metadata load is schema-driven

`readMeta` SHALL validate a user skill's `.meta.json` against a `UserSkillMeta` zod schema rather than the hand-rolled `isValidMetaShape` guard, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL return `null`, never throw. The slug and description write-time rules (`validateSlug`, `validateDescription`) MAY be expressed as reusable `z.string()` constraints shared with the meta schema, keeping their current accept/reject behavior and `ValidationResult` envelope.

#### Scenario: Corrupt meta degrades to null

- **WHEN** a skill's `.meta.json` is absent, not valid JSON, or fails schema validation
- **THEN** `readMeta` returns `null` exactly as today

#### Scenario: Slug/description validation is unchanged

- **WHEN** a slug or description is validated at write time
- **THEN** the same inputs are accepted/rejected as before, and the `ValidationResult { ok; error? }` envelope is preserved

