## Context

`applySeasonRollover` (`src/plugins/trivia/tools/reveal/rollover.ts`) runs inline inside `process_reveal_answers` on a season's last reveal fire. When no future season is queued (`findNextSeason` returns `null`), it appends a continuation season for next month, deep-copying a fixed set of fields from the closing season's snapshot:

```
rollover.ts:99-129  continuation =
  { slug, startedAt, expectedEndAt,
    ...categories      (deep copy)   ← REMOVE
    ...answersFormat   (deep copy)   ← keep
    ...questionType    (deep copy)   ← keep
    ...contexts        (deep copy)   ← keep
    ...format          (deep copy, incl. slot.categories)  ← keep (slot categories preserved)
  }
```

The manual path (`upsert_season`) is already cascade-by-default: omitting `categories` writes no field, and the resolver (`domain/categories.ts`) falls through `slot → season → game → global`. The auto path diverges by baking the closing season's pool forward, which is the only place the bug lives.

## Goals / Non-Goals

**Goals:**
- Auto-continuation drops **season-level** `categories`, letting it resolve via the cascade.
- Auto-continuation still inherits structural fields (`answersFormat`, `questionType`, `contexts`, `format`).
- **Slot-level** `format.questions[i].categories` is preserved (it is part of the format's structural design, not the season's theme).
- Keep the existing escape hatch intact: a staged future season (entry with `startedAt > now`) still suppresses auto-continuation entirely.
- Sync the management instruction text to the new behavior.

**Non-Goals:**
- Changing the manual `upsert_season` semantics (already correct).
- Reconciling the separate, pre-existing drift in the `upsert_season` spec requirement that still says "omit → copy baseline" (out of scope; flagged for a later change).
- Any data migration of existing on-disk season entries.

## Decisions

**1. Drop only the season-level `categories` block; leave the rest of the copy intact.**
The single substantive code change is removing the `...(closingSnapshot.categories ...)` spread (rollover.ts:99-101). The `format` copy — including its inner `slot.categories` spread (rollover.ts:116) — stays exactly as-is. Result: the continuation has no top-level `categories` key, so `resolveActiveCategoriesWithSource` skips the season tier and resolves `game.categories → global`.

**2. Slot categories are structural, season categories are thematic.**
A slot's `categories` ("slot 3 is always Science") encodes how the game is composed; it survives rollover with the rest of `format`. The season-level pool encodes the month's theme; it resets. This asymmetry is intentional and is the crux of the behavioral contract.

**3. Safe fallback is guaranteed.**
Dropping `categories` can never yield an empty pool: the cascade terminates at the global `categories.json`, which is the always-present baseline (and the seed for the lazy starter season). No empty-pool guard is needed.

**4. Fix the logger import in the same change.**
`rollover.ts:1` imports `../../../../logger.js` — a Plugin Hard Rule #1 violation (no imports outside the plugin folder). Since the file is already being edited, route logging through the plugin-appropriate logger. If `applySeasonRollover` has no `sdk` in scope, thread the logger from the caller (`processRevealAnswers.ts`) or accept it as a parameter rather than reaching into `src/`.

## Risks / Trade-offs

- **Observable behavior change for themed-season deployments.** A workspace currently relying on a themed season auto-repeating will see next month revert to baseline. This is the intended correction, but it is a silent change for anyone who liked the old behavior — mitigated by the documented escape hatch (stage a future themed season explicitly before the last fire). Call it out in the proposal's Impact so it is not a surprise.
- **Spec/instruction drift if only code changes.** The management instruction and the reveal-processor spec both currently assert the deep-copy "repeat" semantic. All three (code, spec delta, instruction) must move together or the docs lie. Tasks enforce updating each.
- **Logger threading.** If the logger is currently a direct import for convenience, threading it through may touch the caller signature; keep that mechanical and covered by the existing rollover tests.
