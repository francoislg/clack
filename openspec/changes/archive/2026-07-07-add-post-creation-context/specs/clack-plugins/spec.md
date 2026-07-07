## MODIFIED Requirements

### Requirement: SDK engageThread Method

The plugin SDK (`ClackSdk`) SHALL expose an `engageThread(channel, threadTs, { attentionLevel, creationContext })` method so plugin code that posts via the raw Slack client (e.g. `sdk.getSlackClient().chat.postMessage`) can make the thread it posted into engaged.

`engageThread` SHALL wrap the core engaged-thread-registration primitive: a non-`"off"` `attentionLevel` seeds a discoverable engaged session for `(channel, threadTs)` carrying the level and the optional `creationContext`; `"off"` (or omitted) is a no-op. The `creationContext`, when supplied, SHALL be stored as the seeded session's `creationContext` field and therefore reaches both the pre-analysis judge and the answer turn. This is the ONLY engagement path available to plugins — plugins MUST NOT import core session modules directly (per the plugin hard rules).

#### Scenario: Plugin engages a thread it posted into

- **GIVEN** a plugin posted a message to `C1` whose timestamp is `1700000000.000400`
- **WHEN** the plugin calls `sdk.engageThread("C1", "1700000000.000400", { attentionLevel: "high", creationContext: "…" })`
- **THEN** an engaged session is seeded for `(C1, "1700000000.000400")` with `attentionLevel: "high"` and the supplied `creationContext`

#### Scenario: Off level is a no-op

- **WHEN** the plugin calls `sdk.engageThread("C1", "1700000000.000400", { attentionLevel: "off" })`
- **THEN** no session is seeded
