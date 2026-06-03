## ADDED Requirements

### Requirement: SDK can start a Claude Q&A turn in a thread

The plugin SDK SHALL expose a method, `startThreadConversation`, that lets a plugin programmatically start a full Claude Q&A turn in a given channel and thread — distinct from `askClaude` (which is single-turn, tool-less, posts nothing, and creates no session). The method SHALL route through the bot core's `processMessage` so the started turn runs with the normal query toolset (including `WebSearch` and `submit_response`), creates a real session keyed on `channel:threadTs`, and delivers Claude's answer into the thread. Because a session is created, the thread becomes auto-follow-enabled (`autoResponseActive` true) per the `auto-respond` capability.

The method SHALL accept at minimum: the target `channel`, the `threadTs` anchoring the conversation, the `prompt` (the user-turn text), and an optional `additionalSystemPrompt` carrying caller-supplied context. It SHALL be wired into the SDK via `ClackSdkDeps` (bound to core's `processMessage` in the app/lifecycle layer, mirroring how `clackQuery` and `getSlackClient` are injected), and the SDK method SHALL supply the live Slack client itself rather than requiring the plugin to pass one.

#### Scenario: Plugin starts a thread conversation

- **WHEN** a plugin calls `sdk.startThreadConversation({ channel, threadTs, prompt, additionalSystemPrompt })`
- **THEN** the core `processMessage` flow runs for that channel/thread with the full query toolset
- **AND** a session is created keyed on `channel:threadTs`
- **AND** Claude's answer is delivered into the thread

#### Scenario: Uses the common chat streamer

- **WHEN** a plugin calls `sdk.startThreadConversation(...)`
- **THEN** the turn runs with the normal streaming UX (thinking-card → final answer), exactly like a user-initiated conversation
- **AND** `silentThinking` is NOT enabled (the kickoff is not a silent/cron-style delivery)

#### Scenario: Started thread is auto-follow-enabled

- **WHEN** a thread conversation has been started via `startThreadConversation`
- **AND** a subsequent human reply arrives in that thread
- **THEN** the existing thread auto-respond path finds the session and evaluates the reply (subject to pre-analysis)

#### Scenario: Slack client not connected

- **WHEN** `startThreadConversation` is called before the Slack client is connected
- **THEN** the method does not throw
- **AND** it reports the failure to the caller (return value or logged warning) without crashing the plugin

#### Scenario: Dependency not wired (tests / early boot)

- **WHEN** the `startThreadConversation` dependency is absent from `ClackSdkDeps`
- **THEN** the method is a logged no-op (consistent with `requestSoftRestart`'s default-no-op pattern) rather than throwing
