## ADDED Requirements

### Requirement: Reveal prompt branches the summary on `finalRevealSummary`

`PROCESS_REVEAL_INSTRUCTIONS` SHALL branch the closing-summary rendering on the payload's `finalRevealSummary`, with type-gated instructions so each branch is a single linear path. The leaderboard `table` SHALL be posted top-level in every branch; only the verdict/WHY/voter narrative varies:

- **`"yes"`** → today's flow: narrative blocks + leaderboard `table` in one top-level `submit_response`.
- **`"no"`** → a top-level `submit_response` carrying the leaderboard `table` and a brief closer only; NO verdict/WHY/voter narrative blocks.
- **`"in-thread"`** → a top-level `submit_response` whose blocks carry the leaderboard `table` and a localized "see the responses in thread!" pointer (`sdk.t()`), with the full verdict/WHY/voter narrative supplied as `thread_replies` (posted as a threaded reply under the primary).

On the season's last fire the finale (podium + gated all-time table) SHALL be rendered top-level in every branch (per `trivia-final-reveal-summary`); in `"in-thread"` the day's per-question verdicts still go to `thread_replies` while the finale stays top-level.

#### Scenario: Prompt describes all three summary branches

- **WHEN** `PROCESS_REVEAL_INSTRUCTIONS` is inspected
- **THEN** it branches on `finalRevealSummary`
- **AND** the `"yes"` branch posts narrative + leaderboard top-level
- **AND** the `"no"` branch posts the leaderboard top-level with no narrative
- **AND** the `"in-thread"` branch posts the leaderboard + localized pointer top-level and the narrative via `thread_replies`

#### Scenario: Leaderboard is top-level in every branch

- **WHEN** any of the three branch instructions is inspected
- **THEN** the leaderboard `table` is posted on the top-level (primary) `submit_response`, never only in the thread

#### Scenario: in-thread instructs both the pointer and the thread reply

- **WHEN** the `"in-thread"` branch is inspected
- **THEN** it instructs Claude to include the localized pointer in the top-level blocks
- **AND** to supply the narrative as `thread_replies`
