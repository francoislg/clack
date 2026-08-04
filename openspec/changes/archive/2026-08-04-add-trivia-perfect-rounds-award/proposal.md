## Why

The season finale celebrates the points champion (🥇 podium) and the season MVP, but consistency — repeatedly sweeping every question on a fire — goes unrecognized. A player who nailed clean rounds all season but never topped the points table currently gets no spotlight. A "most perfect rounds" bonus medal rewards that consistency without touching scoring.

## What Changes

- Add an opt-in, cascading `perfectRoundsAward` knob (bare `enabled` boolean) that turns on a season-finale **bonus 🎖️ medal** for the player(s) with the most **perfect rounds** across the season. Cascade tiers: `season → game → workspace → default(off)`. Structural-special (like `answeringType`/`tagPlayers`), NOT a `CascadeAxes` member — no slot tier, no `get_ideas`/`save_question` roll.
- At the season finale, `process_reveal_answers` aggregates perfect rounds season-wide by grouping the season's revealed questions by `batchId` (a "fire") and applying the existing clean-sweep rule per batch (≥3 questions, all answered correctly). It surfaces the leader(s) on a new `seasonStatus.perfectRoundsChampion?: { userIds: string[]; count: number }` payload field.
- The season-finale prompt (`scheduledPrompts.ts` finale layout + `FINALE_TONE_CONTENT` topic) renders the 🎖️ bonus medal for `perfectRoundsChampion` when present — persona-flavored, mention policy honored, ties share the medal.
- No new scoring, no leaderboard change, no persistence: the tally is a read-time aggregation of data already stored (`batchId`, scored answers). Award is scoped to seasons-enabled finales only.
- Surfaced by `list_games` / `list_seasons`; settable via `upsert_game` / `upsert_season` / `set_workspace_config`.

## Capabilities

### New Capabilities

- `trivia-perfect-rounds-award`: the opt-in cascading knob, the season-wide perfect-round aggregation, the finale payload field, and the finale bonus-medal rendering.

### Modified Capabilities

(none — the feature is additive and inert until enabled; existing finale behavior is unchanged when `perfectRoundsAward` is off at every tier)

## Impact

- **Config types + validators**: `TriviaConfig` (workspace), `TriviaGame`, `SeasonEntry` gain an optional `perfectRoundsAward?: { enabled: boolean }` (`configTypes.ts`), each with a zod validator.
- **Resolver**: new `resolvePerfectRoundsAward(season, game, workspace)` in `src/plugins/trivia/domain/`.
- **Reveal processor**: `computeAnswers.ts` (season-finale branch) gains the batch-grouped aggregation + the `SeasonStatusOut.perfectRoundsChampion` field (`tools/reveal/types.ts`).
- **Prompts**: `prompts/scheduledPrompts.ts` (SEASON FINALE LAYOUT) + `prompts/topicInstructions.ts` (`FINALE_TONE_CONTENT`).
- **Admin/read tools**: `list_games`, `list_seasons`, `upsert_game`, `upsert_season`, `set_workspace_config`.
- **Tests**: new aggregation unit tests; validator/cascade tests; finale-prompt content tests. No migration (additive optional field, graceful readers).
