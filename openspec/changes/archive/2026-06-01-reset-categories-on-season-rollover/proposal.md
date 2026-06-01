## Why

When a season ends with no future season queued, `applySeasonRollover` auto-creates a continuation season that **deep-copies the closing season's `categories`**. For a *themed* season (e.g. "Marine Biology" for May), this silently re-bakes the themed pool into June, July, and every month after — a one-month deviation becomes a permanent default until a human notices and intervenes. The category cascade (`season → game → global`) is effectively dead for auto-continued seasons.

The fix encodes a clean principle already true on the manual path: **human-authored config is explicit; machine-generated config inherits.** A continuation the *machine* creates should drop the season-level themed pool and let categories resolve through the cascade, while preserving the *structural* fields (format, axis weights) that define how the game runs.

## What Changes

- **BREAKING (behavioral):** Auto-continuation seasons no longer inherit the closing season's **season-level `categories`**. The continuation omits the field entirely, so its pool resolves via the cascade (`game.categories → global categories.json`).
- Auto-continuation **continues** to deep-copy the structural fields: `answersFormat`, `questionType`, `contexts`, and `format` (including each slot's own `format.questions[i].categories`, which is treated as structural design, not a theme).
- No change to the **manual** `upsert_season` path — it is already cascade-by-default (omit `categories` → field absent → inherit).
- Doc/instruction sync: `triviaCheckInstruction.ts` (the management instruction) currently *promises* season-level `categories` deep-copy as the "repeat" semantic; update it to describe the reset-to-cascade behavior.
- Drive-by hard-rule fix: `rollover.ts` imports `../../../../logger.js` directly (Plugin Hard Rule #1 violation); route through the plugin's logger instead.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-reveal-processor`: the "Season rollover happens inside the tool" requirement changes — the continuation no longer inherits season-level `categories`; it resets that field to cascade-inheritance while still inheriting `answersFormat`, `questionType`, `contexts`, and `format` (with slot-level categories preserved).

## Impact

- **Code:** `src/plugins/trivia/tools/reveal/rollover.ts` (`applySeasonRollover` — drop the season-level `categories` copy; keep slot-level copy inside `format`; fix logger import). Tests in `src/plugins/trivia/tools/reveal/` covering rollover continuation.
- **Prompts:** `src/plugins/trivia/prompts/triviaCheckInstruction.ts` (rollover paragraph around the auto-continuation description).
- **Behavior:** deployments with active *themed* seasons will see next month's auto-continuation revert to the game/global baseline pool unless a future season is explicitly staged (the existing escape hatch). Structural setup (format, difficulty/answer weights) is unaffected.
- **No data migration:** existing on-disk season entries are untouched; the change only affects how *future* continuations are constructed.
