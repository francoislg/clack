## ADDED Requirements

### Requirement: SDK engageThread Method

The plugin SDK (`ClackSdk`) SHALL expose an `engageThread(channel, threadTs, { attentionLevel, followUpContext })` method so plugin code that posts via the raw Slack client (e.g. `sdk.getSlackClient().chat.postMessage`) can make the thread it posted into engaged.

`engageThread` SHALL wrap the core engaged-thread-registration primitive: a non-`"off"` `attentionLevel` seeds a discoverable engaged session for `(channel, threadTs)` carrying the level and the optional `followUpContext`; `"off"` (or omitted) is a no-op. This is the ONLY engagement path available to plugins — plugins MUST NOT import core session modules directly (per the plugin hard rules).

#### Scenario: Plugin engages a thread it posted into

- **GIVEN** a plugin posted a message to `C1` whose timestamp is `1700000000.000400`
- **WHEN** the plugin calls `sdk.engageThread("C1", "1700000000.000400", { attentionLevel: "high", followUpContext: "…" })`
- **THEN** an engaged session is seeded for `(C1, "1700000000.000400")` with `attentionLevel: "high"` and the supplied follow-up context

#### Scenario: Off level is a no-op

- **WHEN** the plugin calls `sdk.engageThread("C1", "T", { attentionLevel: "off" })`
- **THEN** no session is seeded

#### Scenario: Plugins do not import core session modules

- **WHEN** the trivia or casual-talk plugin engages a thread
- **THEN** it does so only through `sdk.engageThread` (or a Claude-authored `deliver_to`/`post_to` field)
- **AND** it does not import `src/sessions.ts` or any core module outside the plugin folder
