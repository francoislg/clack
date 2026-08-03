# home-tab Delta

## ADDED Requirements

### Requirement: Investigations section

The Home Tab SHALL render an admin-gated "Investigations" section only when `config.investigations.enabled` is true. The section SHALL contain: a `conversations_select` channel picker (public + private, bot users excluded) that writes the selected channel to `data/state/investigations.json` with immediate effect (no restart); a list of open investigations showing the main-thread permalink, followed-thread count, and starter, each with a Close button; and a warning line when no channel is configured. All strings SHALL go through `t()`.

#### Scenario: Section visibility

- **WHEN** an admin opens the Home Tab with the feature enabled
- **THEN** the Investigations section renders
- **WHEN** the feature is disabled, or the viewer is below admin
- **THEN** the section is absent

#### Scenario: Channel selection is live

- **WHEN** an admin picks a channel in the section
- **THEN** the state file's `channel` is updated
- **AND** the next investigate reaction uses the new channel without a restart

#### Scenario: Closing from the Home Tab

- **WHEN** an admin clicks Close on an open investigation
- **THEN** the investigation is removed from the open index (same path as `close_investigation`)
- **AND** the section re-renders without it

#### Scenario: Unconfigured warning

- **WHEN** the feature is enabled and `channel` is null
- **THEN** the section shows a warning that investigate reactions will escalate to the owner until a channel is picked
