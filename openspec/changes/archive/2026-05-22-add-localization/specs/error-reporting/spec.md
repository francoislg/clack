## ADDED Requirements

### Requirement: Localized User-Facing Error Messages

All user-visible error messages emitted by Clack's own TypeScript code (not produced by Claude) — including in-stream error text, fallback `chat.postMessage` error blocks, "Try Again" button labels, permission-denied messages, validation-rejection messages, and the headers of error-report DMs — SHALL be sourced from the localization dictionary via the `t()` helper.

Internal diagnostic content within error reports (stack traces, raw error messages from third-party APIs, tool-call dumps, session IDs) SHALL pass through unchanged. These are debugging aids, not user-facing prose.

Claude-generated error analysis text (the narrative produced when Claude is asked to summarize what went wrong for a DM error report) SHALL be written in the configured language because Claude operates under the language directive — no `t()` call is required on that path.

#### Scenario: Streamed error message localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a Claude query fails and the stream is healthy
- **THEN** the error text delivered via `stopStream` is rendered in French via `t()`
- **AND** the "Try Again" button label is rendered in French via `t()`

#### Scenario: Fallback chat.postMessage error blocks localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a Claude query fails and the stream has failed
- **THEN** the error blocks posted via `chat.postMessage` use French strings sourced via `t()`
- **AND** the "Try Again" button label is in French via `t()`

#### Scenario: Error-report DM header localized

- **GIVEN** the configured language is `"fr"` AND `slack.sendErrorsAsDM` is `true`
- **WHEN** an error DM is sent
- **THEN** the header text indicating an error occurred is in French via `t()`
- **AND** the session-ID label and any surrounding bot-authored prose are in French via `t()`
- **AND** the embedded stack trace, raw API error, and tool-call dump pass through unchanged

#### Scenario: Claude-authored error analysis follows language directive

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude is invoked to analyze an error for inclusion in a DM
- **THEN** the analysis narrative is produced in French (via the language directive)
- **AND** no `t()` lookup is required because the text is Claude-authored, not template-authored

#### Scenario: Migration-failure admin DM localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a migration fails and the admin DM is sent
- **THEN** the bot-authored framing of the message (intro, guidance line) is in French via `t()`
- **AND** the migration name, error message, and stack trace pass through unchanged
