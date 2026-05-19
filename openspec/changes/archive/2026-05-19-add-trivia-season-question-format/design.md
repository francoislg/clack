## Context

The trivia plugin's per-season config today is shallow: a season carries one `categories: string[]` pool and an optional `questionTypes: { boolean?, choice? }` weighting. Every question-cron fire posts a single question rolled from those uniform season-level settings. The cron expression controls cadence; nothing controls composition.

The follow-up tool `post_questions({ items: [...] })` (delivered by `add-trivia-post-questions-tool`) is already shaped for N items per call, so the delivery path can carry multi-question fires without further surgery. The missing piece is a way for seasons to _express_ a multi-slot composition and for `get_ideas` / `save_question` to route generation per slot.

The user goal is creative latitude: "3 general-knowledge true/false + 2 historical choice" as a fixed daily structure. Each slot needs a `label` (creative hint for Claude), can narrow `categories`, and can narrow `questionTypes`. Missing fields cascade down to season defaults, then to global config.

This change also adjusts auto-rollover (the season-end behavior inside `process_reveal_answers` when no future season is queued): today the new starter resets `categories` to the global baseline. After this change, auto-continuation = "repeat" — inherit `categories`, `questionTypes`, and `format` from the closing season. Staged future seasons are unaffected (admin intent overrides inheritance).

## Goals / Non-Goals

**Goals:**

- Let an admin define an ordered list of question "slots" per season, each with optional `label` / `categories` / `questionTypes` overrides.
- Keep the config object small and atomic — full-format replace via `upsert_season(format)`, not granular per-slot tools.
- Keep cron specs stable when the format changes — `buildGameSpecs` does NOT peek into seasons state.
- Keep `get_ideas`'s per-call freshness (each call rolls its own `suggestedAnswer` / `suggestedDifficulty`) — no pre-roll for all slots up front.
- Preserve identical behavior for seasons without a format (single-question flow byte-identical to today).
- Make auto-continuation feel like a "repeat" instead of a reset — inheriting all season-level config from the closing season.

**Non-Goals:**

- No granular per-slot management tools (`upsert_slot`, `remove_slot`, `reorder_slots`). Format is replaced atomically.
- No per-slot ordering rules beyond array order (no "shuffle slot order each fire", no "random pick N from M template slots").
- No per-slot scoring (slots contribute to the same season leaderboard; reveal rendering is unchanged).
- No slot-scoped duplicate detection in `find_previous_questions` (stays game-scoped).
- No retro slot stamping of pre-existing question records.
- No change to `expectedEndAt` derivation on auto-continuation (stays end-of-current-UTC-month).
- No change to the staged-future-season path — when a future season is on the timeline, it takes over with its own (possibly empty) config; inheritance does not apply.

## Decisions

### Decision 1: Format lives inside the season entry (not a separate file)

`format` is a field on the season entry in `games/<game>/seasons.json`. Rationale:

- Format is per-season, not per-game: two seasons in the same game can have different formats.
- Co-locating with `categories` and `questionTypes` keeps the season config in one atomic write.
- No additional file to lazy-seed, migrate, or reconcile.

**Alternatives considered:**

- Separate `games/<game>/formats.json` keyed by season slug. Rejected — adds an indirection for no gain, doubles the read at posting time, complicates atomicity.
- A top-level `format` on `config.trivia.games[<game>]`. Rejected — couples format to game config (which is admin-facing static config), prevents seasons from carrying different formats over time.

### Decision 2: `upsert_season(format?)` handles all format mutations

Single tool, both CREATE and UPDATE. Omit-to-keep semantics on UPDATE; explicit `null` clears the field. Format is replaced wholesale — no granular add/update/remove slot tools.

Rationale:

- Format is "set-up-once" config; per-slot edits are rare. Whole-format replace is small (typically <10 slots) and easy to reason about.
- Matches the existing `questionTypes` mutation pattern on `upsert_season` (omit-to-keep, `null` clears).
- Removes the design complexity around slot ordering / indices for granular ops (insert-at-N, move-from-to-X, etc.).

**Alternatives considered:**

- Granular `upsert_slot(index?)` + `remove_slot(index)` + `reorder_slots(order)`. Rejected on user input — format is a "set-up-once" config and granular tools add tool count without proportional value.
- A dedicated `set_season_format(game, target, format)` tool separate from `upsert_season`. Rejected — `upsert_season` is already the season-config write path; adding a second entry point is fragmentation.

### Decision 3: `get_ideas(game, slot?: number = 0)` with stable `format` meta on every call

`get_ideas` accepts an optional `slot` argument (default `0`) and returns:

```
{
  format: { slotCount: number, slots: [{ index, label, categories }] } | null,
  suggestion: {
    slot: number,
    categoryIdeas: string[],
    suggestedAnswer: boolean,
    suggestedDifficulty: ...,
    questionTypeRoll: "boolean" | "choice",
    // choice-specific fields per trivia-choice-questions when questionTypeRoll === "choice"
  }
}
```

The `format` meta is present iff the active season has a `format`; it is byte-stable across calls in the same season (changes only when admins mutate the format via `upsert_season`). Claude reads `format.slotCount` on the first call to discover the loop bound; subsequent calls (`slot: 1`, `slot: 2`, ...) re-roll fresh suggestions per slot.

Rationale:

- Per-call rolling preserves today's natural rhythm — each `suggestedAnswer` is a fresh coin flip in response to whatever Claude just did.
- Pre-rolling all suggestions in a bulk return locks in polarity sequence before any writing happens, which is a worse failure mode (a dup wall in slot 3 wastes the slot 4–5 rolls).
- The meta header costs almost nothing and lets Claude discover structure without a separate `describe_format` tool.
- `slot: 0` as the default makes the no-format and single-question paths byte-identical to today's call signature.

**Alternatives considered:**

- Bulk return of all slot suggestions in one call. Rejected — pre-rolls suggestedAnswer for slots Claude hasn't written yet, locking polarity sequence; also forces Claude to hold N suggestions in working memory.
- Separate `describe_format(game)` tool for meta + unchanged `get_ideas` per slot. Rejected — extra round trip on every fire when one cheap meta field on the existing tool does the job.

### Decision 4: One prompt that branches on `get_ideas`'s `format` field

`SEND_QUESTIONS_INSTRUCTIONS` becomes a payload-driven loop. The prompt says (paraphrased):

> Call `get_ideas(game)`. If `format` is null, follow the single-question flow (today's steps). If `format` is present, loop from slot 0 to slot `format.slotCount - 1`: for each slot, call `get_ideas(game, slot: i)`, use the slot's `label` as creative framing, write/validate the question, then `save_question(game, slot: { index: i, label }, ...)`. After all slots are saved, call `post_questions({ game, items: [...] })` with one item per slot in order.

`buildGameSpecs` SHALL NOT peek into `seasons.json` to choose between two prompt constants.

Rationale:

- Cron-spec reconcile decoupled from seasons state — format changes are picked up on the next fire without re-running `sdk.reconcileCronJobs`.
- Single prompt constant is easier to maintain than two near-duplicates.
- The branching is structurally trivial in the prompt (one conditional at the top, one loop or one direct flow).

**Alternatives considered:**

- Two prompt constants (`SEND_QUESTIONS_INSTRUCTIONS` and `SEND_QUESTIONS_FORMATTED_INSTRUCTIONS`) selected by `buildGameSpecs`. Rejected — requires `buildGameSpecs` to read seasons.json, which couples cron spec generation to seasons state and creates a stale-prompt risk window between format edits and cron reconciliation.

### Decision 5: Auto-continuation inheritance change

When `process_reveal_answers` runs season-end rollover AND no future season is queued for the game, the new continuation season SHALL inherit `categories`, `questionTypes`, AND `format` from the closing season (deep copies). Today's spec resets `categories` to the global baseline; this is a behavioral change.

Rationale:

- Without inheritance, admins who set up a format lose it on every monthly rollover and must re-`upsert_season` after every reveal. That defeats the purpose of "set-up-once" config.
- The "reset to baseline" rule was sensible when `categories` was the only non-baseline field on a season; with `questionTypes` and now `format`, "reset everything" creates a hostile UX.
- Staged future seasons are unaffected — admin intent (explicitly creating a future season) overrides inheritance.

`expectedEndAt` continues to derive from "end of current UTC month" — not inherited from the closing season's duration. Rationale: the deterministic monthly cadence is the seasons feature's load-bearing default; "true repeat" of duration would surprise admins whose closing season had an irregular end date.

**Alternatives considered:**

- Inherit only `format`, not `categories` / `questionTypes`. Rejected — inconsistent (mixing reset behavior across season-level fields is harder to reason about than "all inherit or none").
- Add an `inheritOnRollover: boolean` field to the season. Rejected — over-engineered; the "stage a future season with different config" escape hatch already exists for the rare case where admins want to break the inheritance chain.

### Decision 6: `save_question`'s slot binding is strict

When the active season has a `format`, `save_question` SHALL require a `slot: { index, label }` argument. Index MUST match a slot in `format.questions[]`. The slot's `questionTypes` MUST permit the question's type (e.g., a `{choice: 1, boolean: 0}` slot rejects a boolean save).

When the active season has no `format`, `save_question` SHALL reject any `slot` argument as "format-not-defined" error.

Rationale:

- Catches Claude misbehavior loudly (wrong slot index, type/slot mismatch).
- Snapshots `label` at write time alongside `index` so the record's meaning survives format edits (parallels how `season` is denormalized).

**Alternatives considered:**

- Infer slot from save order (the Nth save_question call of a session is for slot N). Rejected — fragile under retries, hides slot intent from the record, makes ordering bugs silent.

### Decision 7: Round summary lives in the tool payload, prompt branches on `reveals.length`

A multi-slot question fire produces a multi-question reveal. Today's prompt was written for length-1; multi-question reveals would either repeat the full verdict-and-voters layout N times (verbose) or get vague (inconsistent).

The chosen design:

- `process_reveal_answers` returns `roundSummary: { totalQuestions: N, perPlayer: [{ userId, displayName, correct, answered, roundMvp? }] }`. Always present (length-1 fires get a one-question summary). Counting is deterministic and lives in the tool, matching the rest of the trivia plugin's architecture ("move deterministic work into the tool, leave style to Claude").
- `roundMvp: true` is set on every player tied for the highest `correct` count in this fire. Multiple MVPs possible on ties.
- Players who didn't answer ANY of this fire's questions are omitted from `perPlayer`.
- `PROCESS_REVEAL_INSTRUCTIONS` branches on `reveals.length`:
  - **Length 1**: today's layout — full verdict, full voter buckets, leaderboard.
  - **Length > 1**: one brief verdict line per question (single-line per question, no full voter blocks), then a "Round Summary" section listing each player's `correct/totalQuestions` (with 🏆 on round MVPs), then the cumulative leaderboard table.

Rationale:

- The dopamine hit of per-question reveals is preserved for both branches — the multi-question branch just trades verbose voter blocks for brief verdicts to keep the message scannable.
- Claude does no counting — only rendering. Counting bugs are impossible by construction.
- The `roundSummary` field is present even for length-1 reveals so the schema stays consistent; the renderer's branching is on `reveals.length`, not on the presence of the field.

**Alternatives considered:**

- Claude tallies per-player counts from `reveals[].voters.correct` inside the prompt. Rejected — Claude-side counting is error-prone, and we've consistently moved deterministic work into the tool throughout this codebase.
- Round-only layout (no per-question verdicts when length > 1). Rejected — loses the per-question payoff for players who wanted to see if THEIR vote was right.
- Always render the round summary (even for length 1). Rejected — for a single question, the verdict section IS the per-question summary; an extra "round summary" block of "1/1" is noise.

### Decision 8: No data migration

Existing seasons have no `format` (single-question behavior preserved). Existing question records have no `slot`. The behavioral change to auto-continuation inheritance applies only to _newly created_ continuation seasons going forward. Pre-existing seasons created without inheritance remain as-is.

Rationale: every observable post-change behavior is gated on `format` being present on a season; absence is equivalent to today's flat config. No data needs rewriting. The new `roundSummary` field is computed at tool-call time from existing data — no migration required.

## Risks / Trade-offs

- **[Risk] Inheritance change surprises admins relying on the reset-to-baseline rule** → Mitigation: call out prominently in the proposal's "What Changes" as a behavioral change; document in the `trivia-check` instruction text under the auto-rollover section so admins see it when planning a season. The escape hatch (stage a future season explicitly) is documented.

- **[Risk] Claude misuses slot binding (wrong index, type mismatch, missing slot)** → Mitigation: strict validation in `save_question` returns structured errors. The prompt walks through the loop pattern with an example.

- **[Risk] Loop blows up if `format.slotCount` is large (e.g., 20 slots)** → Mitigation: format has no hard cap in the schema, but the run budget (Claude's context window + tool turn count) caps it implicitly. Document a soft recommendation of ≤10 slots in the `trivia-check` instruction text.

- **[Risk] `get_ideas`'s `format` meta drifts from the underlying season** → Mitigation: meta is re-read from `seasons.json` on every call (no caching), so admin edits via `upsert_season` are visible by the next fire.

- **[Trade-off] No reorder/insert tools means moving slots around requires sending the whole format** → Acceptable: format is small (typically <10 slots), edits are rare, and a single tool surface is simpler than four.

- **[Trade-off] One prompt for both single-question and N-slot flows is slightly more complex than two specialized prompts** → Acceptable: cron spec stability and seasons-state decoupling outweigh the prompt-text complexity.

- **[Risk] Auto-continuation inherits `categories` from a closing season that had a tightly themed pool (e.g., "Marine Biology")** → The continuation season repeats that theme indefinitely until an admin stages a different season. This is the intended "repeat" semantic but admins should be aware. Mitigation: document in the `trivia-check` instruction.

## Migration Plan

This change has no data migration. Deployment:

1. Land the schema additions (Season type gains `format`, QuestionRecord gains `slot`) — backward-compatible (both optional).
2. Land the `upsert_season` `format` argument — no caller is affected today.
3. Land the `get_ideas` `slot` argument and `format` meta return — no caller is affected today; `slot` defaults to `0` and `format` is `null` when seasons lack a format.
4. Land the `save_question` slot validation — strict rejection only fires when an active season has a format, which no season has yet at deploy time.
5. Land the `SEND_QUESTIONS_INSTRUCTIONS` rewrite — the loop is gated on `get_ideas` returning a non-null `format`; existing prompts work identically when format is null.
6. Land the auto-continuation inheritance change in `process_reveal_answers` — the change applies on the next season-end rollover after deploy.

Rollback: revert in reverse order. Any seasons that had a `format` set via `upsert_season` during the rollout window retain their `format` field in `seasons.json`, but with the old code, that field is ignored (no harm). Question records with `slot` stamps retain those stamps with the old code (no reader consumes them).

## Open Questions

- Should the `trivia-check` instruction explicitly document the auto-continuation inheritance change so admins notice the behavior shift on first rollover after deploy? (Lean: yes — adds two lines under the "seasons rollover" section.)
- Should there be a soft cap on `format.questions[].length` in the schema (e.g., 10) to prevent runaway loops, or rely on operational discipline? (Lean: no hard cap — let admins decide; surface a soft warning in `list_seasons` if `slotCount > 10`.)
