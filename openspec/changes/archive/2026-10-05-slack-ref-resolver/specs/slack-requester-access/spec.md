## MODIFIED Requirements

### Requirement: File access rule

The system SHALL allow access to a Slack file (including canvases and lists) only when at least one of the following holds: the requester created the file; the file's per-user access list names the requester; the requester passes the conversation access rule for a conversation the file is shared to. The system SHALL deny in every other case, including when the file's info cannot be fetched. The check SHALL fetch the file's info itself from the file's id. The file's editor list, its workspace-wide access level and its private-channel count SHALL NOT grant access. An allowed verdict SHALL carry the bot's own access level on the file, and the file's facts read from the same fetch. A denied verdict SHALL carry no facts.

#### Scenario: Creator

- **WHEN** the requester is the file's creator
- **THEN** the check allows access without a membership lookup

#### Scenario: Listed in per-user access

- **WHEN** the file's per-user access list names the requester
- **THEN** the check allows access

#### Scenario: Shared to a channel the requester is in

- **WHEN** the file is shared to a private channel and the requester is a member of it
- **THEN** the check allows access

#### Scenario: Shared only to channels the requester is not in

- **WHEN** the requester is not the creator, is not in the per-user access list, and is a member of none of the file's private channels
- **THEN** the check denies access

#### Scenario: Editor only

- **WHEN** the requester appears only in the file's editor list
- **THEN** the check denies access

#### Scenario: Shared to a group DM the requester is in

- **WHEN** the file is shared to a group DM and the requester is a member of it
- **THEN** the check allows access

#### Scenario: File lookup fails

- **WHEN** the file's info cannot be fetched, or Slack reports the file as not visible to the bot
- **THEN** the check denies access

#### Scenario: Bot read access reported

- **WHEN** the check allows access to a file the bot can only read
- **THEN** the verdict reports the bot's access level as `read`

#### Scenario: Bot write access reported

- **WHEN** the check allows access to a file the bot can write
- **THEN** the verdict reports the bot's access level as `write`

#### Scenario: Facts on an allowance

- **WHEN** the check allows access to a file
- **THEN** the verdict carries the file's `filetype`, `pretty_type`, `name`, `title`, `mimetype`, `size` and `url_private`, each when present
- **AND** a malformed field is reported as absent rather than failing the check

#### Scenario: No facts on a denial

- **WHEN** the check denies access to a file
- **THEN** the verdict carries only the reason

#### Scenario: No requester

- **WHEN** a run with no requester asks for a file shared only to private channels the bot is not a member of
- **THEN** the check denies access
