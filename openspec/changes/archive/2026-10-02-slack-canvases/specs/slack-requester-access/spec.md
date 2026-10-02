## ADDED Requirements

### Requirement: File verdict reports the creator

An allowed file-access verdict SHALL report the file's creator (the `user` from `files.info`), or none when Slack does not give one, alongside the bot's own access level.

#### Scenario: Creator reported

- **WHEN** the file check allows a canvas created by user `U1`
- **THEN** the verdict reports `U1` as the creator

#### Scenario: Creator unknown

- **WHEN** `files.info` returns no `user` for an allowed file
- **THEN** the verdict reports no creator
