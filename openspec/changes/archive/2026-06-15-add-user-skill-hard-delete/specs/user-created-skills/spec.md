## ADDED Requirements

### Requirement: deleteUserSkill Storage Operation

The system SHALL expose a `deleteUserSkill(slug)` operation in `src/userSkills.ts` that permanently removes the entire `data/user-skills/<slug>/` directory and all of its contents (`SKILL.md`, `.meta.json`, and any leftover `.tmp` files). The operation SHALL validate the slug shape first and throw when the skill does not exist. It SHALL succeed on both enabled and disabled skills (a present `disabledAt` does not block deletion). Removal SHALL use a recursive-remove dependency on `UserSkillsDeps` so it stays injectable/mockable in tests. After deletion the skill SHALL no longer be returned by `discoverUserSkills`, `readUserSkill`, or `userSkillExists`.

#### Scenario: Delete removes the directory

- **GIVEN** `data/user-skills/copy-improver/` exists with `SKILL.md` and `.meta.json`
- **WHEN** `deleteUserSkill("copy-improver")` is called
- **THEN** the entire `data/user-skills/copy-improver/` directory is removed
- **AND** `userSkillExists("copy-improver")` returns `false`
- **AND** `discoverUserSkills()` no longer includes `copy-improver`

#### Scenario: Delete works on a disabled skill

- **GIVEN** `copy-improver` has `disabledAt` set in its `.meta.json`
- **WHEN** `deleteUserSkill("copy-improver")` is called
- **THEN** the directory is removed without error

#### Scenario: Delete of a non-existent skill throws

- **WHEN** `deleteUserSkill("ghost")` is called and no such directory exists
- **THEN** the operation throws an error identifying the skill as not found

#### Scenario: Invalid slug rejected before any filesystem touch

- **WHEN** `deleteUserSkill("../escape")` is called
- **THEN** the operation throws (or returns a not-found error) without removing anything outside `data/user-skills/`

## MODIFIED Requirements

### Requirement: propose_skill_disable Tool

The `propose_skill_disable({ name, delete? })` MCP tool SHALL be registered when `userSkills.enabled === true`.

When `delete` is absent or `false`, the tool SHALL stage a `skill_disable` intent. Permission gate is `canManageUserSkill(role, ownerUserId, callerUserId)` — owner OR admin+ — and SHALL NOT be widened by `editableByAnyone`. Already-disabled skills SHALL be rejected.

When `delete` is `true`, the tool SHALL stage a `skill_delete` intent containing `{ slug }` for permanent, irreversible removal of the skill directory. The permission gate in this mode SHALL be `canDeleteUserSkill(role)` — **admin or owner only** — and SHALL NOT be widened by `editableByAnyone` or by skill ownership (a non-admin owner CANNOT delete). The tool SHALL reject calls for a skill that does not exist, but SHALL NOT reject an already-disabled skill (a disabled skill may be deleted directly). The tool guidance SHALL document the flag and emphasize that `delete: true` is permanent and irreversible whereas the default soft-disable is reversible via `propose_skill_restore`.

#### Scenario: Owner can stage disable

- **GIVEN** `copy-improver` is owned by U123, enabled, and the caller is U123
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool stages the `skill_disable` intent and returns a ref ID

#### Scenario: Disable on already-disabled skill rejected

- **GIVEN** `copy-improver` has `disabledAt` already set
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the skill as already disabled

#### Scenario: Non-owner non-admin rejected even when editableByAnyone

- **GIVEN** `copy-improver` has `editableByAnyone: true` and caller U789 is not the owner and not admin+
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver" })`
- **THEN** the tool returns an error identifying the caller as lacking permission

#### Scenario: Admin can stage delete via the flag

- **GIVEN** `copy-improver` exists and the caller has role `admin`
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver", delete: true })`
- **THEN** the tool stages a `skill_delete` intent and returns a ref ID

#### Scenario: Non-admin owner rejected on delete

- **GIVEN** `copy-improver` is owned by U123 (a `member`) and the caller is U123
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver", delete: true })`
- **THEN** the tool returns an error identifying that deletion requires admin or owner

#### Scenario: Delete of an already-disabled skill allowed

- **GIVEN** `copy-improver` has `disabledAt` set and the caller has role `admin`
- **WHEN** Claude calls `propose_skill_disable({ name: "copy-improver", delete: true })`
- **THEN** the tool stages a `skill_delete` intent (it does NOT reject as already-disabled)

#### Scenario: Delete of unknown skill rejected

- **WHEN** Claude calls `propose_skill_disable({ name: "ghost", delete: true })` and no such skill exists
- **THEN** the tool returns an error identifying the skill as not found

### Requirement: Slack Action Handler for Skill Intents

The system SHALL register a Slack action handler matching `^clack_skill_action_\d+$` that decodes the action value to `{ sessionId, ref }`, restores the staged intent, re-checks permissions defense-in-depth, and applies the action atomically (writes `SKILL.md` and `.meta.json` together; updates `.meta.json` only for disable/restore; recursively removes the skill directory for delete). On successful apply, the handler SHALL post a confirmation reply in the originating thread. Defense-in-depth re-checks SHALL use the split predicates: content edits re-check `canEditUserSkillContent` (with the skill's current `editableByAnyone`); a `skill_update` carrying an `editableByAnyone` change additionally re-checks `canManageUserSkill`; disable/restore re-check `canManageUserSkill`; delete re-checks `canDeleteUserSkill` (admin or owner only).

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

#### Scenario: Delete intent applied

- **GIVEN** a staged `skill_delete` intent for `copy-improver` and the clicking user is admin+
- **WHEN** the requester clicks confirm
- **THEN** the handler calls `deleteUserSkill` and the `data/user-skills/copy-improver/` directory is removed
- **AND** posts a confirmation in the thread
- **AND** the skill no longer appears in the prompt catalog or Home Tab on subsequent turns

#### Scenario: Delete intent defense-in-depth re-check

- **GIVEN** a staged `skill_delete` intent created when the clicker was admin
- **AND** the clicker's role has since dropped below admin
- **WHEN** the button is clicked
- **THEN** the handler re-evaluates `canDeleteUserSkill` and aborts without removing anything
- **AND** posts an ephemeral error explaining the missing permission

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
- `canDeleteUserSkill(role: UserRole): boolean` gates permanently deleting a skill. It returns `true` only when `role` is `admin` or `owner`. It is NOT affected by skill ownership or `editableByAnyone` — a non-admin skill owner CANNOT delete.

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

#### Scenario: Member cannot delete even their own skill

- **WHEN** `canDeleteUserSkill("member")` is called
- **THEN** it returns `false`

#### Scenario: Admin can delete

- **WHEN** `canDeleteUserSkill("admin")` is called
- **THEN** it returns `true`

#### Scenario: Owner can delete

- **WHEN** `canDeleteUserSkill("owner")` is called
- **THEN** it returns `true`
