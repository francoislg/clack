## ADDED Requirements

### Requirement: Stream Keepalive
The system SHALL periodically send keepalive appends to prevent Slack from expiring the chat stream during idle periods.

#### Scenario: Keepalive timer started after stream starts
- **WHEN** `start()` completes successfully (initial append succeeds)
- **THEN** a periodic keepalive timer is started at a fixed interval (15 seconds)

#### Scenario: Keepalive sends current thinking task state
- **WHEN** the keepalive timer fires and the stream is not stopped or failed
- **THEN** the system appends a `task_update` chunk with the current thinking task ID, title, and `in_progress` status
- **AND** this resets Slack's server-side inactivity timer

#### Scenario: Keepalive skipped when stream is stopped
- **WHEN** the keepalive timer fires after `stop()` has been called
- **THEN** no append is sent and the timer is cleared

#### Scenario: Keepalive skipped when stream has failed
- **WHEN** the keepalive timer fires after the stream has entered failed state
- **THEN** no append is sent and the timer is cleared

#### Scenario: Keepalive timer cleared on stop
- **WHEN** `stop()` is called (normal completion)
- **THEN** the keepalive timer is cleared before any finalization appends

#### Scenario: Keepalive timer cleared on start failure
- **WHEN** `start()` fails (Slack API error on initial append)
- **THEN** no keepalive timer is started

#### Scenario: Keepalive failure triggers stream failed state
- **WHEN** the keepalive append fails with an API error
- **THEN** the streamer enters failed state (`hasFailed` returns true)
- **AND** the keepalive timer is cleared

## MODIFIED Requirements

### Requirement: Stream Lifecycle
The system SHALL manage a Slack chat stream for each Claude query, using `chat.startStream` to begin, `chat.appendStream` to send task updates, and `chat.stopStream` to finalize the response with the answer and action buttons. The streamer SHALL also expose the message timestamp for post-delivery operations such as deletion.

#### Scenario: Stream started on query begin
- **WHEN** a Claude query begins processing (any trigger mode)
- **THEN** the system starts a chat stream in the target channel/thread with `task_display_mode: "plan"`
- **AND** immediately shows an initial "Acknowledged, working on it..." task card in `in_progress` status

#### Scenario: Message timestamp captured on first append
- **WHEN** the first `append` call to the Slack streaming API returns successfully
- **THEN** the system captures the message `ts` from the API response
- **AND** exposes it via a `getMessageTs()` getter on SlackStreamer

#### Scenario: Message timestamp available after start
- **WHEN** `start()` completes successfully (the initial append posts the thinking task)
- **THEN** `getMessageTs()` returns the streaming message `ts`

#### Scenario: Message timestamp null on failed start
- **WHEN** `start()` fails and the streamer enters failed state
- **THEN** `getMessageTs()` returns `undefined`

#### Scenario: Stream stopped on query complete
- **WHEN** Claude's query completes and the answer is ready
- **THEN** the system marks the thinking task as `complete` and stops the stream
- **AND** the `stopStream` call includes the rendered answer blocks and action buttons

#### Scenario: Stream stopped on error
- **WHEN** Claude's query fails or returns an error
- **THEN** the system stops the stream and posts error content in the final message

#### Scenario: Fallback on stream start failure
- **WHEN** `startStream` fails (Slack API error)
- **THEN** the system sets the streamer to failed state
- **AND** the caller proceeds with Claude as normal
- **AND** on completion, falls back to `chat.postMessage` with the full response

#### Scenario: Fallback on mid-flight stream failure
- **WHEN** `appendStream` fails during processing
- **THEN** the streamer enters failed state and silently stops appending
- **AND** the keepalive timer is cleared
- **AND** on completion, the caller detects `hasFailed` and falls back to `chat.postMessage`
- **AND** calls `streamer.stop()` first to clear any loading state

#### Scenario: Known stream expiry logged as warning
- **WHEN** `appendStream` fails with `message_not_in_streaming_state`
- **THEN** the error is logged at `warn` level (not `error`)
- **AND** the streamer enters failed state as normal

#### Scenario: Cancellation stops stream
- **WHEN** a request is cancelled (e.g., via message edit)
- **THEN** the system stops the stream with a "_Request cancelled._" markdown text

#### Scenario: Stream always cleaned up
- **WHEN** processing completes (success, error, or exception)
- **THEN** the system calls `streamer.stop()` in a `finally` block to prevent orphaned streams
- **AND** `stop()` is idempotent -- safe to call multiple times
- **AND** the keepalive timer is always cleared

#### Scenario: Stream message deleted on skip
- **WHEN** a response is skipped and `getMessageTs()` returns a valid timestamp
- **THEN** the caller uses `chat.delete` with the channel and message `ts` to remove the stream message
- **AND** the thinking indicator and all task cards disappear from Slack
