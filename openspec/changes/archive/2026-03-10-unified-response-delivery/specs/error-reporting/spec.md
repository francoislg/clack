## MODIFIED Requirements

### Requirement: Block Posting Retry on Invalid Blocks

The system SHALL rely on `submit_response`'s native delivery feedback loop for block error recovery, instead of external re-invoke retries.

#### Scenario: Slack rejects blocks during submit_response

- **WHEN** Claude calls `submit_response` with valid local blocks
- **AND** the Slack API rejects the delivery (invalid_blocks, msg_too_long)
- **THEN** `submit_response` returns the error details to Claude
- **AND** Claude can adjust the content and call `submit_response` again within the same conversation turn

#### Scenario: Claude self-corrects

- **WHEN** Claude receives a delivery error from `submit_response`
- **THEN** Claude shortens or restructures the response
- **AND** calls `submit_response` again with corrected content
- **AND** the corrected delivery succeeds

#### Scenario: Fallback on stream failure

- **WHEN** the streaming channel has failed (stream expired, API unreachable)
- **AND** Claude calls `submit_response`
- **THEN** the deliver callback falls back to `chat.postMessage`
- **AND** if that also fails, the error is returned to Claude

## REMOVED Requirements

### Requirement: Plain Text Fallback on Exhausted Retries

**Reason**: Replaced by the in-tool feedback loop. Claude sees errors natively and can retry with corrected content. The external re-invoke + plain text fallback pattern is no longer needed.
**Migration**: No action needed — error recovery is now handled within the `submit_response` tool call.
