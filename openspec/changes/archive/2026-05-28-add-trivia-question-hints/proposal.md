## Why

Hard trivia questions today are all-or-nothing: a player either knows the answer or doesn't. Harder difficulty means more "no answer" submissions and a flatter reveal. Adding an optional hint axis lets organizers nudge players without giving the answer away — and lets harder slots stay hard without trading off participation. Like every other generation axis, hints need to cascade through `slot → season → game → workspace` so admins can tune the experience independently per tier.

## What Changes

- Add an optional `hint` axis to `TriviaConfig`, `TriviaGame`, `SeasonEntry`, and `SeasonFormatSlot` with shape:
  ```ts
  hint?: { mode: "none" | "button" | "inline"; minDifficulty?: "easy" | "medium" | "hard" }
  ```
  - `mode` defaults to `"none"` via cascade fallthrough. `"button"` appends a "Get Hint!" button to the answer-button row; clicking sends an ephemeral message in the thread (Slack-scoped to the clicker). `"inline"` posts the hint as an italicized `💡 _Hint:_ <text>` context block above the answer-button row so everyone sees it immediately.
  - `minDifficulty` — when set, hints are generated only if the rolled question difficulty bucket is at or above this threshold (`easy < medium < hard`). When unset, hints are generated for every question whose effective mode is `"button"` or `"inline"`.
- Add a `resolveHintConfig(slotIndex, season, game, workspace)` helper using whole-object replace per tier, defaulting to `{ mode: "none" }`.
- Extend `get_ideas` to compute `effectiveHintMode` (after applying `minDifficulty` against the rolled difficulty) and surface `suggestedHintMode` + `hintGuidance` in the payload.
- Extend the question-generation prompt with a hint-drafting step that includes a **self-review pass** in the same Claude session: Claude drafts a hint, then checks whether it states or paraphrases the answer, rewriting as a softer nudge if so. No separate judge call.
- Extend `save_question` to accept and validate optional `hint: { mode: "button" | "inline"; text: string }` — trimmed non-empty, ≤140 chars. Persisted on the `TriviaQuestion` record. Omission is allowed even when `get_ideas` suggested non-`none` (Claude may judge no useful hint exists).
- Extend `post_questions` rendering: `"button"` mode appends `"💡 Get Hint!"` to the answer-button actions row with `action_id: plugin:trivia:hint:<questionId>`. `"inline"` mode prepends a `context` block `💡 _Hint:_ <text>` immediately above the answer-button actions row.
- Register a new Slack action handler matching `plugin:trivia:hint:*` that posts an ephemeral message (`chat.postEphemeral`) to the thread with the hint text, and atomically updates the question record's `hint.clickedBy: string[]` (deduped — user added at most once). Repeat clicks fire a fresh ephemeral but do NOT add a duplicate entry. Graceful fallback when the question record has no `hint` (stale message) — ephemeral "no hint available."
- Click tracking is **button-mode only**. Inline mode has no click event to record; `clickedBy` is absent on inline records.
- Hints are NEVER surfaced at reveal time and have NO effect on scoring.
- Update `list_games` to surface per-game + workspace `hint` when set; update the trivia management instruction file and CLAUDE.md with the new axis.
- **Not a breaking change**: every existing config behaves identically — the new field is optional and defaults to `{ mode: "none" }`, which is no-op.

## Capabilities

### New Capabilities

- `trivia-question-hints`: defines the hint axis (config shape, cascade ordering, `minDifficulty` filter, `get_ideas` payload, self-review prompt step, `save_question` validation, stored record shape, click-tracking semantics, ephemeral-message handler).

### Modified Capabilities

- `trivia-games`: add the `hint` field to per-game and workspace tiers; document the cascade alongside the existing axes; surface via `list_games`.
- `trivia-question-posting`: extend `post_questions` rendering for `"button"` and `"inline"` hint modes, including action ID convention and block layout.

## Impact

- **Code**: `src/plugins/trivia/core/configTypes.ts` (types), `src/plugins/trivia/core/configParsers/*` (validator + wiring), `src/plugins/trivia/core/types.ts` (`TriviaQuestion.hint`), `src/plugins/trivia/domain/hint.ts` (new resolver + threshold helper), `src/plugins/trivia/tools/questions/getIdeas.ts` (payload), `src/plugins/trivia/tools/questions/saveQuestion.ts` (validation + persistence), `src/plugins/trivia/tools/questions/postQuestions.ts` (Block Kit rendering), `src/plugins/trivia/answerTypes/hintButton.ts` (new ephemeral-message handler), `src/plugins/trivia/tools/games/listGames.ts` (surface per-game value), `src/plugins/trivia/prompts/scheduledPrompts.ts` (hint drafting + self-review step).
- **Tests**: parser unit tests; resolver unit tests (each cascade tier + threshold truth table); `get_ideas` tests (threshold suppression); `save_question` tests (validation + persistence); `post_questions` snapshot tests (button-row layout + inline-block placement + no-hint baseline); `hintButton` handler tests (ephemeral posted, `clickedBy` deduped, graceful fallback, repeat-click behavior).
- **Data files**: none new. Hint records inline in existing `questions.json`.
- **Migrations**: none required (additive optional field; absence = pre-change behavior).
- **i18n strings**: new keys in EN + FR for the button label (`trivia.question.hintButton`), inline prefix (`trivia.question.hintInlineLabel`), ephemeral prefix (`trivia.question.hintEphemeralLabel`), and missing-hint fallback (`trivia.question.hintMissing`).
- **Docs / instructions**: `data/default_configuration/admin/topics/trivia:management/*.md` (cascade documentation), `CLAUDE.md` (trivia section reference to the new axis).
