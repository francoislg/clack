## MODIFIED Requirements

### Requirement: Prompt Assembly

The plugin SHALL assemble the cron job's `prompt` at reconcile time to embed: the resolved die `N`, the candidate channel list, and the **effective fallback topics**. The effective fallback topics SHALL be computed from config as follows:

- When `useBuiltinFallbackTopics` is `true`, the effective list is the de-duplicated union of the plugin's built-in topic constant followed by the admin's `smallTalkTopics` (built-ins first, custom appended, duplicates removed preserving first occurrence).
- When `useBuiltinFallbackTopics` is `false`, the effective list is exactly `smallTalkTopics` (verbatim, the pre-feature behavior).

The prompt SHALL instruct Claude to:

1. Call `random_roll` with `min: 1, max: N, count: 1`.
2. If the roll is not `1`, immediately call `submit_response({ skip_response: true })` and end the run.
3. Otherwise: read each candidate channel via `fetch_channel_messages`, then take one or more of the following **non-exclusive** positive moves:
   - **React** — add one or more emoji to a recent message via `add_reaction` (see the reaction requirements below). Reacting MAY be done alone or together with a post.
   - **Post** — deliver in a SINGLE `submit_response` call carrying a `deliver_to` entry — `submit_response({ deliver_to: [{ channel, thread_ts?, response: { blocks } }] })`. Claude SHALL NOT also set `skip_response` on a delivering call.
4. Terminate according to the moves taken:
   - **React-only:** after the `add_reaction` call(s), end with `submit_response({ skip_response: true })` and no `deliver_to`. The reaction is a tool side-effect, not a delivery, so `skip_response` (meaning "no message posted") is the correct terminal call.
   - **React-and-post** or **post-only:** end with the single `deliver_to` entry and no `skip_response`.
   - **Neither:** when nothing is worth posting AND nothing is worth reacting to, end with `submit_response({ skip_response: true })` and no `deliver_to` (legitimate outcome).
5. NEVER reveal that this run was triggered by a roll or automation — the persona is "you're a person dropping in naturally." This SHALL apply to reactions as well as posts.

Per-channel context SHALL include the channel ID and, when set on the config entry, the `promptSuggestion` string. The prompt SHALL direct Claude to also read each candidate channel's `channel_name` and `channel_purpose` (both surfaced by `fetch_channel_messages`) when present, to calibrate channel character.

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
- **THEN** the prompt indicates there are no fallback topics (the pre-feature empty-list rendering), and Claude is to only join already-active conversations, react, or skip

#### Scenario: Prompt tells Claude to deliver via deliver_to, not a post_to action

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs that delivery MUST go through a `submit_response({ deliver_to: [...] })` call (channel + `response` blocks per entry)
- **AND** the prompt instructs Claude NOT to also set `skip_response` on a delivering call
- **AND** the prompt does NOT instruct Claude to use a `post_to` action for delivery

#### Scenario: Prompt does NOT reveal the triggering mechanism

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to NEVER mention the die roll, the schedule, or "automation" in the posted message text OR via the reactions it adds

#### Scenario: Prompt offers reaction as an on-hit move

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs that on a hit Claude MAY react to a recent message via `add_reaction` as an alternative to, or in combination with, posting
- **AND** the prompt states the three positive moves are non-exclusive: react-only, post-only, or react-and-post

#### Scenario: Reaction joinability bar is looser than posting

- **WHEN** the prompt is assembled
- **THEN** the prompt states that a message is reactable when it is a recent HUMAN message worth a lightweight acknowledgment (a win, a funny line, an announcement, a fresh human message), a lower bar than the substantive-thread bar required to write a posted reply
- **AND** the prompt reuses the human-leaf guard: Claude reacts only to messages whose latest content is from a human, never to bot-leaf messages or the bot's own posts

#### Scenario: Prompt instructs emoji search before reacting

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to call `find_emoji` to discover custom workspace emoji fitting the channel's character and the message before reacting, falling back to standard emoji
- **AND** the prompt instructs Claude to calibrate emoji choice to the channel's character via its `promptSuggestion` hint, its `channel_name`, and its `channel_purpose`

#### Scenario: Prompt caps reaction volume by judgment, not a number

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to focus reactions on one or two messages per fire
- **AND** the prompt instructs that when several related messages are active, a single emoji on the best one suffices rather than blanketing the channel
- **AND** the prompt does NOT impose a fixed numeric cap on reactions

#### Scenario: React-only run terminates with skip_response

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs that a react-only run ends with `submit_response({ skip_response: true })` and no `deliver_to` after the `add_reaction` call(s)
- **AND** the prompt instructs that a react-and-post run ends with the single `deliver_to` entry and no `skip_response`
