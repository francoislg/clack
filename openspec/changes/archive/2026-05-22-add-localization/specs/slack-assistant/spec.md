## ADDED Requirements

### Requirement: Localized Assistant Suggested Prompts and Bot-Authored Strings

Bot-authored strings emitted by the Slack Assistant integration SHALL be sourced from the localization dictionary via the `t()` helper. This includes:

- The set of suggested prompts shown when a user opens a new assistant thread (`setSuggestedPrompts`).
- The status text passed to `setStatus` (e.g. "Thinking…").
- The thread title text passed to `setTitle` when the bot generates a fallback title (Claude-generated titles follow the language directive and require no `t()` call).
- The "Send to thread" button label (and any other assistant-action button labels owned by Clack rather than Claude).

#### Scenario: Suggested prompts localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a user opens a new assistant thread
- **THEN** `setSuggestedPrompts` is called with French prompt strings sourced via `t()`

#### Scenario: setStatus text localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the assistant handler calls `setStatus`
- **THEN** the status text is in French via `t()` (e.g. "Réflexion en cours…")

#### Scenario: Send-to-thread button label localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the assistant renders a message with the "Send to thread" action button
- **THEN** the button label is in French via `t()`

#### Scenario: Claude-authored assistant title follows language directive

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude generates a thread-title summary and the handler calls `setTitle`
- **THEN** the title is in French because Claude produces it under the language directive
- **AND** no `t()` lookup is required on this path

### Requirement: Assistant Delivery Context Preserves Pre-Localization Output

The `buildDeliveryContext` helper SHALL produce output byte-identical to its pre-localization form when the configured language is `"en"` or absent. The language directive itself SHALL be carried by `buildSystemPrompt` (per the `instruction-system` and `localization` capabilities), not duplicated into `buildDeliveryContext`.

#### Scenario: Delivery context unchanged when language is "en"

- **GIVEN** the configured language is `"en"` (or absent)
- **WHEN** `buildDeliveryContext` is rendered for Claude's prompt
- **THEN** the rendered text MUST be byte-identical to the pre-localization output
- **AND** the delivery context MUST NOT contain any language-related markers or reminders

#### Scenario: Delivery context unchanged when language is "fr"

- **GIVEN** the configured language is `"fr"` AND the session has `assistantOriginChannelId` set
- **WHEN** `buildDeliveryContext` is rendered for Claude's prompt
- **THEN** the rendered text MUST be byte-identical to the EN-language output for the same session state
- **AND** the language directive MUST be supplied by `buildSystemPrompt`, not duplicated into the delivery context
