## Why

Trivia seasons today are uniform: every question-cron fire posts one question rolled from the season's whole category pool with the season's single `questionTypes` weighting. Admins who want a _themed format_ — "3 general-knowledge true/false followed by 2 historical choice questions" — have no way to express that. The cron schedule controls cadence but not composition.

This change adds an optional **per-season question format**: an ordered list of "slots" where each slot can specialize its `label` (creative context fed to Claude), `categories`, and `questionTypes` weights. Slots inherit from the season's defaults when fields are omitted. When a season ends without a staged successor, the auto-created continuation season inherits the closing season's format (and other season-level config) so admins don't lose their setup on rollover.

## What Changes

- Add an optional `format: { questions: Array<{ label?, categories?, questionTypes? }> }` field to each season entry in `data/plugins/trivia/games/<game>/seasons.json`. When present, the season posts N questions per question-cron fire (one per slot) instead of one. When absent, behavior is identical to today.
- Extend `upsert_season` with a `format` parameter accepted on both CREATE and UPDATE. Omit-to-keep semantics on UPDATE; explicit `null` clears. Full-format replacement (no granular per-slot tools — format is a "set up once" config object).
- Stamp `slot: { index, label }` on every newly-written question record in `games/<game>/questions.json` when the active season has a format. Label is snapshotted at write time (parallels how `season` is already denormalized). When no format, no `slot` field.
- Extend `get_ideas(game, slot?: number = 0)`:
  - Returns a stable `format: { slotCount, slots: [{ index, label, categories }] } | null` meta object so Claude discovers the slot count on the first call.
  - Returns `suggestion` scoped to the requested slot. The `slot` arg defaults to `0`, so existing single-question games and call sites are unaffected.
  - Each call performs a fresh `suggestedAnswer` / `suggestedDifficulty` / `questionTypeRoll` for its slot — pre-rolling all suggestions up front is rejected.
- Rewrite `SEND_QUESTIONS_INSTRUCTIONS` (in `src/plugins/trivia/prompts/scheduledPrompts.ts`) to be **payload-driven**: Claude reads `format.slotCount` from `get_ideas`, loops one slot at a time (`get_ideas(slot: i)` → write → validate → `save_question(slot)`), then calls `post_questions({ items: [...] })` with all N items. When `format` is `null`, the single-question flow is identical to today. `buildGameSpecs` SHALL NOT peek into seasons state — one prompt branches on payload shape.
- **BREAKING** (behavioral, not config): The auto-continuation season created at season's last-fire reveal (when no staged future season exists) SHALL inherit `categories`, `questionTypes`, AND `format` from the closing season. Today's spec resets `categories` to the global baseline; this change reframes auto-continuation as a "repeat" semantic so admins don't lose setup. Staged future seasons continue to take over unchanged.
- `save_question` SHALL require a `slot` argument when the active season has a format (validated against the format's slot indices); MUST reject `slot` when the active season has no format. Slot's `questionTypes` invariants are enforced (e.g., a `{choice: 1, boolean: 0}` slot rejects a boolean save).
- `find_previous_questions` SHALL remain game-scoped (not slot-scoped) — a question posted in slot 0 yesterday is still a duplicate if it shows up in slot 2 today.
- Extend `process_reveal_answers` to return a `roundSummary: { totalQuestions, perPlayer: [{ userId, displayName, correct, answered, roundMvp? }] }` field that aggregates per-player correctness across the questions revealed in this fire. Deterministic — computed inside the tool from the same `voters` data the tool already produces, so the renderer doesn't tally.
- Rewrite the reveal prompt (`PROCESS_REVEAL_INSTRUCTIONS`) to branch on `reveals.length`:
  - `length === 1`: today's verbose verdict + voter-bucket layout (unchanged).
  - `length > 1`: brief per-question verdict line per question, then a "Round Summary" section listing each player's `correct/totalQuestions` (with a 🏆 marker on round MVPs), then the cumulative leaderboard table (also unchanged).

## Capabilities

### New Capabilities

<!-- None. All changes layer onto existing capabilities. -->

### Modified Capabilities

- `trivia-seasons`: adds optional `format` field to the season schema, extends `upsert_season` with a `format` parameter (CREATE + UPDATE, full-replace), adds `slot` stamping on per-game question records, changes auto-continuation rollover to inherit `categories` / `questionTypes` / `format` from the closing season (replacing today's "reset to baseline" rule for categories on auto-rollover).
- `trivia-categories`: extends `get_ideas` to accept an optional `slot` argument and return a stable `format` meta object + per-slot `suggestion`. Per-call rolling of `suggestedAnswer` / `suggestedDifficulty` is preserved (no pre-roll across slots).
- `trivia-scheduled-prompts`: rewrites `SEND_QUESTIONS_INSTRUCTIONS` to a payload-driven loop that handles 1..N slots based on `get_ideas`'s `format` field; rewrites `PROCESS_REVEAL_INSTRUCTIONS` to branch on `reveals.length` (single-question layout unchanged; multi-question layout renders a per-fire round summary); `buildGameSpecs` does not peek into seasons state.
- `trivia-choice-questions`: `questionsTypes` resolution priority gains a slot-level override (slot.questionTypes → season.questionTypes → config default).
- `trivia-reveal-processor`: extends the `ProcessRevealResult` payload with a `roundSummary` field (per-fire per-player correctness aggregate); the field is always present (also for length-1 reveals, where it just describes the one question).

## Impact

- **Edited**: `openspec/specs/trivia-seasons/spec.md` (schema, upsert tool, rollover, slot stamping).
- **Edited**: `openspec/specs/trivia-categories/spec.md` (`get_ideas` signature and return shape).
- **Edited**: `openspec/specs/trivia-scheduled-prompts/spec.md` (`SEND_QUESTIONS_INSTRUCTIONS` step flow).
- **Edited**: `openspec/specs/trivia-choice-questions/spec.md` (resolution priority).
- **Edited**: `src/plugins/trivia/tools/seasons/upsertSeason.ts` (accept `format` arg).
- **Edited**: `src/plugins/trivia/tools/categories/getIdeas.ts` (accept `slot` arg, return `format` meta).
- **Edited**: `src/plugins/trivia/tools/questions/saveQuestion.ts` (require/reject `slot` arg, validate against format).
- **Edited**: `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` (auto-continuation inheritance).
- **Edited**: `src/plugins/trivia/prompts/scheduledPrompts.ts` (`SEND_QUESTIONS_INSTRUCTIONS` rewritten as slot loop).
- **Edited**: `src/plugins/trivia/core/types.ts` (Season type gains `format`; QuestionRecord gains `slot`).
- **No data migration**: existing seasons have no `format` (single-question behavior preserved); existing question records have no `slot` (unaffected by reads). The auto-continuation inheritance change applies only to _newly created_ continuation seasons going forward.
- **No breaking config changes**: `data/config.json` shape unchanged. `trivia.seasons.enabled` continues to gate the feature.
- **No breaking SDK changes**: the plugin SDK is unchanged.
- **Cron spec stability**: `buildGameSpecs` output remains independent of seasons state — format changes are picked up at next cron fire without reconciling cron jobs.
