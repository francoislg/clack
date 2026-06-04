## Why

Admins running multi-question (season-format) games want the per-question reveal narrative (the WHY explanation, the "nobody cracked it" teaching, fun-fact color) pushed *into each question's card* rather than living only in a standalone summary message. This adds an `includeRevealInQuestions` axis controlling whether each revealed card carries that narrative. It is orthogonal to `finalRevealSummary` (a sibling change controlling the standalone summary message) — together the two subsume what was originally drafted as a single `revealType` axis.

Depends on `refactor-trivia-reveal-tools` having shipped — Claude-authored Block Kit can only land in the card edit now that the card edit is its own file-state-driven step (`update_answers_block`).

## What Changes

- **New `includeRevealInQuestions: "yes" | "no"` axis**, cascading **game → workspace → default** (mirrors `allTimeRow`; NOT a per-question season/slot axis). Default `"no"` = today's behavior (cards carry only the deterministic facts footer; narrative lives in the summary). Resolved **fresh at reveal time** inside `compute_answers`, which returns the resolved value in its payload.
- **New `update_question(game, questionId, revealBlocks)` MCP tool** (admin tier) — persists Claude-authored reveal **commentary** blocks onto the question record in `questions.json`. Pure JSON write, no Slack, idempotent (overwrite). It SHALL reject `revealBlocks` when the resolved `includeRevealInQuestions` is `"no"`.
- **New optional `revealBlocks?: KnownBlock[]` field on `TriviaQuestion`** — the persisted authored commentary. Absent when the axis is `"no"` and for all legacy rows.
- **`update_answers_block` (from the refactor) gains an append branch:** it always renders the deterministic results footer (Answer / Correct / Incorrect, from `answers.json`); when the question record carries `revealBlocks`, it **appends** them below the footer. Facts stay deterministic/replayable; `revealBlocks` is purely the authored narrative layer.
- **`find_previous_questions` exposes `revealBlocks`** on opt-in targeted lookups (specific `questionIds` or an `includeRevealBlocks` flag), only for already-revealed questions — NOT in the default list shape and never for live questions — so a re-emit/repair flow can reuse authored content without regenerating it.
- **Reveal prompt authors per-card narrative when the axis is `"yes"`:** for each revealed question, call `update_question` with the per-card narrative before `update_answers_block` projects the cards. When `"no"`, the prompt does not author card narrative (today's flow).
- **`includeRevealInQuestions` is settable** on a game via `upsert_game` and on the workspace via `set_workspace_config` (omit-to-keep / null-to-clear), and surfaced by `list_games`. NOT settable per-season/slot.

## Capabilities

### New Capabilities
- `trivia-reveal-in-cards`: the `includeRevealInQuestions` axis (game+workspace resolver + default), the `update_question` persist tool, the `revealBlocks` question-record field, and the card append contract.

### Modified Capabilities
- `trivia-reveal-processor`: `compute_answers` resolves `includeRevealInQuestions` (game→workspace→default) at reveal time and returns it in the payload.
- `trivia-card-projection`: `update_answers_block` appends a question's stored `revealBlocks` below the deterministic results footer when present.
- `trivia-scheduled-prompts`: the reveal prompt authors per-card narrative via `update_question` when the axis is `"yes"`; the reveal job's `requiredTools` gains `update_question`.
- `trivia-question-search`: `find_previous_questions` exposes `revealBlocks` on opt-in targeted lookups, revealed-questions-only.
- `trivia-games`: `TriviaGame` + workspace accept `includeRevealInQuestions`; `upsert_game` / `set_workspace_config` set it; `list_games` surfaces it (mirrors `allTimeRow`).

## Impact

- **Code:** `core/configTypes.ts` (type, default, fields), `core/configParsers/axes.ts` + `games.ts` + `configBridge.ts` (parse/validate, mirror `allTimeRow`), new `domain/includeRevealInQuestions.ts` resolver, `tools/reveal/computeAnswers.ts` (return the axis), `tools/reveal/updateAnswersBlock.ts` + `revealCards/` (append branch), new `tools/questions/updateQuestion.ts`, `find_previous_questions` (expose field), `prompts/scheduledPrompts.ts` (author-card branch + `requiredTools`), management tools (`upsert_game` / `set_workspace_config` / `list_games`).
- **Data:** new optional `revealBlocks?` on `TriviaQuestion`; new optional `includeRevealInQuestions?` on game + workspace. All absent → today. No migration.
- **Tests:** resolver cascade, parser/validator, `update_question` persist + `"no"` guard, append branch, `find_previous_questions` opt-in field, reveal-prompt branch inspection, management round-trip.
- **Zero-config safety:** unset everywhere → `"no"` → cards behave exactly as after the refactor.
