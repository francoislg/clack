## Why

When an admin asks Claude what's configured for trivia, Claude calls `list_seasons` or `list_games` and sees only the bare minimum — for seasons: `slug, startedAt, expectedEndAt, endedAt, categories, status`; for games: `name, channel, timezone, enabled`. Every per-tier axis (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `format`, `theme`, plus the workspace-level defaults) is hidden behind the cascade-resolver and surfaces only at `get_ideas` time, one rolled value at a time. Admins cannot audit "is this season's `freeformAnswerShape` set, or is it falling through to workspace defaults?" without reading `data/plugins/trivia/games/<game>/seasons.json` and `data/config.json` by hand.

## What Changes

- **`list_seasons` response (per entry, additive)**: surface `theme`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, and `format` as the raw stored value from the season entry. Each field is present only when that season explicitly set it (so absence vs. explicit-zero remains distinguishable to admins reading the response).
- **`list_games` response (per entry, additive)**: surface the workspace tier of the cascade — `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty` from `config.trivia.*`, plus `questionCron`, `revealCron`, and the workspace-level `offDays` shared across games. Each axis field is present only when the workspace explicitly set it.
- **No explicit "source: workspace" labels on individual axes**. The cascade rule (slot → season → workspace → built-in default) is already documented for Claude via `get_ideas` descriptions. Showing raw values per tier and letting Claude reason about which tier wins keeps the responses lean. A future `resolve_axes(game, slug?, slot?)` tool can be added if "what's effective right now?" becomes a frequent question.
- **`get_ideas` description amended (lightweight clarification)**: a short note pointing Claude at `list_seasons` + `list_games` for cascade audits when admins ask about configuration. No change to the rolled-value contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trivia-seasons`: extend the `list_seasons` response shape requirement to include the additional per-entry fields when explicitly set on the season entry.
- `trivia-games`: extend the `list_games` response shape requirement to include the workspace-level axis defaults and cron expressions per game entry, plus a workspace-level `offDays` summary.

## Impact

- **Affected tools**: `src/plugins/trivia/tools/seasons/listSeasons.ts`, `src/plugins/trivia/tools/games/listGames.ts`. Description text in `src/plugins/trivia/tools/questions/getIdeas.ts` gets one new line pointing at the list tools.
- **Affected types**: none — the season/game in-memory shape already carries every field we surface; we're just exposing more of it through the tool boundary.
- **Token cost**: small per-entry growth on both list responses. The axis maps are tiny objects (5–7 numeric keys); per-season payload grows by maybe 200–400 bytes when all fields are set. Workspace tier on `list_games` is read once and applies across all entries — could be flattened into a single top-level `workspaceDefaults` block instead of repeating per game, to keep `list_games` lean.
- **No persisted-data changes**: all reads, no writes. No migration needed.
- **No breaking changes to existing tool callers**: every added field is optional in the response.
- **Tests**: `listSeasons.test.ts` and `listGames.test.ts` (if it exists; otherwise add) gain cases covering empty / partial / fully-set axes at the season and workspace tiers.
