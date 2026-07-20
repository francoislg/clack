# trivia-scheduled-prompts — delta for add-trivia-game-wind-down

## MODIFIED Requirements

### Requirement: Answer-reveal prompt step flow

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL open with the Game Show Presenter persona directive and a "Game: {game}" header, then direct Claude through a renderer flow consisting of these steps, in order:

1. **Call `compute_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, the processed `batchId`, `leaderboard`, `roundSummary`, and optional `seasonStatus` fields) so Claude can render it without inventing structure. The prompt SHALL describe each reveal entry's `voters` as a discriminated union on `voters.revealResponses` with three variants:
   - `"yes"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters in `correct[]` and `incorrect[]` carry an `answerText` field that SHOULD be quoted in the reveal.
   - `"just-correctness"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters DO NOT carry `answerText`. The prompt SHALL instruct Claude to enumerate the named voters (e.g. "Marc and Sarah nailed it; Bob missed it") but SHALL NOT quote any typed freeform text — and SHALL note that the text is not in the payload to quote.
   - `"no"` → `voters` carries ONLY `reactions`. The `correct`, `incorrect`, and `noAnswer` fields are physically absent. The prompt SHALL instruct Claude to render the answer plus reactions commentary plus the leaderboard, and NOT to invent or speculate about who voted what.

   The prompt SHALL describe `voters.reactions` as carrying every reactor's FULL emoji set, with bot + cheaters already excluded. The prompt SHALL describe `roundSummary` as ALWAYS present and INDEPENDENT of `revealResponses` (it is the per-player scoreboard aggregate, not a per-question display) — its `perPlayer` array is empty only when nobody answered this round.

2. **Call `refresh_question_cards(game: "{game}", batchId: <the batchId returned by `compute_answers`>)`** to edit each revealed question's original card into its final static state. The prompt SHALL instruct Claude to pass through the `batchId` that `compute_answers` reported, and SHALL state that this step performs the deterministic card edit (it does not score, judge, or post a new message). When `compute_answers` returned `reveals: []`, Claude SHALL skip this step.

3. **On the round's final fire only, call `end_season(...)`** when `seasonStatus.isLastFireOfSeason === true` OR the payload carries `windDown: { eligible: true }` (the seasonless final-reveal report). The prompt SHALL state that `end_season` is idempotent (safe if the close already happened), self-guarding (a call outside either gate is refused server-side), and that `compute_answers` itself performs no rollover. When neither gate holds, Claude SHALL skip this step. The prompt SHALL direct Claude to read the `end_season` result: when it carries `gameDisabled: true`, the finale closer SHALL be a series wrap (the game is over for good — no "see you next season" and no next-season preview); otherwise the normal season-handoff closer applies.

4. **Render the payload via `submit_response`** using the Game Show Presenter voice and Block Kit conventions:
   - A `header` block announcing the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!", or the equivalent for choice; for freeform, the canonical `expectedAnswer`).
   - A `section` block explaining WHY using the question's facts.
   - A `divider` block.
   - For `revealResponses === "yes"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Quote freeform `answerText` inline when present.
   - For `revealResponses === "just-correctness"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Enumerate named voters WITHOUT quoting any freeform text.
   - For `revealResponses === "no"`: NO voter-situation sections. Skip directly to the reactions / closer / leaderboard.
   - A `section` block for `reactions` commentary — Claude SHALL freely riff on each reactor's emoji set, treating reactions as pure flavor. For `"yes"` and `"just-correctness"` modes, Claude MAY join on `userId` to correlate reactions with each user's answer when interesting (e.g. "Marc clutched the right answer AND dropped a 🎯"). For `"no"` mode, Claude SHALL NOT correlate reactions with answers (the per-user answer data is not in the payload).
   - A `context` block as a closer that introduces the leaderboard.
   - A top-level `table` parameter rendering the leaderboard.

The prompt SHALL explicitly state that scoring is NOT derived from Slack reactions — the `correct` / `incorrect` buckets are the source of truth (when present) and reactions are commentary only. The prompt SHALL NOT instruct Claude to interpret reactions as votes, classify "fence-sitters" by counting `:+1:` + `:-1:`, or void "multi-react voters" on choice questions.

The prompt SHALL explicitly state that Claude SHALL NOT invent or speculate about per-user participation when the `voters` variant does not include those buckets (`"no"` mode) — the payload boundary is the gate.

#### Scenario: Reveal prompt describes the discriminated voter shape

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the text describes `voters.revealResponses` as the discriminator and enumerates all three variants (`"yes"`, `"just-correctness"`, `"no"`)
- **AND** the `"yes"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND freeform `answerText` quoting
- **AND** the `"just-correctness"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND explicitly states freeform text MUST NOT be quoted (and is not in the payload)
- **AND** the `"no"` variant description states ONLY `reactions` is present and instructs Claude not to speculate about per-user participation
- **AND** does NOT mention `voters.fenceSitters` or `voters.wildcards`
- **AND** does NOT describe a "user reacted with both 👍 and 👎" fence-sitter classification
- **AND** does NOT describe a "multi-react void" rule

#### Scenario: Reveal prompt branches block rendering on revealResponses

- **WHEN** the prompt's per-mode rendering instructions are inspected
- **THEN** the `"yes"` branch describes per-bucket sections WITH freeform quotes
- **AND** the `"just-correctness"` branch describes per-bucket sections WITHOUT freeform quotes
- **AND** the `"no"` branch describes NO per-bucket sections, only reactions + closer + leaderboard

#### Scenario: Reveal prompt describes roundSummary as always present and mode-independent

- **WHEN** the prompt's payload-shape description is inspected
- **THEN** `roundSummary` is described as ALWAYS present and INDEPENDENT of `revealResponses`
- **AND** the prompt states `roundSummary.perPlayer` is empty only when nobody answered this round

#### Scenario: Reveal prompt treats reactions as commentary

- **WHEN** the prompt's reactions section is inspected
- **THEN** the text instructs Claude to riff on per-user emoji sets purely for flavor
- **AND** explicitly states that reactions do not affect scoring
- **AND** invites Claude to correlate reactions with the same user's answer when there is something funny to say (correct + 🎯, incorrect + 🤔, no-answer + 🐢, etc.)

#### Scenario: Reveal prompt sequences compute, projection, and render

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** it directs Claude to call `compute_answers` first, then `refresh_question_cards` with the reported `batchId`, then `submit_response`
- **AND** it directs Claude to call `end_season` when `seasonStatus.isLastFireOfSeason === true` OR when the payload carries `windDown: { eligible: true }`, and to skip it when neither gate holds
- **AND** it states `compute_answers` performs no Slack card edit and no season rollover
- **AND** it does NOT reference `start_new_season`

#### Scenario: Reveal prompt keys finale tone off gameDisabled

- **WHEN** the prompt's `end_season` step is inspected
- **THEN** it directs Claude to render a series-wrap closer (no next-season preview, no "see you next season") when the `end_season` result carries `gameDisabled: true`

#### Scenario: Reveal prompt gates the seasonless wind-down on the payload report

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** it directs Claude to call `end_season` when the `compute_answers` payload carries `windDown: { eligible: true }`, even with `seasonStatus` absent
- **AND** the series-wrap closer directive applies to that call's `gameDisabled: true` result the same as on the seasons path

#### Scenario: Reveal prompt skips projection on empty reveals

- **WHEN** `compute_answers` returns `reveals: []`
- **THEN** the prompt instructs Claude to skip `refresh_question_cards` and `end_season` and to skip the response (per the existing empty-reveal handling)

### Requirement: requiredTools per spec

The `buildGameSpecs` function SHALL emit `requiredTools` for each cron spec containing ONLY tools called on 100% of valid runs of that spec (the `submit_response` gate force-calls every listed tool, so a conditional tool would be forced on runs where it does not apply):

- For `<game>:question` (question-posting): `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]` when the game is NOT flexible, and `["mcp__trivia__get_ideas"]` when `game.format?.flexible === true` (a flexible fire may legitimately post zero questions). `save_question`, `find_previous_questions`, and `find_previous_subjects` SHALL NOT appear — they are skipped by some generation paths (predictions skip the dedup gate; staged-pool slots skip `save_question`; `find_previous_subjects` runs only in the image subflow).
- For `<game>:reveal` (reveal): `["mcp__trivia__compute_answers"]`. `compute_answers` is the only tool called on every reveal (including an empty batch). `refresh_question_cards`, `end_season`, `settle_question`, and `set_reveal_narrative` SHALL NOT appear — each is invoked by the reveal prompt only conditionally. `submit_answers`, `process_reveal_answers`, and `start_new_season` SHALL NOT appear (removed/renamed).

#### Scenario: Non-flexible question spec requires get_ideas and post_questions

- **WHEN** `buildGameSpecs` produces the `main:question` spec for a non-flexible game
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]`
- **AND** it does NOT include `"mcp__trivia__save_question"` or `"mcp__trivia__find_previous_questions"`

#### Scenario: Flexible question spec omits post_questions

- **WHEN** `buildGameSpecs` produces the question spec for a game with `format.flexible === true`
- **THEN** `requiredTools` equals `["mcp__trivia__get_ideas"]`
- **AND** it does NOT include `"mcp__trivia__post_questions"`

#### Scenario: Reveal spec requires only compute_answers

- **WHEN** `buildGameSpecs` produces the `main:reveal` spec
- **THEN** `requiredTools` equals `["mcp__trivia__compute_answers"]`
- **AND** it does NOT include `"mcp__trivia__refresh_question_cards"`, `"mcp__trivia__end_season"`, `"mcp__trivia__settle_question"`, `"mcp__trivia__set_reveal_narrative"`, `"mcp__trivia__submit_answers"`, `"mcp__trivia__process_reveal_answers"`, or `"mcp__trivia__start_new_season"`
- **AND** the list is identical whether or not seasons are enabled for the game
