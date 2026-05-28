## Why

Today the reveal-disclosure axis (`revealResponses`) only offers all-or-nothing naming: `"yes"` and `"just-correctness"` both name everyone who got it WRONG, while `"no"` names nobody. There is no setting that celebrates the winners while sparing the missers — the common "X and Y got it right! 🎉" reveal where wrong answers stay private. Admins want that middle rung.

## What Changes

- Add a fourth `revealResponses` mode, `"just-winners"`, sitting between `"just-correctness"` and `"no"` in disclosure.
- In `"just-winners"` mode the reveal payload names the **correct** voters only; the incorrect and no-answer voters are reduced to **anonymous counts** (`incorrectCount`, `noAnswerCount`) so flair like "2 nailed it, 3 missed" and "everyone got fooled!" survives without naming anyone.
- Reactions commentary is preserved (as in every mode).
- Freeform correct voters keep their typed `answerText` (celebrating the right answer is fine); missers are never quoted because they are not named at all.
- The new mode is accepted everywhere the existing modes are configured (slot / season / game / workspace cascade) and surfaced by the read tools.
- `roundSummary` and the multi-question "This Round" leaderboard row stay gated to all-`"yes"` batches — `"just-winners"` is treated like the other restricted modes (no per-player aggregate).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-reveal-processor`: the `voters` discriminated union gains a `"just-winners"` variant carrying `correct` + `incorrectCount` + `noAnswerCount` + `reactions`.
- `trivia-question-posting`: `revealResponses` resolution/stamping accepts the new enum value.
- `trivia-scheduled-prompts`: reveal rendering gains a `"just-winners"` branch (single- and multi-question layouts) that names winners and renders an anonymous miss line.
- `trivia-games`: per-game / workspace `revealResponses` config accepts `"just-winners"`.
- `trivia-seasons`: per-season / per-slot `revealResponses` config accepts `"just-winners"`.

## Impact

- **Types/config**: `core/configTypes.ts` (`RevealResponsesMode`), `core/configParsers/axes.ts` (`REVEAL_RESPONSES_VALUES`); the cascade resolver (`revealResponsesResolver.ts`) is value-agnostic and needs no change.
- **Reveal payload**: `tools/reveal/types.ts` (new union variant); bucket assembly in `answerTypes/{boolean,choice,freeform}.ts`; `tools/reveal/roundSummary.ts` (skip the new variant — it has no `incorrect`/`noAnswer` arrays); `tools/reveal/processRevealAnswers.ts` (tool-description text only — the `allYes` gate already excludes non-`"yes"`).
- **Rendering**: `prompts/scheduledPrompts.ts` (payload description + single/multi reveal branches).
- **Config surfaces**: `tools/games/{upsertGame,setWorkspaceConfig,listGames}.ts`, `tools/seasons/{upsertSeason,listSeasons}.ts`, `core/configParsers/{format,games}.ts`.
- **Tests**: the three answer-type handler suites, `processRevealAnswers.test.ts`, `roundSummary.test.ts`, the axes parser test.
- No data migration: the enum is additive and stamped per-question; existing records are unaffected.
