## ADDED Requirements

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

## MODIFIED Requirements

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
