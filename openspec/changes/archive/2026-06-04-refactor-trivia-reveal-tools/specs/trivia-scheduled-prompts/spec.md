## MODIFIED Requirements

### Requirement: Answer-reveal prompt step flow

The `PROCESS_REVEAL_INSTRUCTIONS` constant SHALL open with the Game Show Presenter persona directive and a "Game: {game}" header, then direct Claude through a renderer flow consisting of these steps, in order:

1. **Call `compute_answers(game: "{game}")`** and read its returned payload. The prompt SHALL describe the payload's shape (the `reveals[]`, the processed `batchId`, `leaderboard`, `roundSummary`, and optional `seasonStatus` fields) so Claude can render it without inventing structure. The prompt SHALL describe each reveal entry's `voters` as a discriminated union on `voters.revealResponses` with three variants:
   - `"yes"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters in `correct[]` and `incorrect[]` carry an `answerText` field that SHOULD be quoted in the reveal.
   - `"just-correctness"` → `voters` carries `correct`, `incorrect`, `noAnswer`, `reactions`. Freeform Voters DO NOT carry `answerText`. The prompt SHALL instruct Claude to enumerate the named voters (e.g. "Marc and Sarah nailed it; Bob missed it") but SHALL NOT quote any typed freeform text — and SHALL note that the text is not in the payload to quote.
   - `"no"` → `voters` carries ONLY `reactions`. The `correct`, `incorrect`, and `noAnswer` fields are physically absent. The prompt SHALL instruct Claude to render the answer plus reactions commentary plus the leaderboard, and NOT to invent or speculate about who voted what.

   The prompt SHALL describe `voters.reactions` as carrying every reactor's FULL emoji set, with bot + cheaters already excluded. The prompt SHALL describe `roundSummary` as ALWAYS present and INDEPENDENT of `revealResponses` (it is the per-player scoreboard aggregate, not a per-question display) — its `perPlayer` array is empty only when nobody answered this round.

2. **Call `update_answers_block(game: "{game}", batchId: <the batchId returned by `compute_answers`>)`** to edit each revealed question's original card into its final static state. The prompt SHALL instruct Claude to pass through the `batchId` that `compute_answers` reported, and SHALL state that this step performs the deterministic card edit (it does not score, judge, or post a new message). When `compute_answers` returned `reveals: []`, Claude SHALL skip this step.

3. **On the season's last fire only, call `start_new_season(...)`** when `seasonStatus.isLastFireOfSeason === true`. The prompt SHALL state that `start_new_season` is idempotent (safe if rollover already happened) and that `compute_answers` itself performs no rollover. When seasons are disabled or `isLastFireOfSeason` is false, Claude SHALL skip this step.

4. **Render the payload via `submit_response`** using the Game Show Presenter voice and Block Kit conventions:
   - A `header` block announcing the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!", or the equivalent for choice; for freeform, the canonical `expectedAnswer`).
   - A `section` block explaining WHY using the question's facts.
   - A `divider` block.
   - For `revealResponses === "yes"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Quote freeform `answerText` inline when present.
   - For `revealResponses === "just-correctness"`: one `section` block per non-empty voter situation: `correct`, `incorrect`, `noAnswer`. Empty situations SHALL be omitted. Enumerate named voters WITHOUT quoting any freeform text.
   - For `revealResponses === "no"`: NO voter-situation sections. Skip directly to the reactions / closer / leaderboard.
   - A `section` block for `reactions` commentary — Claude SHALL freely riff on each reactor's emoji set, treating reactions as pure flavor. For `"yes"` and `"just-correctness"` modes, Claude MAY join on `userId` to correlate reactions with each user's answer when interesting. For `"no"` mode, Claude SHALL NOT correlate reactions with answers (the per-user answer data is not in the payload).
   - A `context` block as a closer that introduces the leaderboard.
   - A top-level `table` parameter rendering the leaderboard.

The prompt SHALL explicitly state that scoring is NOT derived from Slack reactions — the `correct` / `incorrect` buckets are the source of truth (when present) and reactions are commentary only. The prompt SHALL NOT instruct Claude to interpret reactions as votes, classify "fence-sitters" by counting `:+1:` + `:-1:`, or void "multi-react voters" on choice questions.

The prompt SHALL explicitly state that Claude SHALL NOT invent or speculate about per-user participation when the `voters` variant does not include those buckets (`"no"` mode) — the payload boundary is the gate.

#### Scenario: Reveal prompt sequences compute, projection, and render

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** it directs Claude to call `compute_answers` first, then `update_answers_block` with the reported `batchId`, then `submit_response`
- **AND** it directs Claude to call `start_new_season` only when `seasonStatus.isLastFireOfSeason` is true
- **AND** it states `compute_answers` performs no Slack card edit and no season rollover

#### Scenario: Reveal prompt skips projection on empty reveals

- **WHEN** `compute_answers` returns `reveals: []`
- **THEN** the prompt instructs Claude to skip `update_answers_block` and `start_new_season` and to skip the response (per the existing empty-reveal handling)

#### Scenario: Reveal prompt describes the discriminated voter shape

- **WHEN** the `PROCESS_REVEAL_INSTRUCTIONS` constant is inspected
- **THEN** the text describes `voters.revealResponses` as the discriminator and enumerates all three variants (`"yes"`, `"just-correctness"`, `"no"`)
- **AND** the `"yes"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND freeform `answerText` quoting
- **AND** the `"just-correctness"` variant description mentions `correct`, `incorrect`, `noAnswer`, `reactions` AND explicitly states freeform text MUST NOT be quoted (and is not in the payload)
- **AND** the `"no"` variant description states ONLY `reactions` is present and instructs Claude not to speculate about per-user participation
- **AND** does NOT mention `voters.fenceSitters` or `voters.wildcards`
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

#### Scenario: Reveal prompt omits submit_answers and process_reveal_answers

- **WHEN** the prompt is inspected
- **THEN** the text does NOT reference a `submit_answers` tool call
- **AND** the text does NOT reference a `process_reveal_answers` tool call (the compute tool is `compute_answers`)

### Requirement: requiredTools per spec

The `buildGameSpecs` function SHALL emit `requiredTools` for each cron spec:

- For `<game>:question` (question-posting), `requiredTools: ["mcp__trivia__post_questions", "mcp__trivia__save_question", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]`.
- For `<game>:reveal` (reveal), `requiredTools: ["mcp__trivia__compute_answers", "mcp__trivia__update_answers_block"]`, plus `"mcp__trivia__start_new_season"` when seasons are enabled for the game. The `mcp__trivia__submit_answers` and `mcp__trivia__process_reveal_answers` tools SHALL NOT appear (they are removed/renamed).

#### Scenario: Question-posting spec requires post_questions

- **WHEN** `buildGameSpecs` produces the `main:question` spec
- **THEN** `requiredTools` includes `"mcp__trivia__post_questions"`

#### Scenario: Reveal spec requires compute_answers and update_answers_block

- **WHEN** `buildGameSpecs` produces the `main:reveal` spec
- **THEN** `requiredTools` includes `"mcp__trivia__compute_answers"` AND `"mcp__trivia__update_answers_block"`
- **AND** `requiredTools` does NOT include `"mcp__trivia__submit_answers"` or `"mcp__trivia__process_reveal_answers"`

#### Scenario: Reveal spec requires start_new_season when seasons enabled

- **WHEN** `buildGameSpecs` produces the reveal spec for a game with seasons enabled
- **THEN** `requiredTools` includes `"mcp__trivia__start_new_season"`
