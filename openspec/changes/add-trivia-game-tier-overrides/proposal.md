## Why

Several trivia config axes already cascade through a per-game tier (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`), but three season-level axes still have no per-game equivalent: `format` (slot composition), `categories` (pool), and `theme` (narrative). Today this forces every game in a workspace to share the same slot composition and category pool whenever a season is active — even though games already live in different channels with different audiences. Closing the gap aligns these three axes with the cascade pattern the other six already follow.

## What Changes

- Add an optional per-game `format: SeasonFormat` field on `TriviaGame`. Resolution becomes `slot → season → game → (single-question fallback)`, matching the existing weighted-axis cascade ordering.
- Add an optional per-game `categories: string[]` field on `TriviaGame`. Resolution becomes `slot → season → game → global categories.json`.
- Add an optional per-game `theme: string` field on `TriviaGame`. Resolution becomes `season → game → (no theme)`.
- Extend `parseTriviaGames` to validate and normalize all three fields with the same rules already used at the season tier (delegating to the existing `validateFormat`, deduped non-empty category list, non-empty trimmed string for theme).
- Surface the three fields in `list_games` per-game entries (alongside the existing config audit data).
- Update `get_ideas`, `save_question`, slot resolution helpers, and the season-finale / opener prompt builders to consult the per-game tier between season and global tiers.
- Update the trivia plugin's instruction files where they document the cascade (so Claude reasons correctly about precedence) and update the `list_seasons` tool description to point at `list_games` for the game tier.
- **Not a breaking change**: every existing config (game with no `format` / `categories` / `theme`) behaves identically to today. The new fields are pure opt-ins.

## Capabilities

### New Capabilities

(none — all changes layer onto existing trivia capabilities)

### Modified Capabilities

- `trivia-games`: add three game-tier override fields (`format`, `categories`, `theme`) with validation rules, cascade placement, and `list_games` surface area.
- `trivia-seasons`: refine the cascade documentation on `save_question` slot binding and `Per-season question format` to insert the game tier between season and workspace.
- `trivia-categories`: refine `save_question validates category` so the resolution path consults the per-game tier before the global pool.

## Impact

- **Code**: `src/plugins/trivia/core/configTypes.ts` (type), `src/plugins/trivia/core/configParsers/*` (parser), `src/plugins/trivia/domain/seasonFormat.ts` (slot resolution may stay; cascade-resolver helpers add a game-tier consult), `src/plugins/trivia/tools/games/listGames.ts` (response shape), `src/plugins/trivia/tools/questions/getIdeas.ts` and `saveQuestion.ts` (cascade calls), `src/plugins/trivia/prompts/scheduledPrompts.ts` (opener + finale references to `theme`).
- **Tests**: parser tests for the new fields; cascade tests across the new tier; `list_games` snapshot; opener/finale prompt assertions when `theme` resolves from the game tier.
- **Data files**: none — the new fields live in `config.json` only.
- **Migrations**: none required (additive optional fields).
- **Docs / instructions**: `data/default_configuration/admin/topics/trivia:management/*.md` (where the cascade is taught) need to mention the new tier; `CLAUDE.md` cascade-doc lines mention the new fields' tiers.
