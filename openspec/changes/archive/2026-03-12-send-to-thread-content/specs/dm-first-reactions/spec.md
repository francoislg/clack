## MODIFIED Requirements

### Requirement: Synthesis and Send to Thread

The system SHALL post per-button content when the user clicks "Send to thread", reading the content entry persisted at button creation time.

#### Scenario: Send to thread posts button-specific content

- **WHEN** the user clicks a "Send to thread" button
- **THEN** the handler decodes the content entry ID from the button value
- **AND** looks up the content entry from `session.snapshots`
- **AND** posts that specific content to the target channel thread
- **AND** confirms delivery in the DM thread

#### Scenario: Send to thread with missing content entry

- **WHEN** the user clicks a "Send to thread" button but the content entry is not found in the session
- **THEN** the handler logs an error
- **AND** does NOT post to the channel
- **AND** does NOT fall back to `session.lastAnswer` or `session.lastResponse`

#### Scenario: Send to thread with explicit target

- **WHEN** the button value includes explicit `channel` and `thread_ts`
- **THEN** the content is posted to that specific channel and thread
- **AND** the origin channel/thread fallback chain is not used
