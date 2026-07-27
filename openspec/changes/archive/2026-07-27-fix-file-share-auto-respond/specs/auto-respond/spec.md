## ADDED Requirements

### Requirement: Auto-Respond Event Admission by Subtype

The auto-respond `message` listener SHALL admit events whose `subtype` is `undefined`, `"bot_message"`, `"file_share"`, `"thread_broadcast"`, or `"me_message"`, and SHALL discard every other subtype. The latter three are stamped by Slack on ordinary user-authored messages — respectively one carrying an uploaded file, a thread reply also sent to the channel, and a `/me` message — so such events MUST be treated as regular user messages and proceed to the full auto-respond pipeline: thread-session lookup, ephemeral-conversation resolution, standing-rule matching, and pre-analysis.

#### Scenario: File-share message admitted for rule matching

- **WHEN** the auto-respond listener receives a top-level `message` event with `subtype: "file_share"`, non-empty `text`, and a `files` array
- **THEN** the handler SHALL NOT return at the subtype gate
- **AND** the event SHALL be evaluated against the enabled auto-respond rules
- **AND** when a matching rule carries a `preAnalysisContext`, pre-analysis SHALL run on the message text

#### Scenario: Image-only file-share message reaches pre-analysis

- **WHEN** the auto-respond listener receives a `message` event with `subtype: "file_share"`, empty or absent `text`, and a `files` array containing supported image files
- **AND** the resolved path is the standing-rule path with a matching rule that carries a `preAnalysisContext`
- **THEN** the handler SHALL synthesize placeholder analysis text from the image files rather than returning on empty text
- **AND** pre-analysis SHALL run on that synthesized text

#### Scenario: Image-only synthesis is uniform across resolution paths

- **WHEN** an image-only `file_share` event resolves through the standing-rule path, the thread-reply path, or the ephemeral-conversation path
- **THEN** all three SHALL synthesize placeholder analysis text describing the attached images, and for identical image attachments that text SHALL be identical across the three paths
- **AND** none of them SHALL discard the event solely because its `text` is empty

#### Scenario: File-share thread reply admitted

- **WHEN** the auto-respond listener receives a `message` event with `subtype: "file_share"` and a `thread_ts` matching an engaged session
- **THEN** the handler SHALL resolve the thread auto-respond path for that session

#### Scenario: Thread-broadcast and me_message admitted

- **WHEN** the auto-respond listener receives a `message` event with `subtype: "thread_broadcast"` or `subtype: "me_message"` and a `user` and `text`
- **THEN** the handler SHALL NOT return at the subtype gate
- **AND** the event SHALL proceed through the same resolution paths as an unsubtyped user message

#### Scenario: Other subtypes still discarded

- **WHEN** the auto-respond listener receives a `message` event whose `subtype` is any value outside the admitted set (for example `message_changed`, `message_deleted`, `message_replied`, `channel_join`, `channel_topic`)
- **THEN** the handler SHALL return without calling `processMessage`
- **AND** in particular the hidden meta subtypes SHALL remain the responsibility of their dedicated handlers, with edits still owned by the `messageChanged` handler

#### Scenario: File-share message forwards attachments to processMessage

- **WHEN** a `file_share` event is admitted and its rule and pre-analysis gates resolve to a response
- **THEN** the system SHALL call `processMessage` with the attachments extracted from the event's `files` array
