# user-created-skills — Delta

## RENAMED Requirements

- FROM: `### Requirement: Home Tab editable-by-everyone Badge`
- TO: `### Requirement: Home Tab Shared Badge`

## MODIFIED Requirements

### Requirement: Home Tab Shared Badge

When `userSkills.enabled === true`, the Home Tab Skills section SHALL render a **"(shared)"** badge on the row of any skill whose `editableByAnyone` is `true`, mirroring the existing disabled-badge pattern. The user-facing term for the capability is "Shared" — "editable by everyone" no longer appears as a label (the edit modal's checkbox keeps an explanatory sentence under a "Shared" label). The badge text SHALL be sourced through `t()` with parity-tested en + fr strings.

#### Scenario: Badge shown for shared skill

- **GIVEN** a skill `copy-improver` with `editableByAnyone: true`
- **WHEN** the Home Tab Skills section renders
- **THEN** the `copy-improver` row displays the "(shared)" badge

#### Scenario: No badge for default skill

- **GIVEN** a skill `meeting-notes` without `editableByAnyone`
- **WHEN** the Home Tab Skills section renders
- **THEN** the `meeting-notes` row displays no badge

## ADDED Requirements

### Requirement: Grouped Home Tab Skills Sections

The Home Tab Skills section SHALL partition skills into up to three viewer-relative subsections rendered in order and omitted when empty: **Shared** (`editableByAnyone` skills, labeled "Shared"), **Yours** (viewer-owned non-shared skills), and other users' non-shared skills (labeled "Non-Accessible" for non-admins, "Other users'" for admins). Rows keep their existing content and permission-gated Edit affordances — non-admins get no Edit button in the third subsection. All headers are `t()`-sourced with en + fr parity.

#### Scenario: Non-admin sees three groups

- **WHEN** a non-admin opens the Skills section and there exist a shared skill, one of their own, and another user's non-shared skill
- **THEN** the section shows "Shared", "Yours", and "Non-Accessible" headers in that order
- **AND** only the first two groups' rows carry an Edit button for this viewer

#### Scenario: Empty groups are omitted

- **WHEN** the viewer owns no skills
- **THEN** the "Yours" header does not render

#### Scenario: Admin third group keeps controls

- **WHEN** an admin views another user's non-shared skill
- **THEN** it renders under the "Other users'" header with the Edit affordance
