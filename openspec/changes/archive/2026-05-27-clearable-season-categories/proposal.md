## Why

Today a season's `categories` field is mandatory and effectively frozen: `upsert_season` ignores `categories` on UPDATE, `remove_categories` refuses to empty a season's pool, and CREATE always materializes a concrete array (either the provided list or a snapshot of the global `categories.json`). That defeats the three-tier cascade documented in `src/plugins/trivia/domain/categories.ts` (`slot → season → game → globalCategories`) — admins cannot make the current season "inherit" from its game, nor can they default new seasons to the game's pool.

## What Changes

- Make `SeasonEntry.categories` an **optional** field on disk (omitted ⇒ cascade falls through to game, then global). The resolver in `domain/categories.ts` already supports this — the upstream tools just never let you get there.
- **CREATE default**: when `upsert_season` is called without a `categories` arg (or with `[]`), the new season SHALL be written with `categories` **absent** instead of being seeded from `categories.json`. Themed creates (explicit non-empty `categories` arg) continue to write that list verbatim.
- **UPDATE accepts `null`**: `upsert_season` SHALL accept `categories: null` on UPDATE to clear the field, dropping the season back into the cascade (game → global). Omitting `categories` on UPDATE still preserves the existing value (omit-to-keep semantics, consistent with every other axis).
- **remove_categories** can now empty a season's pool: when a remove operation would bring `categories.length` to 0 for a specific season or for the current season, the tool SHALL **delete the `categories` field** from that entry rather than rejecting the call. The pool then resolves via cascade. The lazy-seed starter season (in `trivia-seasons` Requirement: lazy seeding) also SHALL omit `categories`.
- Update `get_ideas`, `save_question`, and the `format` slot resolver to read from the **resolved** category pool (`slot → season → game → global`) rather than assuming `season.categories` is always present.
- **BREAKING (data shape only, no migration required)**: existing seasons keep their concrete `categories` arrays — the field becoming optional is purely additive. Reading code MUST treat the field as `string[] | undefined`. Migration 022 (one-shot) SHALL detect newly-created seasons whose `categories` equals the current `categories.json` byte-for-byte and rewrite them to omit the field, so existing "non-themed" seasons start participating in the cascade automatically. **This is opt-in via config flag** (`trivia.seasons.migrateNonThemed`, default `false`) to avoid surprising admins who treat the snapshot as intentional.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-seasons`: `SeasonEntry.categories` becomes optional; lazy-seed starter omits `categories`; `upsert_season` CREATE default switches from "snapshot global" to "omit"; UPDATE accepts explicit `null` to clear; remove-to-empty rewrites to omitted instead of erroring.
- `trivia-categories`: `remove_categories` semantics for current-season and slug-targeted removals change — emptying clears the field rather than erroring. `get_ideas` and `save_question` read from the resolved cascade (`slot → season → game → global`) rather than `season.categories` directly.

## Impact

- Code: `src/plugins/trivia/core/types.ts` (`SeasonEntry.categories` optional), `src/plugins/trivia/tools/seasons/upsertSeason.ts` (CREATE default + UPDATE `null` clear), `src/plugins/trivia/tools/categories/removeCategories.ts` (empty-clears-field), `src/plugins/trivia/core/seedCategories.ts` or wherever lazy season seeding lives, `src/plugins/trivia/core/configParsers/format.ts` (schema/parser), `src/plugins/trivia/domain/categories.ts` is already correct.
- Tools that read seasons (`list_seasons`, `get_ideas`, `save_question`, format-slot resolver): treat `season.categories` as `string[] | undefined`. The resolver in `domain/categories.ts` already handles this — verify each call site funnels through it.
- Tests: `upsertSeason.regression.test.ts` (new CREATE default), `removeCategories` tests (empty-clears), `categories.test.ts` (resolver coverage of "season has no categories" path), integration tests for the get_ideas + save_question pair under "season inheriting from game".
- Migration: optional `022-omit-seeded-season-categories` keyed off the new `trivia.seasons.migrateNonThemed` config flag.
- Docs: `openspec/specs/trivia-seasons/spec.md` (Requirement: SeasonEntry shape, lazy seeding, upsert_season CREATE/UPDATE/return shape), `openspec/specs/trivia-categories/spec.md` (Requirement: Remove categories tool, save_question validation, get_ideas pool resolution), tool descriptions, the trivia management instruction block.
- No Slack-facing UX changes. No new MCP tools.
