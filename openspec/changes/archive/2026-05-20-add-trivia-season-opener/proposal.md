## Why

When a trivia season rolls over, the closing reveal of the old season already gets a wrap-up section, MVP callout, and finale leaderboard treatment — but the new season opens completely silently. The first question post of the new season looks identical to a mid-season post, so players miss the moment the slate resets. Worse, seasons today have no human-readable "theme" anywhere in their persisted shape, so even an admin who built the season around a narrative (Halloween, 1990s pop culture, Music Mayhem) has no place to record that label.

## What Changes

- Add an optional `theme?: string` field to `SeasonEntry` for the human-readable narrative label.
- Extend the `upsert_season` tool to accept `theme` (omit-to-keep on UPDATE; `null` to clear).
- Extend the `get_ideas` tool's output with `firstFireOfSeason: boolean` (computed at call time as: zero saved questions exist with `season === currentSlug` for the active game) and `theme?: string` (mirrored from the active season when set, omitted otherwise).
- Add a "new season opener" branch to the question-posting prompt (`SEND_QUESTIONS_INSTRUCTIONS`): when `firstFireOfSeason` is `true`, the message SHALL prepend a `header` block plus one `section` block above the question content — the section names the season slug and (only when `theme` is set) mentions the theme. When `theme` is absent, the section MUST NOT mention a theme.
- No change to the reveal flow — closer / MVP / finale / rollover semantics are untouched.

## Capabilities

### New Capabilities

(None — this change extends existing trivia capabilities only.)

### Modified Capabilities

- `trivia-seasons`: `SeasonEntry` gains optional `theme` field; `upsert_season` accepts and persists `theme`; continuation seasons created by `applySeasonRollover` leave `theme` undefined.
- `trivia-categories`: `get_ideas` output gains `firstFireOfSeason` and optional `theme`; values are derived at call time from the active season and the game's stored questions.
- `trivia-scheduled-prompts`: question-posting prompt flow grows a first-fire opener branch keyed on `firstFireOfSeason`.

## Impact

- **Affected code**: `src/plugins/trivia/core/types.ts` (SeasonEntry schema), `src/plugins/trivia/tools/seasons/upsertSeason.ts` (theme parameter handling), `src/plugins/trivia/tools/categories/getIdeas.ts` or equivalent (output shape), `src/plugins/trivia/prompts/scheduledPrompts.ts` (`SEND_QUESTIONS_INSTRUCTIONS` opener branch), and the associated test files.
- **Affected data**: `data/plugins/trivia/games/<name>/seasons.json` entries gain optional `theme` field — backwards compatible (absent on existing records).
- **No new dependencies, no new tools, no new MCP catalog entries.**
- **No data migration required**: the new field is optional and absent on every existing record by definition.
- **Backwards compatibility**: seasons without a `theme` render the opener with no theme line, exactly as if the field never existed for that season. Plugins / configs that do not enable seasons see no change.
