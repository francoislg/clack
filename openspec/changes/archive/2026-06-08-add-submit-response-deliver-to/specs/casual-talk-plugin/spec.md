## MODIFIED Requirements

### Requirement: Prompt Assembly

The plugin SHALL assemble the cron job's `prompt` at reconcile time to embed: the resolved die `N`, the candidate channel list, and the **effective fallback topics**. The effective fallback topics SHALL be computed from config as follows:

- When `useBuiltinFallbackTopics` is `true`, the effective list is the de-duplicated union of the plugin's built-in topic constant followed by the admin's `smallTalkTopics` (built-ins first, custom appended, duplicates removed preserving first occurrence).
- When `useBuiltinFallbackTopics` is `false`, the effective list is exactly `smallTalkTopics` (verbatim, the pre-feature behavior).

The prompt SHALL instruct Claude to:

1. Call `random_roll` with `min: 1, max: N, count: 1`.
2. If the roll is not `1`, immediately call `submit_response({ skip_response: true })` and end the run.
3. Otherwise: read each candidate channel via `fetch_channel_messages`, evaluate which channel feels most natural to join, and deliver in a SINGLE `submit_response` call carrying a `deliver_to` entry — `submit_response({ deliver_to: [{ channel, thread_ts?, response: { blocks } }] })`. Claude SHALL NOT also set `skip_response` on a delivering call.
4. If no channel feels right, end with `submit_response({ skip_response: true })` and no `deliver_to` (legitimate outcome).
5. NEVER reveal that this run was triggered by a roll or automation — the persona is "you're a person dropping in naturally."

Per-channel context SHALL include the channel ID and, when set on the config entry, the `promptSuggestion` string. Channel name and Slack metadata are NOT pre-fetched in v1 — Claude reads what it needs via `fetch_channel_messages`.

#### Scenario: Prompt embeds the resolved die size

- **GIVEN** a config that resolves to `die: 32`
- **WHEN** the prompt is assembled
- **THEN** the prompt mentions `1` of `32` as the "post-trigger" outcome
- **AND** the prompt mentions the resolved rate label (e.g., "rate: daily ≈ 1/32") for transparency

#### Scenario: Prompt embeds candidate channels with promptSuggestion

- **GIVEN** `channels: ["C123", { id: "C456", promptSuggestion: "memes only" }]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists `C123` and `C456` as candidate channels
- **AND** the prompt notes the `promptSuggestion` "memes only" against `C456`
- **AND** the prompt does NOT attach a suggestion to `C123`

#### Scenario: Built-ins enabled with no custom topics uses the built-in list

- **GIVEN** `useBuiltinFallbackTopics: true` and `smallTalkTopics: []`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists the plugin's built-in fallback topics as openers

#### Scenario: Built-ins enabled with custom topics unions both

- **GIVEN** `useBuiltinFallbackTopics: true` and `smallTalkTopics: ["food", "weekend plans"]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists every built-in topic AND `"food"` AND `"weekend plans"`
- **AND** a custom topic that duplicates a built-in appears only once

#### Scenario: Built-ins disabled falls back to verbatim custom topics

- **GIVEN** `useBuiltinFallbackTopics: false` and `smallTalkTopics: ["food"]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists exactly `"food"` and none of the built-in topics

#### Scenario: Built-ins disabled with no custom topics has no fallback openers

- **GIVEN** `useBuiltinFallbackTopics: false` and `smallTalkTopics: []`
- **WHEN** the prompt is assembled
- **THEN** the prompt indicates there are no fallback topics (the pre-feature empty-list rendering), and Claude is to only join already-active conversations or skip

#### Scenario: Prompt tells Claude to deliver via deliver_to, not a post_to action

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs that delivery MUST go through a `submit_response({ deliver_to: [...] })` call (channel + `response` blocks per entry)
- **AND** the prompt instructs Claude NOT to also set `skip_response` on a delivering call
- **AND** the prompt does NOT instruct Claude to use a `post_to` action for delivery
