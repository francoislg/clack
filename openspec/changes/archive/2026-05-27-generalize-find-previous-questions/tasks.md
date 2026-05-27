## 1. Schema and filter rewrite

- [x] 1.1 Update Zod schema in `src/plugins/trivia/tools/questions/findPreviousQuestions.ts`: rename `game` → `games` (optional `string[]`), `category` → `categories` (optional `string[]`), `season` → `seasons` (optional `string[]`), `text` → `keywords` (optional `string[]`). Add `match: z.enum(["any", "all"]).optional()` defaulting to `"all"`. Keep `recentBatchFromNow` and `limit` unchanged.
- [x] 1.2 Update the tool description to document the new array criteria, the `match` combinator, the OR-internal semantics, and the cross-game default. Make `recentBatchFromNow`'s "exactly one game" requirement explicit.
- [x] 1.3 Replace the `requireGame(...)` single-name validation with a per-entry validator that walks `games` (when supplied) and rejects the first unknown entry with a structured error citing the offending name. When `games` is omitted or empty, skip per-name validation and prepare to read every game in `config.trivia.games[]`.
- [x] 1.4 Replace the single `data.forGame(args.game)` + `loadQuestions()` call with a loop over the in-scope games that loads each game's questions and tags each row with its source `game: string` for the duration of the filter pipeline.
- [x] 1.5 Rewrite the filter pipeline to evaluate each supplied criterion (games already applied at load time, categories, seasons, keywords) as a boolean per row, then combine via `match: "all"` (every supplied criterion is true) or `match: "any"` (at least one supplied criterion is true). Treat omitted-or-empty arrays as "not supplied" so they do not participate in the combinator.
- [x] 1.6 Implement `seasons` resolution: lowercase entries are slugs; the literal `"current"` resolves per-game via `findCurrentSeason(seasonsState, Date.now())` against each game's `seasons.json`. When `trivia.seasons.enabled` is `false`, silently drop the `seasons` criterion. When `findCurrentSeason` returns `null` for a game, `"current"` contributes no match for rows in that game.
- [x] 1.7 Add `matchedKeywords` computation: for each surviving row when `keywords` is non-empty, compute the subset of input keywords whose lowercased form is a substring of the row's lowercased `statement`, preserving input order. Skip the field when `keywords` was omitted/empty.
- [x] 1.8 Add `recentBatchFromNow` validation: when present, require `games.length === 1`. Otherwise return a validation error. The existing batch grouping logic stays the same except that it now operates on the (cross-criterion-filtered) pool and only ever sees rows from one game.
- [x] 1.9 Update the per-row projection (`toSearchResult` or its successor) so every returned row carries `game: string` and (when applicable) `matchedKeywords: string[]`. Preserve the existing answer-key exclusion behavior verbatim — `isTrue`, `correctIndex`, `expectedAnswer`, `acceptableAnswers`, `gradingNotes` must remain stripped from the response.

## 2. Test rewrite

- [x] 2.1 Rewrite `src/plugins/trivia/tools/questions/findPreviousQuestions.test.ts` to use the new schema. Delete the old `game: "main", text: "..."`-style scenarios; add the new scenarios from the spec delta. Cover: cross-game scan (omitted `games`), single-game scoping, multi-game scoping, unknown-game rejection, disabled-game inclusion (cross-game scan + frozen archive), `keywords` OR-internal, `matchedKeywords` content + ordering, `matchedKeywords` absence when `keywords` not supplied, default `match: "all"`, `match: "any"` union semantics, `match: "all"` with single criterion equivalent to `"any"`, no-criteria-returns-everything, empty arrays equal omitted arrays.
- [x] 2.2 Add seasons-array tests: `seasons: ["current"]` resolves per game when multiple games are in scope; `seasons: ["current"]` during a gap returns empty for that game; multi-slug OR; `seasons` ignored when `trivia.seasons.enabled` is `false`.
- [x] 2.3 Add `recentBatchFromNow` tests: rejected when no `games`, rejected when multi-game; happy path with `games: ["main"]` returns the most recent batch; ranking by recency anchored to now; legacy unbatched rows excluded; filters compose before grouping; filters can eliminate a batch from the ranking; out-of-range N returns empty; zero/negative N rejected. Every batch test must include a final assertion that returned rows carry `game: "main"`.
- [x] 2.4 Verify the answer-key exclusion across all three formats (boolean / choice / freeform), confirming the new `game` and `matchedKeywords` fields appear alongside the existing safety-preserved fields.

## 3. Prompt updates

- [x] 3.1 Update `src/plugins/trivia/prompts/scheduledPrompts.ts` step 4 in the fact-boolean flow (around line 89): replace "Call find_previous_questions to search for similar statements" with the new wording — `find_previous_questions({ keywords: [3-5 distinctive terms], match: "any" })`, omit `games`, instruct Claude to inspect `matchedKeywords` per row and to re-call with sharper keywords when the result set is uninformatively wide.
- [x] 3.2 Apply the same update to step 4 of the fact-choice flow (around line 162), the topical-boolean flow (around line 227), the topical-choice flow (around line 350), and both freeform flows (fact-freeform and topical-freeform).
- [x] 3.3 Update the cross-cutting carve-out at line 460 of `scheduledPrompts.ts` — remove the "Duplicate detection (find_previous_questions) stays GAME-SCOPED..." sentence entirely. The cross-game default is now stated explicitly at each callsite.
- [x] 3.4 Update `src/plugins/trivia/prompts/scheduledPrompts.test.ts` and any related test files to assert the new phrasing: prompt mentions `keywords: [...]`, prompt mentions `match: "any"`, prompt does NOT pass `games` for duplicate detection (still passes `game: "{game}"` for `get_ideas`, `save_question`, `post_questions`), prompt does NOT contain "GAME-SCOPED" wording.

## 4. Integration and end-to-end verification

- [x] 4.1 Run `npm run build` and confirm the TypeScript compiles without `any` or unsafe casts in `findPreviousQuestions.ts`.
- [x] 4.2 Run `npm test` and confirm all rewritten unit tests pass.
- [x] 4.3 Run `npx oxlint src/plugins/trivia/tools/questions/findPreviousQuestions.ts src/plugins/trivia/prompts/scheduledPrompts.ts` to confirm lint passes on touched files.
- [x] 4.4 Run `npx oxfmt --check src/plugins/trivia/tools/questions/findPreviousQuestions.ts src/plugins/trivia/prompts/scheduledPrompts.ts` to confirm formatting passes. If it fails, run `npx oxfmt` on the flagged files and re-check.
- [x] 4.5 Run `openspec validate generalize-find-previous-questions --strict` to confirm spec-delta integrity.

## 5. Sanity sweep

- [x] 5.1 Grep the repo for any remaining references to the old `find_previous_questions` arg names (`text:`, single-game `game:` arg patterns in the prompts or tests, the "all" / "current" season sentinel usage that depended on the old singular shape). Remove or update each match.
- [x] 5.2 Confirm `topicInstructions.ts`, `triviaCheckInstruction.ts`, and any other prompt-adjacent constant that mentions `find_previous_questions` is consistent with the new schema.
- [x] 5.3 Confirm any documentation in `data/default_configuration/` that references `find_previous_questions` is consistent with the new schema.
