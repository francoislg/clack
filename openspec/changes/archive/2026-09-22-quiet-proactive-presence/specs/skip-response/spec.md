## MODIFIED Requirements

### Requirement: Skip Response Message Deletion

When a skip is accepted, the system SHALL delete the streamer's message from Slack so that no visual trace of the response attempt remains. When the turn's progress surface was deferred and never committed, there is no message to delete and the system SHALL make no Slack call at all.

#### Scenario: Streamer message deleted after skip

- **WHEN** `askClaude` returns with `response.skipped === true`
- **AND** a SlackStreamer was active with a known message `ts`
- **THEN** the system calls `chat.delete` with the streamer's channel and message `ts`
- **AND** the thinking indicator and all task cards are removed from Slack

#### Scenario: Skip with an uncommitted deferred surface makes no Slack call

- **WHEN** `askClaude` returns with `response.skipped === true`
- **AND** the turn's progress surface was deferred and never committed
- **THEN** the system makes no `chat.startStream`, `chat.appendStream`, `chat.stopStream`, or `chat.delete` call for that surface
- **AND** Slack shows no trace that the turn occurred

#### Scenario: Skip with no streamer (defensive)

- **WHEN** `askClaude` returns with `response.skipped === true`
- **AND** no SlackStreamer was created (e.g., silentThinking mode or stream start failure)
- **THEN** the system skips the `chat.delete` step (no message to delete)
- **AND** session persistence and auto-execute are still skipped

#### Scenario: Delete failure is non-fatal

- **WHEN** `chat.delete` fails (e.g., message already deleted, permission error)
- **THEN** the system logs the error
- **AND** continues without re-throwing (the skip is still considered successful)
- **AND** the session is still NOT persisted (skip decision is independent of message deletion success)

## ADDED Requirements

### Requirement: Skipped Or Cancelled Runs Retract The Queued Follow-Up Acks

The queued follow-up acknowledgement reaction (`reactions.queuedFollowup`, default `eyes`) is added when a message is pushed into an in-flight run, before the run's outcome is known. When that run ends without delivering a response — an accepted skip (`response.skipped`) or a cancellation (`response.cancelled`) that arrives before anything was delivered — the system SHALL remove every queued-follow-up reaction added for messages queued onto that run, so no artifact outlives a run that produced no response. A run that delivered a response (including one cancelled only after delivering) or that ended in an error (which posts an error message in reply) SHALL keep its acks.

The reaction SHALL still be added immediately when the follow-up is queued — its purpose is to tell the sender their message landed while the run is live. Each added ack SHALL be recorded against the run that received the message, in memory, keyed by that run's handle; the record SHALL be reachable from the delivery orchestrator that owns the run, since the queuing call and the owning run are separate invocations. A retraction SHALL wait for the corresponding add to settle before removing, so a fast skip never races an in-flight add and leaves the reaction behind. Removal is best-effort: a failure SHALL be logged and SHALL NOT affect the skip or cancellation.

#### Scenario: Ack retracted when the run skips

- **GIVEN** a message queued onto an in-flight run, for which the queued-follow-up reaction was added to the user's message
- **WHEN** that run ends with `response.skipped === true`
- **THEN** the system calls `reactions.remove` for the configured emoji on that message
- **AND** no acknowledgement remains on a message that received no response

#### Scenario: Ack retracted when the run is cancelled

- **GIVEN** a message queued onto an in-flight run, for which the queued-follow-up reaction was added
- **WHEN** that run is cancelled (e.g., via the stop reaction) and resolves with `response.cancelled === true`
- **THEN** the system retracts the reaction the same as on skip

#### Scenario: Ack retained when the run is cancelled after delivering

- **GIVEN** a message queued onto an in-flight run, for which the queued-follow-up reaction was added
- **WHEN** the run delivers a response and a cancellation then resolves it with `response.cancelled === true`
- **THEN** the reaction is left in place, because a response reached the thread

#### Scenario: Every queued ack on the run is retracted

- **GIVEN** two messages queued onto the same in-flight run, each receiving its own queued-follow-up reaction
- **WHEN** that run ends in a skip
- **THEN** the system retracts the reaction from every queued message, not just the most recent

#### Scenario: Retraction waits for an in-flight add

- **GIVEN** a queued-follow-up reaction whose add call has not yet completed
- **WHEN** the run ends in a skip
- **THEN** the retraction awaits the add's completion before calling `reactions.remove`
- **AND** the reaction is not left on the message after the add lands

#### Scenario: Ack retained when the run delivers

- **GIVEN** a message queued onto an in-flight run, for which the queued-follow-up reaction was added
- **WHEN** that run delivers a response
- **THEN** the reaction is left in place

#### Scenario: Ack retained when the run errors

- **GIVEN** a message queued onto an in-flight run, for which the queued-follow-up reaction was added
- **WHEN** that run ends in an error and an error message is posted in reply
- **THEN** the reaction is left in place

#### Scenario: Retraction failure is non-fatal

- **WHEN** `reactions.remove` fails (e.g., reaction already removed, permission error), or the add it awaited failed
- **THEN** the system logs the error and continues
- **AND** the skip or cancellation is still considered successful

#### Scenario: Nothing to retract when the ack is disabled

- **GIVEN** `reactions.queuedFollowup` is configured as `null` or an empty string
- **WHEN** a run that received a queued follow-up ends in a skip or cancellation
- **THEN** no `reactions.remove` call is made
