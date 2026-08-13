# requester-identity Specification

## Purpose
Surface the current turn's speaker identity (Slack display name / `@username` / user ID / mapped GitHub username) in Claude's prompt for interactive triggers, resolved per-turn and degrading gracefully when the GitHub mapping is unknown, so Claude can resolve first-person references without asking.

## Requirements

### Requirement: Requester Identity in Claude Prompt

The system SHALL surface the current turn's speaker identity in Claude's prompt for every human-speaker trigger — that is, all trigger types EXCEPT `scheduled`. The identity SHALL include the speaker's Slack display name, `@username`, and user ID when available, and the speaker's mapped GitHub username when the user registry has one.

Identity SHALL be rendered as an attribution on the `QUESTION:` line (co-located with the message), consistent with how thread-history messages are attributed.

#### Scenario: DM trigger includes requester identity

- **WHEN** building the prompt for a `directMessages` trigger from a user with display name `Frankyboy`, username `flguillemette`, ID `U09FSR0REUQ`, and mapped GitHub username `francoislg`
- **THEN** the `QUESTION:` line is attributed with the speaker's display name, `@username`, user ID, and GitHub username
- **AND** the attribution names `francoislg` as the GitHub identity to use for author-scoped lookups

#### Scenario: Mention trigger includes requester identity

- **WHEN** building the prompt for a `mentions` trigger
- **THEN** the `QUESTION:` line carries the current speaker's attribution

#### Scenario: Reaction trigger includes requester identity

- **WHEN** building the prompt for a `reactions` trigger
- **THEN** the `QUESTION:` line carries the reacting user's attribution

#### Scenario: Auto-respond trigger includes requester identity

- **WHEN** building the prompt for an `autoRespond` trigger
- **THEN** the `QUESTION:` line carries the current speaker's attribution

#### Scenario: Thread-reply and channel-reply triggers include requester identity

- **WHEN** building the prompt for a `threadReply` or `channelReply` trigger (a human continuing a thread or posting in a watched channel)
- **THEN** the `QUESTION:` line carries the current speaker's attribution

#### Scenario: Scheduled trigger has no requester attribution

- **WHEN** building the prompt for a `scheduled` trigger
- **THEN** the `QUESTION:` line carries NO speaker attribution (there is no single human speaker)

### Requirement: Per-Turn Identity Resolution

The system SHALL resolve requester identity from the CURRENT turn's user, not from the session creator, so that a multi-user thread attributes the live speaker rather than whoever started the thread.

#### Scenario: Reused multi-user thread attributes the current speaker

- **WHEN** a session started by user A is reused for a follow-up turn whose current speaker is user B
- **THEN** the prompt attributes the `QUESTION:` line to user B (the current speaker), not user A

#### Scenario: Identity is not persisted onto the session

- **WHEN** requester identity is resolved for a turn
- **THEN** it is passed to the prompt builder as a per-turn input and is NOT written onto the persisted session's creator fields

### Requirement: Per-Turn Identity in Query Tool Context

The query tool context's `userId` SHALL resolve to the current turn's speaker when one exists, falling back to the session creator only when the turn has no requester (e.g. the `scheduled` trigger). Every query tool that reads the context `userId` as "the user acting now" — attribution (`start_investigation` requester, `follow_thread` `addedBy`, reminder and scheduled-message attribution), ownership stamps (`createdBy`, skill ownership), and caller-scoped privacy checks (`find_session_transcript`, `stop_tracking`, `find_recent_interactions`) — SHALL therefore observe the current speaker on reused multi-user threads.

#### Scenario: Tool attribution names the current speaker on a reused thread

- **WHEN** a session created by user A is reused for a turn whose current speaker is user B and Claude calls a tool that attributes the acting user (e.g. `start_investigation`)
- **THEN** the tool observes user B as the context `userId`
- **AND** the resulting attribution names user B, not user A

#### Scenario: Scheduled trigger falls back to the session creator

- **WHEN** a tool reads the context `userId` during a `scheduled` trigger (no per-turn requester)
- **THEN** the context `userId` is the session's `userId`, unchanged from prior behavior

#### Scenario: Ownership and privacy checks evaluate the current speaker

- **WHEN** user B, on a thread whose session was created by user A, calls a caller-scoped tool such as `find_session_transcript`
- **THEN** the privacy check evaluates user B as the caller

### Requirement: Graceful Degradation When GitHub Mapping Is Absent

The system SHALL render the available Slack identity even when the user registry has no GitHub username for the speaker, and SHALL make the absence explicit so Claude falls back to `find_user` or asking rather than guessing.

#### Scenario: No GitHub mapping — Slack identity still shown

- **WHEN** building the prompt for a speaker whose registry record has no GitHub username
- **THEN** the `QUESTION:` line is still attributed with the available Slack display name, `@username`, and user ID
- **AND** the attribution does NOT assert a GitHub username

#### Scenario: Display name only

- **WHEN** the speaker has a display name but no username
- **THEN** the attribution shows the display name and user ID (no `@username`)

#### Scenario: Username only

- **WHEN** the speaker has a username but no display name
- **THEN** the attribution shows `@username` and user ID (no display name)

#### Scenario: Minimal Slack identity

- **WHEN** the speaker's display name and username are both unavailable
- **THEN** the attribution falls back to the user ID alone
