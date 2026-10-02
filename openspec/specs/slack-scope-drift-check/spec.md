# slack-scope-drift-check Specification

## Purpose
TBD - created by archiving change slack-requester-access. Update Purpose after archive.
## Requirements
### Requirement: Required scopes compared against the installed token

At boot, after the Slack app has started, and on every soft restart, the system SHALL compare the bot scopes the live config requires with the scopes the installed bot token carries, as reported by `auth.test`. The required scopes SHALL come from the same definition the manifest generator uses. Scopes the token carries beyond the required set SHALL be ignored.

#### Scenario: Token carries every required scope

- **WHEN** the token's scopes include every scope the config requires
- **THEN** no warning is logged and no DM is sent

#### Scenario: Feature enabled without reinstall

- **WHEN** the config enables a feature whose scope the token lacks
- **THEN** the missing scope is reported

#### Scenario: Extra scopes on the token

- **WHEN** the token carries a scope the config does not require
- **THEN** that scope is not reported

#### Scenario: Check runs on soft restart

- **WHEN** a soft restart completes after a config change that enables a scope-gated feature
- **THEN** the comparison runs against the new config

### Requirement: Owner is told about missing scopes

When scopes are missing, the system SHALL log each one and SHALL send the owner one DM listing all of them and stating that the manifest must be re-uploaded and the app reinstalled. The DM text SHALL be localized.

#### Scenario: One DM for several scopes

- **WHEN** two required scopes are missing
- **THEN** the owner receives one DM naming both

#### Scenario: No owner configured

- **WHEN** scopes are missing and no owner is set
- **THEN** the missing scopes are logged and no DM is attempted

### Requirement: The check never blocks boot

The scope check SHALL never throw and SHALL never prevent the bot from starting. When the token's scopes cannot be read, the system SHALL log that the check was skipped.

#### Scenario: auth.test fails

- **WHEN** `auth.test` throws
- **THEN** boot continues and a warning is logged

#### Scenario: Scope list absent from the response

- **WHEN** the `auth.test` response carries no scope list
- **THEN** the check logs that it was skipped and reports nothing

#### Scenario: Owner DM fails

- **WHEN** sending the owner DM throws
- **THEN** boot continues and a warning is logged

