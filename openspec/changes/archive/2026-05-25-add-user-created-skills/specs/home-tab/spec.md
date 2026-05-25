## ADDED Requirements

### Requirement: Skills Section in Home Tab

When `userSkills.enabled === true`, the Home Tab SHALL render a "Skills" section between the existing Configurations section and the Schedules section. The section SHALL display:
- A header "Skills" with a short description ("Org-authored skills available to Claude in every session")
- A "+ Create skill" button visible to every user permitted by `canCreateUserSkill(role)` (member+)
- One row per user skill (enabled and disabled), alphabetized by slug, showing:
  - the slug as the row title
  - the frontmatter `description` as the row body (truncated to a sensible Slack-display length)
  - an "Owner: @userId" badge (rendered as a Slack mention)
  - a "(disabled)" badge for disabled skills
  - an "Edit" button visible to viewers permitted by `canEditUserSkill(role, ownerUserId, callerUserId)`
  - a "Disable" button on enabled rows (same permission gate as Edit)
  - a "Restore" button on disabled rows (same permission gate)

When `userSkills.enabled === false`, the Skills section SHALL NOT render.

#### Scenario: Section hidden when feature disabled

- **GIVEN** `userSkills.enabled === false`
- **WHEN** any user opens the Home Tab
- **THEN** the rendered view contains no "Skills" header or block

#### Scenario: Section visible when feature enabled, even with no skills

- **GIVEN** `userSkills.enabled === true` and no user skills exist
- **WHEN** a member opens the Home Tab
- **THEN** the rendered view contains the "Skills" header
- **AND** the "+ Create skill" button is visible
- **AND** no skill rows are rendered (an empty-state message such as "No user skills yet" is shown instead)

#### Scenario: Member sees create button

- **GIVEN** `userSkills.enabled === true` and the viewer has role `member`
- **WHEN** the Home Tab is rendered
- **THEN** the "+ Create skill" button is present

#### Scenario: Owner sees Edit and Disable on their own skill

- **GIVEN** `copy-improver` is owned by U123 and is enabled
- **WHEN** U123 opens the Home Tab
- **THEN** the `copy-improver` row shows both "Edit" and "Disable" buttons

#### Scenario: Non-owner non-admin does not see Edit/Disable on someone else's skill

- **GIVEN** `copy-improver` is owned by U123 and the viewer is U999 (member, non-owner)
- **WHEN** U999 opens the Home Tab
- **THEN** the `copy-improver` row shows neither "Edit" nor "Disable" buttons

#### Scenario: Admin sees Edit and Disable on every skill

- **GIVEN** the viewer has role `admin`
- **WHEN** the Home Tab is rendered with three skills owned by different users
- **THEN** every row shows "Edit" and "Disable" (or "Restore" if disabled) buttons

#### Scenario: Disabled skill shows Restore instead of Disable

- **GIVEN** `meeting-notes` has `disabledAt` set
- **WHEN** the Home Tab is rendered for a user with edit permission on it
- **THEN** the row shows a "(disabled)" badge
- **AND** the row shows a "Restore" button (not "Disable")

#### Scenario: Skills section is alphabetized

- **GIVEN** three enabled skills `zebra`, `apple`, `mango`
- **WHEN** the Home Tab renders the Skills section
- **THEN** rows appear in order: `apple`, `mango`, `zebra`

### Requirement: Create Skill Modal

The "+ Create skill" button SHALL open a Slack modal with three inputs:
- A "Name" plain-text input (placeholder describing the slug rules, max 64 chars)
- A "When to use" plain-text input (multiline, max 1024 chars) — maps to the frontmatter `description`
- A "Body" plain-text input (multiline) — maps to the SKILL.md body

Submission SHALL validate the name client-side (slug regex) and re-validate server-side. On success, the modal SHALL close and a confirmation message SHALL be posted as an ephemeral notification to the requester. The created skill SHALL appear in the next Home Tab render.

#### Scenario: Successful create from Home Tab

- **GIVEN** a member clicks "+ Create skill"
- **AND** fills in `name: copy-improver`, valid description, and body
- **AND** submits
- **THEN** the modal closes
- **AND** `data/user-skills/copy-improver/SKILL.md` and `.meta.json` are written with `ownerUserId` set to the submitter
- **AND** an ephemeral confirmation is shown to the submitter

#### Scenario: Invalid slug surfaces inline error

- **WHEN** the user enters `name: Bad-Name` and submits
- **THEN** the modal stays open with an inline error on the Name field identifying the slug rules

#### Scenario: Slug collision surfaces inline error

- **GIVEN** `copy-improver` already exists
- **WHEN** the user submits a create modal with `name: copy-improver`
- **THEN** the modal stays open with an inline error identifying the collision

### Requirement: Edit Skill Modal

The "Edit" button SHALL open a Slack modal pre-populated with the current skill's name (read-only, disabled), description, and body. The submitter SHALL be able to change description and body but NOT name. On submit, the SKILL.md and `.meta.json` are updated atomically and `updatedAt` is refreshed. The button SHALL be available only when `canEditUserSkill(role, ownerUserId, callerUserId)` is `true`.

#### Scenario: Owner edits description and body

- **GIVEN** U123 owns `copy-improver` and opens the Edit modal
- **WHEN** they change the description and body, then submit
- **THEN** the SKILL.md is overwritten with the new content
- **AND** `.meta.json.updatedAt` is updated
- **AND** `ownerUserId` and `createdAt` are preserved
- **AND** the next Home Tab render shows the updated description

#### Scenario: Name field is read-only

- **WHEN** the Edit modal is rendered
- **THEN** the Name field is displayed but cannot be modified

#### Scenario: Submission re-checks permission

- **GIVEN** an edit modal was opened by U123 (the owner)
- **AND** between open and submit, ownership was reassigned (or the caller lost admin role)
- **WHEN** the modal is submitted
- **THEN** the handler re-evaluates `canEditUserSkill` and rejects with an inline error if it fails

### Requirement: Disable and Restore Buttons

The "Disable" button SHALL set `disabledAt` to the current timestamp in `.meta.json` after a confirmation step (either a small inline confirm card or a modal — implementation choice consistent with existing destructive Home Tab actions). The "Restore" button SHALL clear `disabledAt` without confirmation (it is non-destructive). Both SHALL be permission-gated identically to Edit.

#### Scenario: Disable confirms then applies

- **WHEN** a permitted user clicks "Disable" on `copy-improver`
- **THEN** a confirmation prompt is shown
- **WHEN** the user confirms
- **THEN** `.meta.json.disabledAt` is set
- **AND** the next Home Tab render shows the skill with a "(disabled)" badge and a "Restore" button

#### Scenario: Restore applies immediately

- **WHEN** a permitted user clicks "Restore" on a disabled skill
- **THEN** `.meta.json.disabledAt` is removed
- **AND** the next Home Tab render shows the skill in its enabled form
