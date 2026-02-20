## ADDED Requirements

### Requirement: On-Demand History Deepening

The system SHALL support expanding shallow clone history on demand during query mode.

#### Scenario: Deepen shallow clone via fetch

- **WHEN** the `deepen_history` tool is invoked for a shallow-cloned repository
- **THEN** the system refreshes the remote URL with a fresh GitHub App installation token
- **AND** executes `git fetch --deepen=N` to download additional history
- **AND** the local clone gains access to more commits without a full re-clone

#### Scenario: Full unshallow via fetch

- **WHEN** the `deepen_history` tool is invoked with `full: true`
- **THEN** the system executes `git fetch --unshallow` to download the complete history
- **AND** the repository is no longer a shallow clone

#### Scenario: Deepening does not affect sync scheduler

- **WHEN** a repository is deepened via `deepen_history`
- **THEN** the periodic sync scheduler continues to operate normally
- **AND** subsequent `git pull` operations preserve the deepened history
