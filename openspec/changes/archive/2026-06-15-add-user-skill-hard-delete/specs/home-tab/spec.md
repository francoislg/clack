## MODIFIED Requirements

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

The Edit modal SHALL host the lifecycle controls, gated by role:
- a "Disable" button (on enabled skills) and a "Restore" button (on disabled skills), visible when `canManageUserSkill(role, ownerUserId, callerUserId)` (owner or admin+).
- a "Delete" button visible ONLY when `canDeleteUserSkill(role)` (admin or owner), shown for both enabled and disabled skills. The button SHALL carry a native Slack confirmation dialog warning that deletion is permanent and irreversible. On confirm, the skill directory is removed permanently and the Home view is refreshed.

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

#### Scenario: Owner sees Edit on their own skill row, Disable in the modal

- **GIVEN** `copy-improver` is owned by U123 and is enabled
- **WHEN** U123 opens the Home Tab and opens the `copy-improver` Edit modal
- **THEN** the row shows an "Edit" button
- **AND** the Edit modal shows a "Disable" button

#### Scenario: Non-admin owner does not see a Delete button in the modal

- **GIVEN** `copy-improver` is owned by U123 (role `member`) and the viewer is U123
- **WHEN** U123 opens the `copy-improver` Edit modal
- **THEN** the modal shows "Disable" but NOT "Delete"

#### Scenario: Admin sees a Delete button with confirmation in the modal

- **GIVEN** the viewer has role `admin`
- **WHEN** the admin opens the Edit modal for any skill
- **THEN** the modal shows a "Delete" button
- **AND** clicking it presents a native confirmation dialog before the delete is applied

#### Scenario: Non-owner non-admin does not see the Edit button on someone else's skill

- **GIVEN** `copy-improver` is owned by U123 and the viewer is U999 (member, non-owner)
- **WHEN** U999 opens the Home Tab
- **THEN** the `copy-improver` row shows no "Edit" button

#### Scenario: Disabled skill shows Restore instead of Disable in the modal

- **GIVEN** `meeting-notes` has `disabledAt` set
- **WHEN** a user with manage permission opens its Edit modal
- **THEN** the row shows a "(disabled)" badge
- **AND** the modal shows a "Restore" button (not "Disable")

#### Scenario: Delete confirmed removes the skill and refreshes the view

- **GIVEN** an admin opens the `copy-improver` Edit modal, clicks "Delete", and confirms the dialog
- **WHEN** the action is handled
- **THEN** `data/user-skills/copy-improver/` is permanently removed
- **AND** the refreshed Home view no longer shows a `copy-improver` row

#### Scenario: Skills section is alphabetized

- **GIVEN** three enabled skills `zebra`, `apple`, `mango`
- **WHEN** the Home Tab renders the Skills section
- **THEN** rows appear in order: `apple`, `mango`, `zebra`
