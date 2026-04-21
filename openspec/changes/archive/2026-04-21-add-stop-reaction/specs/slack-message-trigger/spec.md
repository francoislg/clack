## ADDED Requirements

### Requirement: Inline Stop Emoji Detection

The system SHALL detect the configured stop emoji (`config.reactions.stop`) appearing inline in message text for DMs, @mentions, and thread replies, treating a match as equivalent to adding the stop reaction to the message. Detection SHALL run before pre-analysis, auto-respond rule matching, and `processMessage` dispatch, and SHALL be a cheap synchronous check (no LLM call, no network round-trip).

#### Scenario: Inline stop emoji triggers stop behavior

- **WHEN** a non-bot message arrives via DM, @mention, or thread reply
- **AND** `config.reactions.stop` is set to a non-empty string
- **AND** the trimmed message text is 60 characters or fewer
- **AND** the text contains either the Unicode form of `config.reactions.stop` OR the colon shortcode `:<name>:` where `<name>` equals `config.reactions.stop`
- **THEN** the system does NOT call `processMessage`
- **AND** does NOT run pre-analysis
- **AND** does NOT run auto-respond rule matching
- **AND** dispatches to the same thread-scoped cancel + disengage pipeline used by the stop reaction (abort in-flight query/worker work for the thread, set `autoResponseActive = false`)
- **AND** does NOT post a reply

#### Scenario: Inline stop emoji in a long message is ignored

- **WHEN** a message contains the configured stop emoji
- **AND** the trimmed message text is longer than 60 characters
- **THEN** the inline detection does NOT fire
- **AND** the message proceeds through normal pre-analysis and `processMessage` dispatch

#### Scenario: Stop emoji in colon shortcode form matches

- **WHEN** a message contains `:<name>:` where `<name>` equals `config.reactions.stop` (e.g., `:octagonal_sign:`)
- **AND** the trimmed message text is 60 characters or fewer
- **THEN** the inline detection fires, regardless of whether the Unicode form is also present

#### Scenario: Stop emoji in Unicode form matches

- **WHEN** a message contains the rendered Unicode codepoint for `config.reactions.stop` (e.g., 🛑 for `octagonal_sign`)
- **AND** the trimmed message text is 60 characters or fewer
- **THEN** the inline detection fires, regardless of whether the colon form is also present

#### Scenario: Custom emoji without Unicode form matches via colon only

- **WHEN** `config.reactions.stop` is set to a custom emoji name (e.g., `clack-stop`) that has no standard Unicode codepoint
- **AND** a message contains `:clack-stop:` and is 60 characters or fewer
- **THEN** the inline detection fires

#### Scenario: Inline detection disabled when config is unset

- **WHEN** `config.reactions.stop` is unset, `null`, or an empty string
- **THEN** the system does NOT run inline stop-emoji detection on any message
- **AND** messages proceed through normal handling

#### Scenario: Detection fires for any thread participant

- **WHEN** a message matching the inline detection rule is posted by any user in a thread (not restricted to the original requester or mentioner)
- **THEN** the inline detection fires and stops the thread

#### Scenario: Detection ignores bot messages

- **WHEN** a message matching the inline detection rule would otherwise fire, but the message is from the bot itself or another bot (`bot_id` matches a bot)
- **THEN** the inline detection does NOT fire

#### Scenario: Detection ignores message edits

- **WHEN** a user edits an existing message to add the stop emoji after the fact (`message_changed` subtype)
- **THEN** the inline detection does NOT fire
- **AND** behavior mirrors the stop reaction, which only fires on `reaction_added` events (not edits or reaction replacements)

#### Scenario: Detection short-circuits before pre-analysis

- **WHEN** a message matching the inline detection rule arrives in a handler that would otherwise run pre-analysis
- **THEN** pre-analysis is NOT invoked
- **AND** no LLM call is made in service of deciding whether to respond
