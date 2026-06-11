## Context

Seasons are per-game timelines persisted in `data/plugins/trivia/games/<name>/seasons.json`. Today the only way a new game's first season is born (when `seasons.enabled` is `true`) is the lazy auto-seed in `loadSeasonsState` (`src/plugins/trivia/core/dataLayer.ts:129-148`): the first tool to read a missing `seasons.json` writes a machine-derived starter (`slug = season-YYYY-MM`, end-of-UTC-month dates) as a side effect of a read.

Games are created two ways: via the `upsert_game` MCP tool (CREATE branch — `tools/games/upsertGame.ts`) or by hand-editing `config.trivia.games[]`. The auto-seed is the catch-all that currently covers both, plus pre-migration games. Consumers already tolerate a null current season (`findCurrentSeason` returns `null` in a gap or when state is null), but a seasons-enabled game running with no season is a degraded state: records get no season tag, then once a season is created those early records sit in a gap.

The `seasons.enabled` gate is workspace-level only — there is no per-game seasons flag.

## Goals / Non-Goals

**Goals:**
- A game created via `upsert_game` with seasons on names its first season deliberately (slug + dates), atomically with the game.
- No window in which a seasons-enabled, `upsert_game`-created game exists without a current season.
- Keep `initialSeason` minimal — a timeline bootstrap, not a second copy of `upsert_season`'s schema.
- Zero behavior change for existing games, hand-edited-config games, and seasons-disabled deployments.

**Non-Goals:**
- A per-game seasons flag (stays workspace-level).
- Migrating or renaming existing auto-seeded `season-YYYY-MM` entries.
- Moving categories/theme/format/axis configuration into `upsert_game` — those remain `upsert_season`'s job.

## Decisions

**1. `initialSeason` is a required arg on the CREATE branch only, gated by `seasons.enabled`.**
Required when seasons on + CREATE; rejected when seasons off; rejected on UPDATE (directs caller to `upsert_season`). This is the type-level enforcement the instruction-only alternative lacked — a soft "Claude should follow up with `upsert_season`" leaves a live window where the cron fires season-less. Atomic write closes that window.

**2. Minimal shape: `slug` + `expectedEndAt` required, `startedAt` optional (defaults to now).**
These are exactly the three timeline fields the auto-seed sets. Everything else (categories, theme, format, axes) cascades from game/workspace and is tuned in place afterward via `upsert_season`, which we confirmed already supports mid-season edits. Rationale: avoid schema duplication and keep a single source of truth for season enrichment. Alternative considered — full season shape on `upsert_game` — rejected: duplicates `upsert_season`, two code paths to keep in sync.

**3. Lazy auto-seed is kept, demoted to a fallback.**
Left mechanically unchanged in `loadSeasonsState`. It now only fires for games that acquire a `seasons.json` by a route other than `upsert_game` (hand-edited config, pre-existing games). Rationale: this is what guarantees no consumer ever hits the degraded null-season state for those games — belt and suspenders. Alternative considered — remove the auto-seed entirely and make every consumer handle null — rejected: larger blast radius across ~15 consumers and a real regression risk for config-edited games, for no user benefit.

**4. The written `initialSeason` entry carries only `slug`/`startedAt`/`expectedEndAt`.**
No `categories` copy (unlike the auto-seed, which copies `categories.json`). The explicit season inherits its pool from the cascade, matching the "sparse season write" philosophy already in the seasons spec.

## Risks / Trade-offs

- **[Two creation paths now diverge: explicit entry has no `categories`, auto-seed copies `categories.json`.]** → Intentional and aligned with the sparse-write philosophy; documented in both specs. Both still resolve a usable pool via the cascade.
- **[Existing tests/instructions assume `upsert_game` CREATE needs no season.]** → Update the management instruction and CREATE-branch tests in the same change; the Zod schema makes the requirement explicit so failures are loud, not silent.
- **[An admin who wants a game with seasons off, then on later.]** → Unaffected: with seasons off, `initialSeason` is rejected and no timeline is written; enabling seasons later triggers the fallback auto-seed on first use, exactly as today.

## Migration Plan

No data migration. Existing `seasons.json` files and games are untouched. The change is additive at the tool boundary (new required arg under a gate) plus a doc/instruction update. Rollback is reverting the `upsert_game` schema/handler change; the fallback auto-seed already covers any game created in the interim.

## Open Questions

None.
