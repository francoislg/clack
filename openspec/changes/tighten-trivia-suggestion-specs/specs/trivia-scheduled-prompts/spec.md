## MODIFIED Requirements

### Requirement: Send Questions Instructions Tool

The Trivia plugin SHALL expose a `send_questions_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "question posting" run must follow.

The tool SHALL be gated to the `admin` role (scheduled runs execute with the creator's role, which is admin+ for any trivia setup). The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with a **Game Show Presenter persona** directive ("energetic, engaging, and fun — add showmanship to your delivery") and then instruct Claude through the following ten-step flow, preserving the substantive behavior of the live cron job prior to this change:

1. **Get category ideas and suggestions** — Call `get_ideas`. The tool returns `categories.ideas` (5 categories, excluding the last 10 used), `suggestedAnswer` (a boolean), and `suggestedDifficulty` (one of `"Easy"`, `"Medium"`, `"Hard"`). Pick one category from `categories.ideas`. Read both `suggestedAnswer` and `suggestedDifficulty` — they steer the next steps.
2. **Research a TRUE fact** about that topic, aiming at the difficulty bucket named by `suggestedDifficulty` (Easy = 4–6 on the 1–10 scale, Medium = 7–8, Hard = 9–10).
3. **Honor `suggestedAnswer`** — Claude SHALL produce a statement whose truth value matches `suggestedAnswer`: keep the researched statement TRUE if `suggestedAnswer` is `true`, or modify a key detail to make it FALSE if `suggestedAnswer` is `false` (e.g., swap "shrimp" → "lobster"). The random choice was made server-side; Claude does not redecide it.
4. **Duplicate check** — Call `find_previous_questions`; if a match is found, iterate from step 2.
5. **Validate** the final statement through research — confirm it is actually TRUE or FALSE, matching the `suggestedAnswer` honored in step 3.
6. **Difficulty gate** — Self-rate 1–10. The target range is the one named by `suggestedDifficulty` (Easy = 4–6, Medium = 7–8, Hard = 9–10). Reject and regenerate if the rating is ≤ 3/10; only proceed when ≥ 4/10. The bucket-mapped target supersedes the legacy "5–7/10 sweet spot" guidance.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question`** with `{ category, statement, isTrue, emojis }`; retain the returned `questionId`. `isTrue` SHALL reflect the statement Claude actually produced (and, by the rule in step 3, SHOULD match `suggestedAnswer`).
   **Note:** `SHOULD` (not `SHALL`) is intentional. The system tolerates `isTrue !== suggestedAnswer` to avoid forcing a mid-flow regeneration whenever the model's research disagrees with the suggested truth value. Server-side validation was considered and rejected; observed adherence is high enough that the soft preference is sufficient.
9. **Format using Block Kit `sections`** — no Markdown bold/italic, no `##` headers. A single section, plain text plus emojis. The 👍 (TRUE) marker MUST appear before the 👎 (FALSE) marker. The prompt SHALL encourage Claude to invent a style that fits the day and include at least one concrete example (without prescribing a rotation) so the delivery varies over time.
10. **Deliver via `submit_response`** with `reactions: ["+1", "-1"]` in that exact order (ensures 👍 renders before 👎).

#### Scenario: Returns the full ten-step schedule prompt

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing a numbered sequence covering all ten steps above
- **AND** references the plugin's own tools (`get_ideas`, `find_previous_questions`, `save_question`) by their bare names
- **AND** references `submit_response` for delivery

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the tool is invoked
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`
- **AND** instructs Claude to modify a key detail to make the statement FALSE when `suggestedAnswer` is `false`

#### Scenario: Prompt does not ask Claude to randomize the truth value

- **WHEN** the tool is invoked
- **THEN** the returned text does NOT contain wording that asks Claude to randomly decide, randomly choose, or randomize the statement's truth value
- **AND** the truth value is uniquely determined by `suggestedAnswer`

#### Scenario: Prompt instructs Claude to target suggestedDifficulty

- **WHEN** the tool is invoked
- **THEN** the returned text references `suggestedDifficulty` from `get_ideas`
- **AND** spells out the bucket-to-1–10 mapping: Easy = 4–6, Medium = 7–8, Hard = 9–10
- **AND** instructs Claude to aim the question at the bucket's range when researching and when self-rating

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the tool is invoked
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** ties the target range to the bucket named by `suggestedDifficulty`

#### Scenario: Prompt enforces reaction ordering

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to pass `reactions: ["+1", "-1"]` to `submit_response`, in that order
- **AND** instructs Claude that 👍 (TRUE) must be mentioned before 👎 (FALSE) in the message body

#### Scenario: Prompt invites invented styles and provides at least one example

- **WHEN** the tool is invoked
- **THEN** the returned text explicitly invites Claude to invent its own style each day
- **AND** includes at least one concrete example for inspiration
- **AND** does NOT prescribe a fixed rotation or a required set of named styles

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

#### Scenario: save_question accepts a payload where isTrue diverges from suggestedAnswer

- **WHEN** Claude calls `save_question` with `isTrue` set to a value that does not match the `suggestedAnswer` returned earlier from `get_ideas`
- **THEN** the question is saved as provided, without a validation error
- **AND** the divergence is not flagged or reported back to the caller
- **AND** the system tolerates the divergence under the SHOULD-clause documented in step 8
