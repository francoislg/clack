## 1. Types and parser

- [x] 1.1 Add `format?: SeasonFormat`, `categories?: string[]`, `theme?: string` to `TriviaGame` in `src/plugins/trivia/core/configTypes.ts` with doc comments mirroring the season-tier fields and naming the cascade. (Also moved `SeasonFormat` / `SeasonFormatSlot` definitions from `core/types.ts` to `core/configTypes.ts` so `TriviaGame.format: SeasonFormat` resolves cleanly; consumer imports updated.)
- [x] 1.2 Extend `parseTriviaGames` in `src/plugins/trivia/core/configParsers/*` to validate the three new fields, delegating `format` to `validateFormat`, dedupe-and-trim `categories`, trim-and-non-empty `theme`. Lenient drop-the-field policy (matches axis-bag); also moved `validateFormat` to `core/configParsers/format.ts` so the parser doesn't import from `domain/`.
- [x] 1.3 Add parser unit tests in the trivia parsers test file covering: valid `format`, invalid `format` (empty `questions[]`), valid `categories`, empty `categories`, duplicate `categories` (dedupe assertion), valid `theme`, whitespace-only `theme`.

## 2. Cascade resolvers

- [x] 2.1 Add a `resolveEffectiveFormat(game, season)` helper that returns `season.format ?? game.format ?? null`. Add unit tests for the three branches. (`domain/format.ts` + `format.test.ts`)
- [x] 2.2 Add a `resolveActiveCategories(slot, season, game, globalCategories)` helper implementing `slot.categories → season.categories → game.categories → globalCategories`. Add unit tests for each tier-resolves branch. (`domain/categories.ts` + `categories.test.ts`)
- [x] 2.3 Add a `resolveTheme(season, game)` helper returning `season.theme ?? game.theme ?? null`. Add unit tests. (`domain/theme.ts` + `theme.test.ts`)
- [x] 2.4 Verify these helpers do NOT live behind any feature flag — they're additive resolvers. (Pure functions, no flag gating.)

## 3. Tool integrations

- [x] 3.1 Update `get_ideas` (`src/plugins/trivia/tools/questions/getIdeas.ts`) so the effective format / categories computation calls the new resolvers (passing the looked-up game record). Update tests to cover game-only and season-wins-over-game cases.
- [x] 3.2 Update `save_question` (`src/plugins/trivia/tools/questions/saveQuestion.ts`) to recognize a game-only format (no active season format), enter slot-binding mode, and produce the renamed `"no active format"` error instead of `"season has no format"`. Update tests.
- [x] 3.3 Update `save_question`'s category validation path to call `resolveActiveCategories` and add the relevant test cases (game wins over `categories.json` when no season is active).
- [x] 3.4 Update `list_games` (`src/plugins/trivia/tools/games/listGames.ts`) to emit `format`, `categories`, `theme` per-game entry IF AND ONLY IF set on the game. Update tests and the tool description text.

## 4. Prompt builder

- [x] 4.1 Update opener/finale references in `src/plugins/trivia/prompts/scheduledPrompts.ts` to read theme via `resolveTheme(season, game)`. (Theme is surfaced via `get_ideas`'s payload only — the prompt instructions read whatever Theme value the tool returns, which now uses `resolveTheme`. Tests for game-tier theme resolution added in `getIdeas.format.test.ts`; reveal flow does not use theme.)
- [x] 4.2 Audit any other prompt sites that mention "season categories" or the slot count — confirm they read through the helpers or otherwise tolerate the new game-tier source. (One reference; categories surface via `get_ideas`'s `format.slots[i].categories` and `categories.ideas`, both now using `resolveActiveCategories`.)

## 5. Instruction file updates

- [x] 5.1 Update `data/default_configuration/admin/topics/trivia:management/*.md` cascade documentation to mention `format`, `categories`, `theme` at the game tier and clarify the season-wins-over-game ordering. (Updated the virtual instruction source in `prompts/triviaCheckInstruction.ts` — the on-disk fallback path is built from this content.)
- [x] 5.2 Update `list_seasons` tool description (registration call site) to add a one-line pointer at `list_games` for the game tier of these three axes.
- [x] 5.3 Update CLAUDE.md project-level "trivia question generation: four-axis composition" section to mention the three new game-tier fields and the existing cascade.

## 6. Validation

- [x] 6.1 Run `npm test` and confirm new and existing trivia tests pass. (4359/4359 pass.)
- [x] 6.2 Run `npx tsc` to confirm clean type-check. (Exit 0.)
- [x] 6.3 Run `npx oxlint src/plugins/trivia` and `npx oxfmt --check src/plugins/trivia` and confirm clean. (0 warnings, 0 errors; all files formatted.)
- [x] 6.4 Run `openspec validate add-trivia-game-tier-overrides --strict` and confirm clean. (Valid.)
- [ ] 6.5 Manual smoke (optional): set a game's `format` in a local `config.json`, restart the bot, confirm `list_games` shows it and that the next question-cron fire posts the expected slot count. — User-facing manual verification; deferred.
