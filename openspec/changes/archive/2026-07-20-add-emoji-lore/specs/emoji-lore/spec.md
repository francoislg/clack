# emoji-lore Specification (delta)

## ADDED Requirements

### Requirement: Emoji Lore Store

The system SHALL persist a workspace emoji lore dictionary at `data/state/emoji-lore.json`, keyed by emoji name (no colons), built on the resilient record store (`createRecordStore`) with a graceful (permissive) zod entry schema. Each entry SHALL carry:

- `name: string` — the emoji name, doubling as the record key
- `meaning: string` — what the emoji means / when it is used
- `tags: string[]` — free-text search hooks
- `examples: Array<{ text: string; link?: string }>` — at most 3; `text` is a paraphrase of a usage situation (never a verbatim quote, never naming the reacting user); `link` is an optional Slack permalink to a source message
- `source: "taught" | "observed"` — provenance
- `updatedAt: string` — ISO timestamp stamped by the store on every write

All mutations SHALL be serialized through a module-level write chain so concurrent writes cannot lose updates.

#### Scenario: Missing store file reads as empty

- **WHEN** `data/state/emoji-lore.json` does not exist
- **THEN** the store loads as an empty record set without error

#### Scenario: Malformed entry is quarantined, not fatal

- **WHEN** the store file contains one entry that fails the entry schema
- **THEN** that entry is quarantined per the resilient record store contract
- **AND** all other entries load normally

#### Scenario: Upsert stamps updatedAt

- **WHEN** an entry is written for a name that already exists
- **THEN** the record is replaced (subject to the provenance conflict rule) and `updatedAt` is set from the injected clock

### Requirement: describe_emoji Tool

The system SHALL provide a `describe_emoji` MCP query tool, registered in query contexts for all roles, that upserts a lore entry. Args: `name` (required), `meaning` (required), `tags` (optional, default `[]`), `examples` (optional, max 3 — enforced by the schema), `source` (required: `"taught"` when a human stated the meaning, `"observed"` when inferred from usage). The tool description SHALL instruct Claude to paraphrase examples, never quote messages verbatim, and never name the reacting user.

Provenance conflict rule: a `source: "observed"` write targeting an existing `source: "taught"` entry SHALL NOT be applied; the tool SHALL return the existing taught entry with a message instructing Claude to surface the discrepancy to the user instead of overwriting. `taught` writes SHALL always be applied.

The tool SHALL check `name` against the `EmojiCache`; when the emoji is not found in the workspace the entry is still saved and the result carries a warning (the cache may be up to 1h stale).

#### Scenario: Taught lore is saved

- **WHEN** Claude calls `describe_emoji` with `name: "team_approved"`, a meaning, tags, and `source: "taught"`
- **THEN** the entry is persisted with `source: "taught"` and a fresh `updatedAt`
- **AND** the result confirms the save

#### Scenario: Observed write cannot overwrite taught lore

- **GIVEN** a stored entry for `crisis_cat` with `source: "taught"`
- **WHEN** Claude calls `describe_emoji` for `crisis_cat` with `source: "observed"` and a different meaning
- **THEN** the stored entry is unchanged
- **AND** the result returns the existing taught entry and instructs Claude to surface the discrepancy rather than overwrite

#### Scenario: Taught write replaces observed lore

- **GIVEN** a stored entry for `crisis_cat` with `source: "observed"`
- **WHEN** Claude calls `describe_emoji` for `crisis_cat` with `source: "taught"`
- **THEN** the new entry replaces the old one

#### Scenario: Taught write replaces taught lore

- **GIVEN** a stored entry for `crisis_cat` with `source: "taught"`
- **WHEN** Claude calls `describe_emoji` for `crisis_cat` with `source: "taught"` and a different meaning
- **THEN** the new entry replaces the old one (a human correcting a human is always applied)

#### Scenario: Observed write replaces observed lore

- **GIVEN** a stored entry for `crisis_cat` with `source: "observed"`
- **WHEN** Claude calls `describe_emoji` for `crisis_cat` with `source: "observed"` and a refined meaning
- **THEN** the new entry replaces the old one (observation refines observation)

#### Scenario: Example cap enforced

- **WHEN** Claude calls `describe_emoji` with 4 examples
- **THEN** the tool input fails schema validation (max 3)

#### Scenario: Unknown emoji saves with warning

- **WHEN** Claude calls `describe_emoji` for a name absent from the `EmojiCache`
- **THEN** the entry is saved
- **AND** the result includes a warning that the emoji was not found in the workspace emoji list

### Requirement: Unknown-Emoji Lore Hint on Message Reading

The `fetch_channel_messages` and `fetch_slack_message` tools SHALL scan fetched messages for custom-emoji usage and check the seen names against the lore store. When at least one seen custom emoji has no lore entry, the tool result SHALL carry a single compact `lore_hint` string listing the unknown names (capped at 5, with an overflow count) and inviting Claude to capture their meaning via `describe_emoji` with `source: "observed"` if the surrounding conversation reveals it. The hint SHALL be phrased as optional and SHALL be absent when every seen custom emoji already has lore or when no custom emojis are present.

Extraction SHALL: (1) collect names from each message's `reactions[].emoji` field; (2) scan message text for tokens matching `/:([a-z0-9_+-]+):/gi`; (3) deduplicate; (4) retain only names present in the `EmojiCache` (so standard Unicode shortcodes and malformed tokens are dropped).

The hint SHALL NOT attempt to detect contradictory usage of emojis that already have lore — that judgment is reserved for the casual-talk engagement run's observe-and-distill clause.

#### Scenario: Hint on unknown custom emoji

- **GIVEN** the lore store has no entry for `crisis_cat`
- **WHEN** `fetch_channel_messages` returns a message with a `crisis_cat` reaction
- **THEN** the tool result carries a `lore_hint` naming `crisis_cat` and suggesting `describe_emoji` (`source: "observed"`)

#### Scenario: Unknown emoji found in message text

- **GIVEN** the lore store has no entry for `ship_it_squirrel` and that emoji exists in the `EmojiCache`
- **WHEN** a fetched message's TEXT contains `:ship_it_squirrel:` and the message has no reactions
- **THEN** the `lore_hint` names `ship_it_squirrel`

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

### Requirement: Compact Lore Index Rendering

The lore module SHALL expose a compact index form of the store for prompt-adjacent consumption: an array of `{ name, meaning, tags }` objects — `examples`, `source`, and `updatedAt` excluded. The `find_emoji` tool surfaces it via `lore_only: true` (see the `find-emoji-tool` delta); example links remain store-only audit context reachable through a normal (non-`lore_only`) lookup.

#### Scenario: Compact form excludes examples and links

- **WHEN** the compact index is rendered for an entry carrying examples with permalinks
- **THEN** the rendered object has exactly the keys `name`, `meaning`, `tags`
- **AND** no example text, permalink, `source`, or `updatedAt` appears
