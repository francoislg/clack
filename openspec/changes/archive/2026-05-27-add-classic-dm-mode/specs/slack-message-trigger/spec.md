## MODIFIED Requirements

### Requirement: Direct Message Handling

The system SHALL handle direct messages and process user messages through the standard query flow with streaming delivery. The handler implementation depends on `directMessages.dmType`:

- When `dmType` is `"assistant"` (or absent), DM handling is performed by the Bolt Assistant API via the `userMessage` handler — see the `slack-assistant` capability for the full registration, status, and title behavior.
- When `dmType` is `"classic"`, DM handling is performed by a low-level `app.event("message")` listener — see the `slack-classic-dm` capability for the listener filtering, routing, and stop-emoji parity rules.

In both modes, the routed call MUST use `triggerType: "directMessages"` and MUST produce a streaming chat response with plan blocks for tool progress and a final response on completion.

#### Scenario: User sends message in assistant thread (assistant mode)
- **GIVEN** `directMessages.dmType` is `"assistant"` or absent
- **WHEN** a user sends a message in an assistant thread
- **THEN** the system processes it via the Assistant's `userMessage` handler
- **AND** calls `setStatus()` for thinking indication
- **AND** routes to `processMessage` with `triggerType: "directMessages"`
- **AND** starts a chat stream with plan blocks showing tool progress
- **AND** stops the stream with the final response blocks on completion

#### Scenario: User sends message with images in assistant thread (assistant mode)

- **GIVEN** `directMessages.dmType` is `"assistant"` or absent
- **WHEN** a user sends a message in an assistant thread containing uploaded images
- **THEN** the system extracts image file metadata from the message event
- **AND** passes the image metadata to `processMessage` alongside the message text

#### Scenario: Follow-up in assistant thread (assistant mode)
- **GIVEN** `directMessages.dmType` is `"assistant"` or absent
- **WHEN** a user sends a follow-up message in an existing assistant thread
- **THEN** the system continues the existing session
- **AND** processes the message with full conversation history
- **AND** starts a new chat stream for the reply with plan blocks

#### Scenario: User sends DM (classic mode)
- **GIVEN** `directMessages.dmType` is `"classic"`
- **WHEN** a user sends a top-level DM (no `thread_ts`)
- **THEN** the system processes it via the classic `message` listener
- **AND** routes to `processMessage` with `triggerType: "directMessages"` and `threadTs: undefined`
- **AND** does NOT call `setStatus`, `setTitle`, or `setSuggestedPrompts`
- **AND** starts a chat stream with plan blocks showing tool progress

#### Scenario: Follow-up DM in classic mode
- **GIVEN** `directMessages.dmType` is `"classic"`
- **WHEN** a user sends a DM with `thread_ts` set (reply in an existing DM thread)
- **THEN** the system processes it via the classic `message` listener
- **AND** routes to `processMessage` with `triggerType: "directMessages"` and the inbound `threadTs`
- **AND** `processMessage` continues the existing session if one is found for that thread

#### Scenario: Image-only DM in classic mode
- **GIVEN** `directMessages.dmType` is `"classic"`
- **WHEN** a user sends a DM with no text but one or more supported image uploads
- **THEN** the classic handler extracts image metadata via `extractAttachments`
- **AND** calls `processMessage` with the synthesized fallback prompt (same string as assistant mode)
- **AND** passes the extracted image metadata alongside the synthesized text
