## Why

The trivia reveal leaderboard leads with cumulative season standings, burying what just happened in the round players actually care about. The season finale is a thin "MVP + wrap-up" line bolted above the same daily table, so there's no real ceremony. And the leaderboard table contract is duplicated across two specs that have already drifted apart on a basic rule (medals are "top-3" in one spec, "top-4" in the other, and the live code follows top-4). This change re-centers the reveal on the current round, gives the season finale a purpose-built layout, and unifies the leaderboard rules into one shared definition.

## What Changes

- **"This Round" leads every seasons-enabled reveal.** The `This Round` row moves to the top of the leaderboard table and is shown on every seasons-enabled reveal (single- and multi-question), not just multi-question batches. It drops only when per-player data is unavailable (`roundSummary` absent).
- **Columns are sorted by This Round.** The whole table's column order is driven by This Round score (descending; em-dash/absent players last). A player owns one column across all rows — the column order is decided once and every row follows it; rows are never sorted independently. **BREAKING (visible):** the leftmost column is now the round leader, not the season/all-time leader.
- **Unified medal rule (dense rank).** Medals rank by *distinct value* — every player sharing the top value gets 🥇, the next distinct value 🥈, then 🥉, then 🎀 (4th distinct value). Ties share. `0`/em-dash/absent cells never get a medal. This replaces both specs' divergent rules with one definition applied to every medaled row/list.
- **Configurable `allTimeRow` axis.** New `allTimeRow: "always" | "never" | "end-of-season-only"` on `TriviaGame` and the workspace tier (cascade `game → workspace → "end-of-season-only"`). Governs the All-Time surface everywhere: the All Time row on normal reveals and the All-Time table at the finale. **BREAKING (default behavior):** the default `"end-of-season-only"` means existing seasons-enabled games stop showing All Time on normal daily reveals — it now surfaces only on the season's last fire.
- **Single-season relabel.** When only one season has had activity (`hasPriorSeasons === false`), the anchor row renders as a labeled `Current Season` row (replacing the old unlabeled 2-row), since with one season "All Time" *is* the current season.
- **Redesigned season finale.** On `isLastFireOfSeason`, the reveal renders a dedicated layout: per-question verdicts → a vertical **Season Winners** podium (top-3 distinct current-season values, medaled, ties share a place) → a one-line **participation tail** listing the rest (4th place wears 🎀) → a medaled **All-Time table** (gated on `hasPriorSeasons` AND `allTimeRow ≠ "never"`; skipped at the first season's end) → a "see you next season" closer. This replaces the old single finale section.
- **"Nobody got it" detail.** When a question's `correct` bucket is empty (no winners), the verdict swaps name-listing for an expanded "here's the full story" explanation of the answer.

## Capabilities

### New Capabilities
<!-- None — all changes modify existing trivia capabilities. -->

### Modified Capabilities
- `trivia-scheduled-prompts`: This Round row gating (drop `reveals.length > 1`), column-order-once + sort-by-This-Round, unified dense-rank medal rule, and the empty-`correct` "nobody got it" verdict branch in the reveal prompt.
- `trivia-seasons`: redesigned season-finale layout (podium + participation tail + gated All-Time table), the additive normal-reveal row model with single-season `Current Season` relabel, the `allTimeRow` rendering gate, and the unified medal rule.
- `trivia-games`: the `allTimeRow` config field on game + workspace tiers, its validation/cascade, and its surfacing through `upsert_game`, `set_workspace_config`, and `list_games`.

## Impact

- **Prompts:** `src/plugins/trivia/prompts/scheduledPrompts.ts` (reveal table + finale + verdict rules) — the bulk of the change.
- **Config:** `src/plugins/trivia/core/configTypes.ts` (new type + fields), `core/configParsers/axes.ts` (zod + validator), `core/configBridge.ts` + `core/configParsers/games.ts` (parse at each tier), new `domain/allTimeRow.ts` (resolver + `shouldShowAllTimeRow` helper).
- **Reveal flow:** `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` + `reveal/types.ts` (resolve `allTimeRow`, add `showAllTimeRow` to `ProcessRevealResult`).
- **Management tools:** `tools/games/setWorkspaceConfig.ts`, `tools/games/upsertGame.ts`, `tools/games/listGames.ts`.
- **Tests:** `scheduledPrompts.test.ts`, `processRevealAnswers.test.ts`, new `allTimeRow.test.ts`, config-parser tests.
- **No data migration:** the new config field is optional and back-compatible; the default change is a behavioral default, not a stored-data change.
- **No i18n:** all affected strings are on the VIA-Claude path (prompt + tool payload), so they stay English.
