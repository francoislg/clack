## MODIFIED Requirements

### Requirement: Disengagement via submit_response

The system SHALL support disengagement from a thread when Claude decides the conversation no longer needs Clack. The `disengage` flag MAY be supplied on either the skip path (declining to answer) or the normal response path (replying and then disengaging in the same turn).

#### Scenario: Claude uses skip_response with disengage

- **WHEN** Claude calls `submit_response` with `skip_response: true` and `disengage: true`
- **THEN** the skip is processed normally (streamer message deleted, no session persistence of response)
- **AND** `autoResponseActive` is set to `false` on the session
- **AND** the updated `autoResponseActive` value is persisted to disk

#### Scenario: Claude uses disengage with a normal response

- **WHEN** Claude calls `submit_response` with `disengage: true` and a normal response (sections and/or actions, no `skip_response`)
- **THEN** the response is delivered to Slack as usual
- **AND** `autoResponseActive` is set to `false` on the session after delivery succeeds
- **AND** the updated `autoResponseActive` value is persisted to disk
- **AND** the tool's success result includes `disengaged: true`

#### Scenario: Disengage on already-disengaged session is idempotent

- **WHEN** Claude calls `submit_response` with `disengage: true` (with or without `skip_response`)
- **AND** `autoResponseActive` is already `false` on the session
- **THEN** the tool succeeds (idempotent)
- **AND** `autoResponseActive` remains `false`

#### Scenario: Disengage on failed delivery does not persist

- **WHEN** Claude calls `submit_response` with `disengage: true` on the normal path
- **AND** the deliver callback returns a failure
- **THEN** the tool returns a `delivery_failed` error
- **AND** `autoResponseActive` is NOT changed
- **AND** no disengagement is persisted

#### Scenario: disengage flag only available when tracking is meaningful

- **WHEN** the session's trigger type is one where `autoResponseActive` has runtime effect (`autoRespond`, `threadReply`, or `mentions`)
- **THEN** the `disengage` parameter is included in the `submit_response` schema
- **AND** Claude may set it to `true` on either skip or normal response paths

#### Scenario: disengage flag omitted for triggers without tracking semantics

- **WHEN** the session's trigger type is `directMessages`, `reactions`, or `scheduled`
- **THEN** the `disengage` parameter is NOT included in the `submit_response` schema
- **AND** disengagement has no meaning for that trigger because auto-respond tracking does not apply

### Requirement: Prompt Guidance for Disengagement

The system SHALL include prompt guidance and tool-schema guidance telling Claude when to use the `disengage` flag, including explicit dismissal phrases.

#### Scenario: submit_response schema description names dismissal triggers

- **WHEN** the `submit_response` tool schema is constructed for a session that supports tracking
- **THEN** the `disengage` parameter's description names explicit user dismissals ("thanks Clack", "you're done", "that's all") as canonical triggers
- **AND** states that `disengage: true` may be combined with a normal response (reply and disengage in the same turn)
- **AND** states that `disengage: true` may also be combined with `skip_response: true` (decline to answer and disengage)

#### Scenario: Delivery-context prompt includes disengage guidance

- **WHEN** the delivery context prompt is built for a session that supports tracking
- **THEN** the prompt includes guidance that Claude can use `disengage: true` when the thread conversation has clearly moved on or when the user explicitly dismisses Clack
- **AND** the prompt distinguishes between `skip_response` alone (temporary silence, stay engaged), `skip_response` + `disengage` (decline and permanently disengage), and normal response + `disengage` (reply and permanently disengage)

