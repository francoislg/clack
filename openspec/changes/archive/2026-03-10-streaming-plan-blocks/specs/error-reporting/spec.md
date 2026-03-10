## MODIFIED Requirements

### Requirement: User-Friendly Error Display
Error responses are now delivered via the stream or as a fallback `chat.postMessage`, not via ephemeral messages.

#### Scenario: Error delivered via stream
- **WHEN** Claude query fails and the stream is healthy
- **THEN** the system stops the stream with the error text and a "Try Again" button via `stopStream`

#### Scenario: Error delivered via fallback
- **WHEN** Claude query fails and the stream has failed
- **THEN** the system calls `streamer.stop()` to clear loading state
- **AND** posts error blocks with "Try Again" button via `chat.postMessage`
- **AND** targets the DM thread if in DM mode, otherwise the channel thread

## REMOVED Requirements

### Requirement: Block Posting Retry on Invalid Blocks
**Reason**: The block retry mechanism (`retryWithBlockError`, `isSlackBlockError`) is removed. With streaming, the response is delivered via `stopStream` which doesn't have the same block validation issues. If blocks are invalid, the stream simply fails and the fallback posts the answer.
**Migration**: No action needed. Block validation still happens in `submit_response` before capture.

### Requirement: Plain Text Fallback on Exhausted Retries
**Reason**: Removed along with block retry. The streaming fallback (`hasFailed` → `chat.postMessage`) replaces this with a simpler approach that always includes full blocks.
**Migration**: No action needed.
