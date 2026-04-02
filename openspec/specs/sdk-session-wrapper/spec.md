# sdk-session-wrapper Specification

## Purpose
Enforced query abstraction (`clackQuery` / `clackSession`) that prevents accidental SDK session persistence and provides session resumption for multi-turn conversations.

## Requirements

### Requirement: Query Wrapper Functions

The system SHALL provide two wrapper functions (`clackQuery` and `clackSession`) in `src/claude/query.ts` that replace all direct imports of `query()` from the Claude Agent SDK. No call site SHALL import `query` directly from `@anthropic-ai/claude-agent-sdk`.

#### Scenario: clackQuery disables session persistence

- **WHEN** a call site uses `clackQuery()` for a fire-and-forget query
- **THEN** the wrapper sets `persistSession: false` on the SDK options
- **AND** returns the same async iterable as the SDK `query()` function
- **AND** does NOT capture or return a session ID

#### Scenario: clackSession enables session persistence

- **WHEN** a call site uses `clackSession()` for a multi-turn conversation
- **THEN** the wrapper sets `persistSession: true` on the SDK options
- **AND** returns the same async iterable as the SDK `query()` function
- **AND** captures the `session_id` from the SDK `init` message (`type: "system"`, `subtype: "init"`)
- **AND** makes the captured session ID available to the caller via an `onSessionId` callback

#### Scenario: clackSession supports resume

- **WHEN** `clackSession()` is called with a `resumeSessionId`
- **THEN** the wrapper passes `resume: resumeSessionId` to the SDK `query()` options
- **AND** the SDK loads the full conversation history from the persisted session

#### Scenario: clackSession without resume starts fresh

- **WHEN** `clackSession()` is called without a `resumeSessionId` (or with `undefined`)
- **THEN** the wrapper starts a fresh SDK session
- **AND** the captured session ID is a new UUID

#### Scenario: Resume graceful degradation

- **WHEN** `clackSession()` is called with a `resumeSessionId` that refers to a missing or corrupted session file
- **AND** the SDK throws an error before the first streamed message is received
- **THEN** the wrapper catches the error and falls back to starting a fresh session (no `resume`)
- **AND** logs a warning with the failed session ID and error message
- **AND** the `onSessionId` callback receives the new session ID
- **AND** errors occurring after streaming has started (API errors, rate limits, etc.) are NOT caught by this fallback — they propagate normally

### Requirement: Wrapper API Passthrough

The system SHALL pass all other SDK query options through the wrappers unchanged.

#### Scenario: Options forwarded to SDK

- **WHEN** either wrapper is called with SDK options (model, systemPrompt, cwd, tools, mcpServers, abortController, etc.)
- **THEN** all options are forwarded to the SDK `query()` call unchanged
- **AND** only `persistSession` and `resume` are set/overridden by the wrapper
