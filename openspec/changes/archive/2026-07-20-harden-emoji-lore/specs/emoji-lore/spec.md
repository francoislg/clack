# emoji-lore Specification (delta)

## MODIFIED Requirements

### Requirement: Unknown-Emoji Lore Hint on Message Reading

The `fetch_channel_messages` and `fetch_slack_message` tools SHALL scan fetched messages for custom-emoji usage and check the seen names against the lore store. When at least one seen custom emoji has no lore entry, the tool result SHALL carry a single compact `lore_hint` string listing the unknown names (capped at 5, with an overflow count) and inviting Claude to capture their meaning via `describe_emoji` with `source: "observed"` if the surrounding conversation reveals it. The hint SHALL be phrased as optional and SHALL be absent when every seen custom emoji already has lore or when no custom emojis are present.

Extraction SHALL: (1) collect names from each message's `reactions[].emoji` field; (2) scan message text for `:name:` tokens, where a token qualifies only if BOTH the character immediately before the opening colon and the character immediately after the closing colon are non-digits (or absent at a string boundary), AND the name is not composed entirely of digits; (3) deduplicate; (4) retain only names present in the `EmojiCache`.

The two text rules exist because clock times and ISO timestamps (`19:48:30`) would otherwise match, and are the single largest source of candidate names in real message data. The `EmojiCache` intersection remains the authoritative filter for what is a custom emoji; the text rules are a pre-filter that keeps timestamp fragments from ever reaching it.

The hint SHALL NOT attempt to detect contradictory usage of emojis that already have lore — that judgment is reserved for the casual-talk engagement run's observe-and-distill clause.

#### Scenario: Hint on unknown custom emoji

- **GIVEN** the lore store has no entry for `crisis_cat`
- **WHEN** `fetch_channel_messages` returns a message with a `crisis_cat` reaction
- **THEN** the tool result carries a `lore_hint` naming `crisis_cat` and suggesting `describe_emoji` (`source: "observed"`)

#### Scenario: Unknown emoji found in message text

- **GIVEN** the lore store has no entry for `ship_it_squirrel` and that emoji exists in the `EmojiCache`
- **WHEN** a fetched message's TEXT contains `:ship_it_squirrel:` and the message has no reactions
- **THEN** the `lore_hint` names `ship_it_squirrel`

#### Scenario: Timestamps yield no candidate names

- **WHEN** a fetched message's text contains `19:48:30` or `2026-07-20T19:48:30.383Z`
- **THEN** extraction yields no names from that text
- **AND** no `EmojiCache` lookup is performed for `48`, `30`, or any other timestamp fragment

#### Scenario: Purely numeric tokens are rejected

- **WHEN** a fetched message's text begins with `:50:` (no preceding character)
- **THEN** extraction yields no name, because an all-digit token is never an emoji name

#### Scenario: Emoji adjacent to text still extracts

- **WHEN** a fetched message's text is `nice :appywave: work` or `:appywave: !`
- **THEN** extraction yields `appywave`

#### Scenario: No hint when lore is known

- **GIVEN** the lore store has an entry for every custom emoji appearing in the fetched messages
- **WHEN** `fetch_channel_messages` returns those messages
- **THEN** the result carries no `lore_hint`

#### Scenario: Standard emojis never trigger the hint

- **WHEN** fetched messages contain only standard Unicode emoji shortcodes (absent from the `EmojiCache`)
- **THEN** the result carries no `lore_hint`

#### Scenario: Unknown names capped

- **GIVEN** 8 distinct custom emojis with no lore appear in the fetched messages
- **THEN** the `lore_hint` names at most 5 of them and states how many more were omitted

## ADDED Requirements

### Requirement: Lore Deletion via describe_emoji

The `describe_emoji` tool SHALL accept an optional `clear: boolean`. When `clear` is `true`, the tool deletes the lore entry for `name` and ignores `meaning`, `tags`, `examples`, and `source`. When `clear` is absent or `false`, the tool behaves as an upsert and `meaning` is required.

`meaning` SHALL be optional in the declared schema, with the pairing enforced by the handler: a non-clear call missing `meaning` SHALL return an error result naming the missing field.

A clear SHALL be exempt from the taught-wins provenance rule — it may delete a `taught` entry. That rule guards against a machine inference silently OVERWRITING a human's stated meaning; a deletion is explicit and targeted, and is the only recourse for lore that is wrong rather than stale. The tool description SHALL scope clearing to human-initiated requests rather than autonomous observation.

Clearing a name with no stored entry SHALL succeed rather than error, since the caller's intent is already satisfied.

#### Scenario: Clear removes an entry

- **GIVEN** a stored entry for `crisis_cat`
- **WHEN** Claude calls `describe_emoji` with `name: "crisis_cat"` and `clear: true`
- **THEN** the entry is removed from the store
- **AND** the result reports success

#### Scenario: Clear deletes taught lore

- **GIVEN** a stored entry for `crisis_cat` with `source: "taught"`
- **WHEN** Claude calls `describe_emoji` with `clear: true`
- **THEN** the entry is removed (the provenance guard does not apply to deletion)

#### Scenario: Clearing an absent entry succeeds

- **GIVEN** the store has no entry for `never_existed`
- **WHEN** Claude calls `describe_emoji` with `name: "never_existed"` and `clear: true`
- **THEN** the result reports success and no error is raised

#### Scenario: Clear ignores the write fields

- **WHEN** Claude calls `describe_emoji` with `clear: true` and also supplies `meaning` and `tags`
- **THEN** the entry is deleted and no upsert is performed

#### Scenario: Non-clear call requires meaning

- **WHEN** Claude calls `describe_emoji` without `clear` and without `meaning`
- **THEN** the tool returns an error result naming `meaning` as required
- **AND** no store mutation occurs

#### Scenario: Clear normalizes the name

- **GIVEN** a stored entry keyed `ship_it`
- **WHEN** Claude calls `describe_emoji` with `name: ":Ship_It:"` and `clear: true`
- **THEN** the `ship_it` entry is removed
