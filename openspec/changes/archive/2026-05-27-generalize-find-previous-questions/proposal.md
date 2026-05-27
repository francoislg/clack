## Why

Today's `find_previous_questions` tool requires Claude to dedup a draft question by guessing one "distinctive keyword" and searching one game's questions for a substring match. That single-keyword guess is a single point of failure — synonyms, reformulations, and polarity flips routinely slip past it, and the same fact can be asked across sibling games without anyone noticing. Generalizing the tool to take an array of keywords plus a top-level `match` combinator, and dropping the hard game-scope, gives Claude broad recall in one call and shifts dedup from "search-and-pray" to "scan-and-validate."

## What Changes

- **BREAKING**: `game: string` (required) → `games?: string[]` (optional). Omitting `games` scans every game's `questions.json`. Passing one or more games narrows to that set.
- **BREAKING**: `text: string` → `keywords?: string[]`. Match semantics within `keywords[]` are always OR (any keyword as a case-insensitive substring of `statement`).
- **BREAKING**: `category: string` → `categories?: string[]`. OR within the array.
- **BREAKING**: `season: string` (`"all" | "current" | slug`) → `seasons?: string[]` (each entry a slug or `"current"`). OR within the array. The old `"all"` sentinel is replaced by omitting `seasons` entirely.
- Add a new top-level `match: "any" | "all"` arg (default `"all"`) that combines criteria across the top level. Within any single array criterion, semantics remain OR — `match` only governs cross-criterion combination.
- Add per-row response fields: `game: string` (which game the row came from) and `matchedKeywords?: string[]` (the subset of input `keywords` that hit this row's statement).
- `recentBatchFromNow` SHALL require `games.length === 1` (batchIds aren't unique across games; cross-game batch ranking is incoherent). Validation error otherwise.
- Update every dedup callsite in the question-generation prompts (six paths: fact-boolean, fact-choice, fact-freeform, topical-boolean, topical-choice, topical-freeform) to pass `keywords: [3-5 distinctive terms]`, omit `games`, and pass `match: "any"`. Drop the line-460 "game-scoped" carve-out from the cross-cutting preamble.
- Per-row response still excludes the answer-key fields (`isTrue`, `correctIndex`) per the existing safety requirement — that behavior is preserved.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-question-search`: the `Find previous questions tool` requirement, its scenarios, and the `Find previous questions response excludes the answer key` requirement (the latter is preserved but its scenarios reference the new schema).
- `trivia-scheduled-prompts`: the six question-generation flows' "CHECK FOR DUPLICATES" steps and the line-460 game-scoping carve-out reference the old `text` arg and game-scope; they need to be updated to the new tool shape.

## Impact

- **Code**:
  - `src/plugins/trivia/tools/questions/findPreviousQuestions.ts` — schema change (4 fields renamed to plural arrays, `match` added), filter pipeline rewrite to evaluate criteria and combine via `match`, `matchedKeywords` computation, per-row `game` annotation, `recentBatchFromNow` validation against `games.length`.
  - `src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts` — full rewrite of scenarios for the new schema; add cross-game, `match: "any"`, `matchedKeywords`, and validation tests.
  - `src/plugins/trivia/prompts/scheduledPrompts.ts` — update the five "Call find_previous_questions with a distinctive keyword..." lines (lines 89, 162, 227, 350, and the topical-flow equivalent) and the line-460 game-scoping carve-out.
  - `src/plugins/trivia/prompts/scheduledPrompts.test.ts` — assertion updates for the new prompt phrasing.
- **MCP tool contract**: this is a breaking change to Claude's tool surface. Any external caller still using the old args fails at the Zod boundary. Admin "find me the last batch" use cases continue to work; admins/Claude must now pass `games: ["X"]` instead of `game: "X"`. No data migration — `questions.json` rows are untouched.
- **Specs**: see Modified Capabilities above.
- **Dependencies**: none added.
