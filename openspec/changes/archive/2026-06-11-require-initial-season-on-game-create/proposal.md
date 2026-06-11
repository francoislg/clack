## Why

When `trivia.seasons.enabled` is true, the only way a new game's first season comes into being today is the **lazy auto-seed** in `loadSeasonsState`: the first tool that touches a game's missing `seasons.json` silently writes a machine-derived starter season (`slug = season-YYYY-MM`, end-of-UTC-month dates). Admins get a season they never named, with dates they didn't choose, materialized as a side effect of an unrelated read. The intent of a season — a deliberately-named, deliberately-dated chapter — is lost at the exact moment it's created.

## What Changes

- **`upsert_game` CREATE branch** gains a `initialSeason` argument that is **REQUIRED when `seasons.enabled` is true** and **rejected when seasons are disabled**. The game and its first season are written in one atomic call, so there is never a window where a seasons-enabled game exists without a current season.
- `initialSeason` is a **minimal timeline bootstrap only**: `slug` (required), `expectedEndAt` (required), `startedAt` (optional, defaults to now). It carries no categories / theme / format / axis fields — those come from the game/workspace cascade and are tuned afterward in place via `upsert_season`.
- The **lazy auto-seed is demoted from primary path to safety net**: it remains, unchanged in mechanics, so games created by hand-editing `config.json` (or pre-existing games with no `seasons.json`) still get a season and no consumer ever hits a null-season state. It is no longer the documented way a Clack-created game acquires its first season.
- The management instruction for `upsert_game` documents the new required field and the "bootstrap now, enrich with `upsert_season` later" flow.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-games`: `upsert_game` CREATE requires a minimal `initialSeason` (`slug`, `expectedEndAt`, optional `startedAt`) when seasons are enabled, and rejects it when disabled.
- `trivia-seasons`: the lazy per-game `seasons.json` bootstrap is reframed as a fallback safety net rather than the primary creation path; the primary path is the explicit `initialSeason` supplied at game creation.

## Impact

- **Code**: `src/plugins/trivia/tools/games/upsertGame.ts` (CREATE branch — new arg, validation, atomic season write), `src/plugins/trivia/core/dataLayer.ts` (auto-seed stays as fallback), the `upsert_game` Zod schema, and the management instruction copy.
- **Behavior**: New games created via `upsert_game` with seasons on now MUST name their first season; the tool errors without it. Seasons-disabled CREATE rejects `initialSeason`. Games created by editing `config.json` directly are unaffected (fallback covers them).
- **No migration**: existing `seasons.json` files and existing games are untouched; the fallback preserves their behavior verbatim.
- **Gate**: keyed off the workspace-level `seasons.enabled` flag — there is no per-game seasons flag today.
