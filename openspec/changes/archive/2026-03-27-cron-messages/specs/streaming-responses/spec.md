## ADDED Requirements

### Requirement: Silent Thinking Mode

The system SHALL support a `silentThinking` mode in `executeAndDeliver` that bypasses the SlackStreamer and posts the final result directly.

#### Scenario: No streamer created when silentThinking
- **WHEN** `executeAndDeliver` is called with `silentThinking: true`
- **THEN** no `SlackStreamer` is created
- **AND** the `onEvent` handler passed to `askClaude` is a no-op

#### Scenario: Direct delivery when silentThinking
- **WHEN** Claude calls `submit_response` during a silent thinking session
- **THEN** the response is posted via `chat.postMessage` directly
- **AND** no streaming task cards or "thinking..." indicators are shown in the channel

#### Scenario: Top-level posting when silentThinking
- **WHEN** a silent thinking session delivers its response
- **THEN** the `chat.postMessage` call SHALL NOT include `thread_ts`
- **AND** the message appears as a top-level message in the target channel

#### Scenario: Error handling when silentThinking
- **WHEN** a silent thinking session encounters an error
- **THEN** the system SHALL NOT post the error to the target channel
- **AND** error reporting follows the caller's error handling (e.g., DM to creator for cron jobs)

#### Scenario: Existing streaming behavior unchanged
- **WHEN** `executeAndDeliver` is called without `silentThinking` (or with `silentThinking: false`)
- **THEN** the system SHALL create a `SlackStreamer` and stream tool progress as before
- **AND** no behavior changes for existing trigger types
