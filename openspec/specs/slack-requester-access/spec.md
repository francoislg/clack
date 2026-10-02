# slack-requester-access Specification

## Purpose
TBD - created by archiving change slack-requester-access. Update Purpose after archive.
## Requirements
### Requirement: Requester identity

The access check SHALL treat the query context's `userId` as the requester. When the context's role is `system`, the check SHALL treat the run as having no requester. No Clack role, including `owner`, SHALL bypass the check.

#### Scenario: Interactive run

- **WHEN** a user triggers a run by DM, @mention or reaction
- **THEN** the check evaluates access for that user

#### Scenario: User cron job

- **WHEN** a scheduled message created by a user fires
- **THEN** the check evaluates access for the job's creator

#### Scenario: Investigation round

- **WHEN** a split investigation round runs
- **THEN** the check evaluates access for the investigation's requester

#### Scenario: Plugin cron job

- **WHEN** a run executes with role `system`
- **THEN** the check evaluates it as having no requester

#### Scenario: Owner is checked like anyone else

- **WHEN** the owner requests a private channel they are not a member of
- **THEN** the check denies access

### Requirement: Conversation access rule

The system SHALL allow access to a Slack conversation only as follows, and SHALL deny in every other case, including when the conversation's kind or the requester's membership cannot be determined:

- A public channel is allowed for a full-member requester and for a run with no requester.
- A public channel is allowed for a guest or external requester only when they are a member of it.
- A private channel or group DM is allowed only when the requester is a member of it.
- A DM is allowed only when the requester is the DM's user.

#### Scenario: Full member reads a public channel

- **WHEN** a full-member requester asks for a public channel they have not joined
- **THEN** the check allows access without a membership lookup

#### Scenario: Member of a private channel

- **WHEN** the requester is a member of the private channel
- **THEN** the check allows access

#### Scenario: Non-member of a private channel

- **WHEN** the requester is not a member of the private channel
- **THEN** the check denies access

#### Scenario: Group DM non-member

- **WHEN** the requester is not a member of the group DM
- **THEN** the check denies access

#### Scenario: Someone else's DM

- **WHEN** the requester is not the user of the DM
- **THEN** the check denies access

#### Scenario: No requester and a public channel

- **WHEN** a run with no requester asks for a public channel
- **THEN** the check allows access

#### Scenario: No requester and a private channel

- **WHEN** a run with no requester asks for a private channel
- **THEN** the check denies access

#### Scenario: Channel info unavailable

- **WHEN** the conversation's info cannot be fetched
- **THEN** the check denies access

#### Scenario: Membership lookup fails

- **WHEN** the membership lookup for a private channel throws
- **THEN** the check denies access

### Requirement: Guest and external requesters

The system SHALL classify a requester as guest or external when Slack reports them as restricted, ultra-restricted or a stranger, or as belonging to a team other than the bot's. A requester whose user info cannot be fetched SHALL be classified as guest.

#### Scenario: Guest in a public channel they joined

- **WHEN** a guest requester is a member of the public channel
- **THEN** the check allows access

#### Scenario: Guest in a public channel they have not joined

- **WHEN** a guest requester is not a member of the public channel
- **THEN** the check denies access

#### Scenario: User lookup fails

- **WHEN** the requester's user info cannot be fetched
- **THEN** the requester is treated as a guest

### Requirement: File access rule

The system SHALL allow access to a Slack file (including canvases and lists) only when at least one of the following holds: the requester created the file; the file's per-user access list names the requester; the requester passes the conversation access rule for a conversation the file is shared to. The system SHALL deny in every other case, including when the file's info cannot be fetched. The check SHALL fetch the file's info itself from the file's id. The file's editor list, its workspace-wide access level and its private-channel count SHALL NOT grant access. An allowed verdict SHALL carry the bot's own access level on the file.

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

#### Scenario: No requester

- **WHEN** a run with no requester asks for a file shared only to private channels
- **THEN** the check denies access

### Requirement: Verdict cache

The system SHALL cache conversation access verdicts in process memory only, with a time to live after which the verdict is recomputed. Denials SHALL expire sooner than allowances. The system SHALL cache each requester's guest-or-full-member classification in process memory with its own, longer time to live. Concurrent lookups for the same conversation and requester, or for the same requester's classification, SHALL share one Slack call. Neither cache SHALL be written to disk.

#### Scenario: Repeated check within the TTL

- **WHEN** the same requester is checked against the same private channel twice within the allow TTL
- **THEN** the membership lookup runs once

#### Scenario: Allow expires

- **WHEN** the allow TTL has elapsed since a cached allowance
- **THEN** the next check performs a fresh membership lookup

#### Scenario: Deny expires sooner

- **WHEN** the deny TTL has elapsed but the allow TTL has not
- **THEN** a cached denial is recomputed

#### Scenario: Concurrent lookups

- **WHEN** two checks for the same requester and channel start before either finishes
- **THEN** one membership lookup is made

#### Scenario: Classification reused

- **WHEN** the same requester is checked against two different channels within the classification TTL
- **THEN** the requester's user info is fetched once

#### Scenario: Classification expires

- **WHEN** the classification TTL has elapsed
- **THEN** the next check fetches the requester's user info again

#### Scenario: Classification outlives a verdict

- **WHEN** the allow TTL has elapsed but the classification TTL has not
- **THEN** the next check repeats the membership lookup without fetching the requester's user info

### Requirement: Session grants

The system SHALL record on the session every conversation and file the access check allows during it, and SHALL allow a target already recorded on the session without evaluating the current requester. A denial SHALL NOT be recorded on the session. Grants SHALL be persisted with the session, and a malformed persisted value SHALL read as no grants. A session created by forking another (a split investigation) SHALL start with the origin session's grants.

#### Scenario: Second participant reuses a grant

- **WHEN** a member of a private channel has been allowed it in a thread's session
- **AND** another participant who is not a member asks for the same channel in that session
- **THEN** the check allows access

#### Scenario: Second participant asks for something new

- **WHEN** a participant asks for a private channel that nobody was granted in the session and they are not a member of
- **THEN** the check denies access

#### Scenario: Denial is not sticky

- **WHEN** a non-member was denied a private channel in a session
- **AND** a member then asks for the same channel in that session
- **THEN** the check allows access

#### Scenario: Grant survives a restart

- **WHEN** a session with a recorded grant is reloaded from disk
- **THEN** the granted target is allowed without a membership lookup

#### Scenario: Malformed persisted grants

- **WHEN** a session's persisted grants are not a list of strings
- **THEN** the session loads with no grants

#### Scenario: Fork inherits grants

- **WHEN** a split investigation is started from a session that holds grants
- **THEN** the investigation's session holds the same grants

#### Scenario: Fork without an origin session

- **WHEN** a split investigation is started from a message that has no session
- **THEN** the investigation's session starts with no grants

#### Scenario: File grant

- **WHEN** a file was allowed for one participant in a session
- **THEN** it is allowed for the other participants of that session

### Requirement: Message-reading tools enforce the check

`fetch_slack_message` and `fetch_channel_messages` SHALL run the conversation access check before reading from Slack and SHALL return a tool error without calling a Slack read method when access is denied. The error SHALL NOT include the conversation's name or content. `search_messages` SHALL omit results from conversations the requester is denied. `follow_thread` and `start_investigation`, which make Clack read a thread into an investigation, SHALL run the same check on the thread's conversation before following it.

#### Scenario: fetch_channel_messages denied

- **WHEN** a requester calls `fetch_channel_messages` for a private channel they are not a member of
- **THEN** the tool returns an error
- **AND** `conversations.history` is not called

#### Scenario: fetch_slack_message denied

- **WHEN** a requester calls `fetch_slack_message` with a URL in a private channel they are not a member of
- **THEN** the tool returns an error
- **AND** no thread or message is fetched

#### Scenario: Denial reveals nothing

- **WHEN** a message-reading tool denies access
- **THEN** the error text contains neither the channel name nor its purpose

#### Scenario: Allowed read is unchanged

- **WHEN** the requester is a member of the private channel
- **THEN** the tool returns the same result it returns without the check

#### Scenario: Thread-following tools denied

- **WHEN** a requester calls `follow_thread` or `start_investigation` for a thread in a private channel they are not a member of
- **THEN** the tool returns an error
- **AND** the thread is not followed and no investigation is started

#### Scenario: Guest search results filtered

- **WHEN** a guest requester's `search_messages` call matches messages in a public channel they have not joined
- **THEN** those messages are absent from the result

