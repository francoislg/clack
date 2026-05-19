# trivia-scheduled-prompts Specification

## Purpose

The trivia plugin generates its scheduled-run prompts (question posting, answer reveal) inline as TypeScript constants in `src/plugins/trivia/scheduledPrompts.ts`. The plugin's `buildGameSpecs()` substitutes a `{game}` placeholder per cron spec at plugin load and hands the resulting `CronJobSpec[]` to `sdk.reconcileCronJobs("trivia", ...)`. There are no on-demand "fetch the prompt" MCP tools — admins create games by editing `config.trivia.games[]` and the plugin reconciles automatically. A blocking migration upgrades legacy dispatcher-style cron jobs into the declarative model.

## Requirements

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs reconciled by `sdk.reconcileCronJobs("trivia", specs)` from `config.trivia.games[]` SHALL carry full prompts inlined by `buildGameSpecs()`. Each spec's `prompt` SHALL embed the game's `name` at the top (`"Game: <name>. ..."`) and pass `game: "<name>"` literally to every trivia tool call referenced in the prompt's step sequence.

The prompt text itself SHALL come from constants in `src/plugins/trivia/scheduledPrompts.ts`:

- `SEND_QUESTIONS_INSTRUCTIONS` for the question-posting spec (`<name>:question`).
- The return value of `getProcessResponsesInstructions(seasonsEnabled)` for the reveal spec (`<name>:reveal`).

Each constant SHALL contain a `{game}` placeholder (used at every tool-call step that takes a `game` arg, plus a header line). `buildGameSpecs()` SHALL substitute `{game}` with the spec's `name` before assigning to `CronJobSpec.prompt`.

The persona directive ("PERSONA: You are a charismatic Game Show Presenter!...") SHALL be preserved at the top of both prompt constants. The substantive step flow (research, polarity self-check, duplicate check, difficulty gate, save, format, deliver) for the question post SHALL be preserved. The substantive step flow (fetch most recent question message, extract statement, validate truth, resolve questionId, load history, categorize voters, submit_answers before submit_response, retrieve_scores, deliver Block Kit reveal, season-finale and rollover when applicable) for the reveal SHALL be preserved.

#### Scenario: buildGameSpecs substitutes the game name into both prompts

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", channel: "C123", enabled: true }`
- **WHEN** `buildGameSpecs([main], seasonsEnabled: false)` is called
- **THEN** the returned `specs` includes a `<name>:question` spec whose `prompt` contains the substring `Game: main` and references `game: "main"` at every tool-call step
- **AND** the returned `specs` includes a `<name>:reveal` spec whose `prompt` similarly contains `Game: main` and references `game: "main"` at every tool-call step

#### Scenario: Disabled games are excluded from buildGameSpecs output

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }` and `{ name: "main", enabled: true, ... }`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the returned `specs` includes `main:question` and `main:reveal`
- **AND** does NOT include `retired:question` or `retired:reveal`

#### Scenario: Per-game prompts are isolated from each other

- **GIVEN** `config.trivia.games[]` contains both `main` and `sandbox`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the `main:question` spec's prompt contains `game: "main"` and NOT `game: "sandbox"`
- **AND** the `sandbox:question` spec's prompt contains `game: "sandbox"` and NOT `game: "main"`

### Requirement: Question-posting prompt step flow

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain a numbered step flow that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "{game}")`. Read `suggestedAnswer` and `suggestedDifficulty`. Pick one category from `categories.ideas`.
2. **Write a statement with the correct polarity from the start** — branch on `suggestedAnswer`; never write true then flip.
3. **Polarity self-check** — explicitly verify the statement's actual truth matches `suggestedAnswer`; rewrite if not.
4. **Check for duplicates** — Call `find_previous_questions(game: "{game}", text: ...)`; iterate if a match exists in this game's history.
5. **Validate through research** — confirm the statement is actually true/false.
6. **Difficulty gate** — self-rate 1–10. Easy = 4–6, Medium = 7–8, Hard = 9–10. Reject and regenerate if ≤ 3/10.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "{game}", category, statement, isTrue, emojis)`** — retain `questionId`.
9. **Format using Block Kit `sections`** — 👍 (TRUE) before 👎 (FALSE).
10. **Deliver via `submit_response`** with `reactions: ["+1", "-1"]`.

The prompt SHALL invite Claude to invent a style each day and include at least one concrete example for inspiration.

#### Scenario: Prompt content includes the game header and game-scoped tool calls

- **GIVEN** `buildGameSpecs([{ name: "main", ... }], false)` was called
- **WHEN** the `main:question` spec's `prompt` is inspected
- **THEN** the prompt opens with the persona directive and a `Game: main` header
- **AND** every reference to `get_ideas`, `find_previous_questions`, or `save_question` passes `game: "main"` as an argument

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the prompt content is inspected
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`, FALSE otherwise
- **AND** does NOT instruct Claude to "randomly decide" the truth value

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the prompt content is inspected
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** spells out the bucket-to-1–10 mapping (Easy = 4–6, Medium = 7–8, Hard = 9–10)

#### Scenario: Prompt enforces reaction ordering

- **WHEN** the prompt content is inspected
- **THEN** the returned text instructs Claude to pass `reactions: ["+1", "-1"]` to `submit_response`, in that order
- **AND** instructs Claude that 👍 (TRUE) must be mentioned before 👎 (FALSE) in the message body

### Requirement: Answer-reveal prompt step flow

The `getProcessResponsesInstructions(seasonsEnabled)` function SHALL return a prompt that opens with the Game Show Presenter persona directive and a "Game: {game}" header, then directs Claude through the reveal flow:

1. **Fetch the most recent question message** via `fetch_channel_messages`.
2. **Extract the statement** from that message.
3. **Validate truth** via research.
4. **Compose an explanation** with supporting facts.
5. **Double-check** research accuracy.
6. **Resolve questionId and load history** — Call `find_previous_questions(game: "{game}", text: ...)` to locate the question, then `get_question_history(game: "{game}", questionId)` for cheater list.
7. **Check season status (only when seasons enabled)** — Call `check_season_status(game: "{game}")`.
8. **Categorize reactions, excluding the bot AND silently excluding cheaters**.
9. **Partition voters** into Correct / Incorrect / Fence-sitters / Wildcards.
10. **Submit answers BEFORE response** — Call `submit_answers(game: "{game}", ...)` with single-reaction voters only. `submit_response` MUST NOT run until `submit_answers` completes.
11. **Retrieve leaderboard scores** — Call `retrieve_scores(game: "{game}")`.
12. **Deliver via `submit_response`** using Block Kit (header + section + voter situation coverage + leaderboard table).
13. **Close the current season and ensure continuity (only when seasons enabled AND `isLastFireOfSeason: true`)** — As the final action, call `upsert_season(game: "{game}", slug: currentSlug, endedAt: <now>)` and (when no future season is queued) create a new starter season.

The prompt SHALL NOT mention `save_cheating`, cheater identities, or any DM-the-owner step (cheat detection is the `trivia-check` instruction's responsibility, not the reveal flow's).

#### Scenario: Reveal prompt content includes the game header and game-scoped tool calls

- **GIVEN** `getProcessResponsesInstructions(true)` returns the seasons-enabled prompt template
- **WHEN** `buildGameSpecs([{ name: "main", ... }], true)` substitutes `{game}` with `main`
- **THEN** the resulting `main:reveal` spec's `prompt` opens with the persona directive and a `Game: main` header
- **AND** every reference to `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, or `upsert_season` passes `game: "main"` as an argument
- **AND** the prompt does NOT reference `save_cheating`

#### Scenario: Reveal prompt enforces bot exclusion without a hardcoded ID

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text directs Claude to exclude the bot's own user ID from all reaction lists before analysis
- **AND** instructs Claude to determine the bot's ID from session context rather than hardcoding a specific value

#### Scenario: Reveal prompt enforces silent cheater exclusion

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text directs Claude to call `get_question_history(game: "{game}", questionId: ...)` after locating the question and to remove every user ID in `cheaterUserIds` from every reaction list before voter categorization
- **AND** explicitly forbids mentioning, alluding to, or stylistically signalling the removal in the user-facing reveal

#### Scenario: Reveal prompt enforces submit_answers-before-submit_response ordering

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text includes an explicit rule that `submit_response` MUST NOT be called until `submit_answers(game: "{game}", ...)` has completed

#### Scenario: Reveal prompt names the four voter situations

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text names all four voter situations Claude must cover: CORRECT voters, INCORRECT voters, FENCE-SITTERS, and WILDCARDS

#### Scenario: Reveal prompt contains no cheat-detection logic

- **WHEN** the reveal prompt content is inspected
- **THEN** the returned text does NOT mention `save_cheating`
- **AND** does NOT include any DM-the-owner step

#### Scenario: Seasons disabled — reveal prompt omits all seasons logic

- **GIVEN** `getProcessResponsesInstructions(false)` returns the seasons-disabled template
- **WHEN** the returned prompt content is inspected
- **THEN** the text does NOT reference `check_season_status`, `upsert_season`, `currentSeasonCorrect`, `currentSeasonAnswered`, "season finale", or the 3-row leaderboard shape

#### Scenario: Seasons enabled — reveal prompt includes finale + rollover only on last-fire days

- **GIVEN** `getProcessResponsesInstructions(true)` returns the seasons-enabled template
- **WHEN** the returned prompt content is inspected
- **THEN** the text instructs Claude to call `check_season_status(game: "{game}")` early
- **AND** instructs Claude to render the 3-row leaderboard regardless of season-end state
- **AND** instructs Claude to render the finale section ONLY when `isLastFireOfSeason` is `true`
- **AND** instructs Claude to call `upsert_season(game: "{game}", slug: currentSlug, endedAt: <now>)` as the final tool ONLY when `isLastFireOfSeason` is `true`

### Requirement: requiredTools per spec

Each game's question spec SHALL have `requiredTools` equal to:

```
["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]
```

Each game's reveal spec SHALL have `requiredTools` equal to:

```
base = [
  "mcp__clack__fetch_channel_messages",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__get_question_history",
  "mcp__trivia__submit_answers",
  "mcp__trivia__retrieve_scores"
]
```

When `trivia.seasons.enabled` is `true`, the reveal spec's `requiredTools` SHALL additionally include `"mcp__trivia__check_season_status"`. The conditionally-called timeline tools (`upsert_season`, `delete_season`) SHALL deliberately NOT be in `requiredTools` — they fire only on the last reveal day; listing them would block every other day's reveal.

#### Scenario: Question spec requiredTools

- **WHEN** `buildGameSpecs` produces a `<name>:question` spec
- **THEN** the spec's `requiredTools` includes (at minimum) `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, and `mcp__trivia__save_question`

#### Scenario: Reveal spec requiredTools omits seasons tools when seasons are disabled

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: false)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` consists of the base list only — no `mcp__trivia__check_season_status`

#### Scenario: Reveal spec requiredTools appends check_season_status when seasons are enabled

- **GIVEN** `buildGameSpecs(games, seasonsEnabled: true)` is called
- **WHEN** the resulting `<name>:reveal` spec is inspected
- **THEN** `requiredTools` is the base list PLUS `mcp__trivia__check_season_status`
- **AND** does NOT include `mcp__trivia__upsert_season` or `mcp__trivia__delete_season`

### Requirement: Misconfigured reveal-before-question warning

When `buildGameSpecs` is called, for each game whose `revealCron` would fire before `questionCron` on the next matching date in the game's timezone, the plugin SHALL emit a logger warning naming the game and both cron expressions. The specs SHALL still be returned (no rejection at build time) — the warning surfaces likely misconfigurations without blocking startup.

#### Scenario: Reveal-before-question is warned but not blocked

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", questionCron: "0 17 * * *", revealCron: "0 9 * * *", ... }` (reveal at 9am, question at 5pm)
- **WHEN** `buildGameSpecs([main], ...)` is called
- **THEN** the function returns both `main:question` and `main:reveal` specs (no rejection)
- **AND** a warning is logged identifying `main` and both cron expressions

### Requirement: Legacy Trivia Cron Migration

A blocking migration SHALL run at boot to convert pre-existing dispatcher-style trivia cron jobs into `config.trivia.games[]` entries and delete them from `cron-jobs.json`. The migration SHALL be idempotent and safe to run multiple times.

A cron job is considered a candidate iff `plugin === "trivia"` AND `prompt` matches one of the known dispatcher patterns (`"Call send_questions_instructions and follow"` or `"Call process_responses_instructions and follow"`).

For each pair of candidates sharing the same `channel` (one question + one reveal), the migration SHALL:
1. Derive a `name` (e.g., `"legacy-<channel>"`, lowercased).
2. Append a `TriviaGame` entry to `config.trivia.games[]` with `channel`, `questionCron`, `revealCron`, and `timezone`.
3. Delete both source jobs from `cron-jobs.json`.

The same migration ALSO moves any legacy flat-file trivia data (`data/plugins/trivia/{questions,answers,cheats,seasons}.json`) into a per-game directory under `data/plugins/trivia/games/<target>/`. The target is selected in this order: first newly-created `legacy-<channel>` from this run, else first pre-existing `config.trivia.games[]` entry, else a fallback `initialgame` entry with placeholder crons and `enabled: false`. See the `trivia-games` capability for the full data-move contract.

Inline fat-prompt legacy cron jobs (whose `prompt` does NOT match a dispatcher pattern) SHALL be left untouched by the migration. Such jobs, on first scheduled fire post-upgrade, will fail at the first `mcp__trivia__*` tool call because the tool now requires a `game` argument the inline prompt does not pass. Operators SHALL delete and re-create these jobs by adding entries to `config.trivia.games[]`.

#### Scenario: Dispatcher pair migrates cleanly

- **GIVEN** two cron jobs in channel `C123` with `plugin === "trivia"`, one having `prompt` matching the question dispatcher and `cronExpression: "0 9 * * 1-5"`, the other matching the reveal dispatcher with `cronExpression: "0 15 * * 1-5"`
- **WHEN** the migration runs
- **THEN** `config.trivia.games[]` gains an entry matching `{ name: "legacy-c123", channel: "C123", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: <inherited> }`
- **AND** both source jobs are removed from `cron-jobs.json`

#### Scenario: Inline fat-prompt legacy job is left in place

- **GIVEN** a cron job with `plugin === "trivia"` whose `prompt` is a heavily customized multi-line text (not a known dispatcher pattern)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated
- **AND** the job persists in `cron-jobs.json`
- **AND** on its next scheduled fire, the first `mcp__trivia__*` tool call returns a "missing game argument" Zod error
- **AND** the run aborts without writing any per-game data

#### Scenario: Migration is idempotent

- **GIVEN** the migration has run once and converted all candidates
- **WHEN** the migration runs again on the next boot
- **THEN** no candidates are found
- **AND** the migration is a no-op (no writes to either file)

#### Scenario: Unpaired candidate is flagged

- **GIVEN** a single dispatcher-style job in channel `C123` with no matching pair (only a question, no reveal — or vice versa)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated (a `TriviaGame` requires both question and reveal crons)
- **AND** the job continues to fire
