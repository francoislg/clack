## Why

The trivia plugin can only generate questions about static knowledge. There is no way to surface questions about recent events ("Who released an album yesterday?", "Where did that plane crash?"), and no way to bias generation toward a particular lens (a regional flavor like "Quebec", an audience like "pop culture", an angle like "academic"). The existing `type: "boolean" | "choice"` field also conflates two orthogonal concerns — the answer shape (T/F vs. multiple choice) and the source of the question (static knowledge vs. current events) — which blocks the cleanest expression of "make a multiple-choice question about today's news."

## What Changes

- **BREAKING — rename**: `TriviaQuestion.type` → `TriviaQuestion.answersFormat`. The values (`"boolean"` / `"choice"`) are unchanged.
- **BREAKING — rename**: `config.trivia.questionsTypes` → `config.trivia.answersFormat` (same shape: `{ boolean: N, choice: N }`). Same rename on every `SeasonEntry.questionsTypes` → `SeasonEntry.answersFormat` and `SeasonFormatSlot.questionsTypes` → `SeasonFormatSlot.answersFormat`.
- **BREAKING — `get_ideas` response rename**: `suggestedType` → `suggestedAnswersFormat`.
- **New axis — `questionType: { fact: N, topical: N }`** (independent weighted roll). Cascades `slot → season → config → default { fact: 1, topical: 0 }`. Persisted on every new question record as `questionType: "fact" | "topical"`.
- **New axis — `contexts: Array<{ name: string; weight?: number }>`** (optional, cascades the same way). When configured, `get_ideas` returns a freshly-rolled `contextPriority: string[]` — a weighted-random ordering of every configured context — and Claude tries them in order, descending only when the current lens yields no good question. Empty-string contexts are first-class ("no specific lean"). When `contexts` is absent at every cascade level, `contextPriority` is omitted and questions generate without a lens (today's behavior).
- **New topical-path generation flow**: when `get_ideas` rolls `suggestedQuestionType: "topical"`, Claude follows a new branch that requires `WebSearch` to find a recent newsworthy event (within roughly the last day or two, going back up to a week only if nothing recent surfaced), then writes a boolean or choice question anchored on it. Source URL is mandatory and stored on the record.
- **`save_question` accepts new fields**: `questionType` (required, validated against weights), `context` (optional, validated against the active contexts list), `sourceUrl` (required when `questionType: "topical"`, forbidden when `questionType: "fact"`), `eventDate` (optional ISO date for topical).
- **Static migration** renames `type` → `answersFormat` on every question record, renames every config/season/slot `questionsTypes` → `answersFormat`, and stamps `questionType: "fact"` on every existing question record.
- **Topical dedupe**: `find_previous_questions` is unchanged; statement-similarity matching already catches same-event duplicates regardless of freshness window. No new dedupe scoping.
- **Generated question prompt updates**: the scheduled question-posting prompt branches on `suggestedQuestionType` × `suggestedAnswersFormat` (4 paths), each composing existing answer-shape logic with a fact-vs-topical research approach. Contexts are honored across all four paths.

## Capabilities

### New Capabilities

- `trivia-topical-questions`: Topical (current-events) question generation — the WebSearch-driven research flow, `sourceUrl`/`eventDate` storage, and the freshness-judgment rules Claude applies when `questionType: "topical"`.
- `trivia-question-contexts`: The `contexts` configuration axis, cascade resolution, weighted-random priority-list generation, empty-string handling, and the rule that Claude descends the priority list when the current lens yields no good question.

### Modified Capabilities

- `trivia-choice-questions`: Rename `type` → `answersFormat` on the question record and configuration cascade; rename `get_ideas` response field `suggestedType` → `suggestedAnswersFormat`; introduce the orthogonal `questionType` axis alongside `answersFormat` so a question is `{answersFormat, questionType}` not `type` alone.
- `trivia-categories`: `get_ideas` now additionally returns `suggestedQuestionType` (independent roll from active `questionType` weights) and `contextPriority` (when contexts are configured). Categories themselves stay flat `string[]` — no weighting on this axis.
- `trivia-question-posting`: Per-question/per-slot generation now dispatches on `suggestedQuestionType` in addition to `suggestedAnswersFormat`, producing four paths (fact+boolean, fact+choice, topical+boolean, topical+choice). The topical paths require `WebSearch` for recent-event research and source-URL anchoring. Contexts honored across all four.
- `trivia-question-search`: `save_question` validates the new fields (`questionType`, `context`, `sourceUrl`, `eventDate`) and enforces the `questionType ↔ sourceUrl` constraint.
- `trivia-seasons`: `SeasonEntry` and `SeasonFormatSlot` gain optional `questionType` and `contexts` cascade fields alongside the renamed `answersFormat`. `upsert_season` accepts them with the same mid-season-mutation semantics as existing fields.

## Impact

- **Stored data**: `data/plugins/trivia/games/*/questions.json` records are migrated in place (rename `type` → `answersFormat`, stamp `questionType: "fact"`). `data/config.json` is migrated (rename `trivia.questionsTypes` → `trivia.answersFormat`). `data/plugins/trivia/games/*/seasons.json` is migrated for each `SeasonEntry` and any `SeasonFormatSlot` within. The migration is a single blocking boot migration scaffolded via `/create-migration`.
- **Code**: `src/plugins/trivia/core/types.ts`, `src/plugins/trivia/domain/questionTypes.ts` (likely renamed to `answerFormats.ts` or a sibling `questionTypes.ts` housing the fact/topical axis), `src/plugins/trivia/tools/questions/getIdeas.ts`, `src/plugins/trivia/tools/questions/saveQuestion.ts`, `src/plugins/trivia/prompts/scheduledPrompts.ts`, `src/plugins/trivia/tools/seasons/upsertSeason.ts`. New domain modules for context resolution and weighted-random ordering. New migration in `src/migrations/`.
- **External dependencies**: relies on Claude's already-available `WebSearch` tool (no new dependency, no change to `requiredTools` for scheduled runs — `WebSearch` is globally allowed at `src/claude/index.ts:442`).
- **Configuration**: existing `config.json` files break on load until migrated (handled by the boot migration). Documentation needs updating for the new `answersFormat`, `questionType`, and `contexts` fields.
- **Tests**: every existing trivia test that constructs a question record or asserts on `type` / `questionsTypes` field names needs updating. The migration itself needs full test coverage. New tests for context priority-list determinism, topical-path validation, and the four-way prompt dispatch.
- **User-visible behavior**: zero change when no game enables topical or contexts. With topical enabled, question cards look identical (same answersFormat-driven shape); reveals look identical (optional polish: surface `sourceUrl` in the verdict explanation). With contexts enabled, question text picks up a lens flavor.
