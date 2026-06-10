## Context

Trivia's per-fire question count is the length of the format's slot roster. `SeasonFormat` is `{ questions: SeasonFormatSlot[] }`; `resolveEffectiveFormat(season, game)` returns the first present tier's format (`season.format → game.format → null`); and the count `effectiveFormat.questions.length` is read in three places — `get_ideas` (returns `slotCount`, drives the slot loop), the generation prompt (`for i in [0..slotCount-1]`), and `save_question` (validates `slot.index ∈ [0, questions.length)`). A fire always posts every slot.

This makes the count both the *shape* and the *budget*. Games that want a variable count — "2–5 topical questions depending on what's interesting," or "skip the day when there's no good material" — can't express it. The slots already support heterogeneous shapes; the missing primitive is *permission to fill fewer than all of them*.

`format` is deliberately **structural**, not a `CascadeAxes` member (per `trivia-cascade-registry`): it resolves by whole-object replace per tier, never field-merge, and has its own resolver rather than going through `resolveCascade`. Any flexibility knob attached to it inherits that behavior.

## Goals / Non-Goals

**Goals:**
- An optional `flexible: boolean` on `SeasonFormat` that, when `true`, lets a fire post a **prefix** `0..questions.length` of the defined slots, in array order, count chosen by available material.
- Zero questions is a valid outcome (skip the day) with no error and no empty card.
- Default-off: absent `flexible` ⇒ identical to today.
- `flexible` rides the existing `format` cascade (property of the winning format), introducing **no** new cascade axis.
- A zero-question day skips cleanly by **reusing** the existing empty-reveal behavior — no new reveal code.

**Non-Goals:**
- `maxQuestions` (repeating a single template beyond `questions.length`). A flexible game that wants N>roster questions hand-lists N slots for now. Deferred.
- Subject-keyed staged pool. Only needed when slots bind to externally-enumerated entities (e.g. one-per-match) *and* a `prepCron` is added; single-pass flexible games key the pool by slot index as today. Deferred.
- **Anomaly detection for a fixed game that posts zero.** Today *every* zero-question reveal silently skips (`reveals.length === 0`); distinguishing "broken fixed game" from "flexible skip" would be new alerting orthogonal to this feature. Out of scope.
- Predictions. `flexible` composes with the in-flight `prediction` questionType but is specified independently here.
- Non-prefix / per-slot-optional fills (e.g. fill slot 0 and 2 but skip 1). v1 is strict prefix.

## Decisions

### `flexible` is a field on `SeasonFormat`, not a cascade axis
It changes what the format's `questions[]` *means* (full roster vs. capped prefix), so it cannot resolve independently of the format object. Adding it to `CascadeAxes`/`AXIS_REGISTRY` would be wrong — `format` is explicitly excluded from the registry as structural. Living on `SeasonFormat` means it automatically inherits whole-format replace: a `flexible` game format is masked entirely when an active season supplies its own format (flexible or not), exactly like every other field of that format. `resolveEffectiveFormat` needs **no change** — it already returns the winning format whole.
**Alternative considered:** a top-level `TriviaGame.flexible` knob cascading game→workspace. Rejected — it would let `flexible` and `format` resolve from different tiers (a season's fixed format paired with a game's `flexible`), producing an incoherent "flexible over a fixed roster" state. Coupling it to the format object makes the winning tier unambiguous.

### Prefix semantics, chosen by Claude at generation time
When `flexible`, the count is a prefix `[0, questions.length]` filled in order; Claude decides how far to go based on whether each next slot yields a good question. This keeps slot identity stable (slot 0 is always the first defined shape), so the staged-pool "is slot i filled?" check and `save_question` index validation are unchanged. The decision is the model's because "is there good material for slot i" is a generation judgment, not a config fact.
**Alternative considered:** a deterministic count source (config range, fetched list length). Rejected for v1 — it pulls in `maxQuestions` and/or an entity-source contract, both out of scope. Prefix-by-material is the minimal mechanism that satisfies the "2–5 topical" and "skip the day" cases.

### `get_ideas` surfaces `flexible`, slot data unchanged
`get_ideas` already returns `{ slotCount, slots: [...] }` for a formatted game. It additionally returns `flexible: true` when the resolved format is flexible. `slotCount`/`slots` keep their meaning (the ceiling and the per-slot shapes); `flexible` tells the prompt the loop may terminate early and may produce zero. No change to the per-slot roll or the slot definitions.

### Zero-question reveal reuses the existing empty-reveal skip — no new reveal code
The reveal prompt already branches on `reveals.length`: when zero questions are unprocessed it terminates with `submit_response({ skip_response: true })` and posts nothing (a silent skip is the documented preferred behavior). A flexible zero-day produces exactly that state — nothing was posted, so `compute_answers` returns `reveals.length === 0` — and the existing branch handles it with no change. Season-end rollover bookkeeping is independent of the reveal post and still runs.
This deliberately does **not** distinguish a flexible skip from a *fixed* game that erroneously posted zero: today both silently skip, and adding "fixed-game-zero is an anomaly" alerting is a separate concern (generation-failure detection), not part of flexibility.
**Alternative considered:** gate the reveal on the resolved `flexible` and alert on a fixed-game zero. Rejected for scope — it adds alerting orthogonal to this feature and changes behavior for fixed games that this change otherwise leaves untouched.

### Generation prompt gains explicit stop-early + zero guidance
The `Question-posting prompt step flow` gets a flexible branch: "fill slots in order as material justifies; you MAY post fewer than all, down to zero; stop at the first slot with no good question; if you post nothing, terminate cleanly (the day is skipped)." Fixed games keep the unconditional "fill every slot" instruction. This is the only behavioral change Claude sees.

## Risks / Trade-offs

- **Claude posts zero too eagerly (a flexible game goes quiet for days)** → the prompt frames zero as the exception ("only when there is genuinely no good material"), and `flexible` is opt-in per game, so a game that wants reliable output simply stays fixed. Operators can audit via `list_games` (the format, incl. `flexible`, is surfaced).
- **A fixed game that breaks and posts zero is indistinguishable from a flexible skip** → true, but this is *already* the case today (every zero-reveal silently skips); flexibility does not regress it. Anomaly/failure detection is a deliberate non-goal here and can be added later as orthogonal alerting.
- **Season masks a game's flexibility unexpectedly** → documented and intentional (whole-format replace). `list_games` shows the resolved format so the masking is visible; this matches how every other format field already behaves.
- **Prefix rigidity (a thin slot 1 blocks a strong slot 2)** → accepted for v1; the per-slot-optional generalization is a future change. Authors order slots most-reliable-first to mitigate.
- **A flexible game goes quiet for many days** → opt-in per game and surfaced in `list_games`; the prompt frames zero as the genuine-no-material exception, not a default. A game wanting reliable output stays fixed.

## Migration Plan

Purely additive and opt-in. `flexible` is optional on `SeasonFormat`; absent ⇒ `false` ⇒ current behavior byte-for-byte. No data migration — existing `config.json`, season state, and `questions.json` files parse unchanged (the graceful format validator simply gains an optional boolean). Rollback = remove `flexible: true` from the game/season format; the game reverts to fixed-count. No core schema or shared-state changes.

## Open Questions

- Should `list_games` call out `flexible` distinctly (e.g. a "variable count" annotation) or just echo it inside the format object? Leaning: echo inside the format — it's already shown there and an extra annotation is noise.
- A flexible zero-day stays fully silent (reuses the empty-reveal skip — no channel ping). If a product preference later emerges for a quiet "no trivia today" note, that's an additive follow-up, not part of this change.
