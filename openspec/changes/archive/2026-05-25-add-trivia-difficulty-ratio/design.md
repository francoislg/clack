## Context

Difficulty in trivia is currently controlled by two coupled mechanisms:

1. **`pickSuggestedDifficulty()`** in `src/plugins/trivia/tools/questions/getIdeas.ts:24-29` — a hardcoded 30%/60%/10% Easy/Medium/Hard roll with no config surface.
2. **`DifficultyRanges`** in `src/plugins/trivia/core/configTypes.ts` — `{ easy: [min, max], medium: [...], hard: [...], minimumThreshold: number }` cascaded per format (boolean / choice / freeform) across config → game → season → slot via per-field merge in `resolveDifficultyRanges`.

`minimumThreshold` is a separate reject-below floor independent of the rolled bucket's range. In practice this creates two overlapping accept-zones: the bucket's target range (where Claude is told to aim) and the threshold (where Claude is told to actually reject). The split is confusing and lets a "Medium" question rated 10/10 pass — even though the bucket says `medium: [7, 8]`.

Four other axes in the same plugin (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`) all use the same weighted-map pattern: `Record<key, number>` weight maps, validated with non-negative integers, resolved with whole-object replacement across the cascade, rolled with `weightedPick`. Difficulty is the odd one out.

## Goals / Non-Goals

**Goals:**
- Make the easy/medium/hard distribution configurable per workspace / game / season / slot, mirroring the existing weighted-axis pattern exactly.
- Per-format keying (boolean / choice / freeform) so admins can express "freeform games skew easier" alongside the existing per-format `difficulty` ranges.
- Replace the dual "target range + threshold" model with a single strict-membership model: the rolled bucket's `[min, max]` IS the accept bound.
- Soften the rejection penalty with a bounded one-shot reframe so small misses don't waste a full regeneration.
- Preserve today's effective behavior (30/60/10) as the built-in default so absent config = current behavior.

**Non-Goals:**
- Backwards compatibility with on-disk `minimumThreshold` — the field is dropped from the schema; existing configs must be hand-edited (acknowledged in proposal; single deployment).
- No migration code. No grace period. No deprecation warning.
- Not introducing a fifth difficulty bucket or changing the 1–10 scale.
- Not making the bucket *count* configurable — easy/medium/hard remain the three fixed buckets.
- Not changing how `difficulty` (the ranges) cascades — its per-field merge stays unchanged; only `difficultyRatio` is new and uses whole-object replace.

## Decisions

### 1. New axis shape: per-format, three-bucket weight map

```typescript
type DifficultyBucketWeights = Record<"easy" | "medium" | "hard", number>;
type TriviaDifficultyRatioConfig = Partial<
  Record<"boolean" | "choice" | "freeform", DifficultyBucketWeights>
>;

const DEFAULT_DIFFICULTY_RATIO: Record<
  "boolean" | "choice" | "freeform",
  DifficultyBucketWeights
> = {
  boolean: { easy: 3, medium: 6, hard: 1 },   // current effective 30/60/10
  choice:  { easy: 3, medium: 6, hard: 1 },   // current effective 30/60/10
  freeform: { easy: 5, medium: 4, hard: 1 },  // skewed easier — freeform is intrinsically harder
};
```

The freeform default mirrors the same reasoning that motivated `DEFAULT_DIFFICULTY_RANGES` to shift freeform ranges down by 2: typing an answer is intrinsically harder than picking from a list, so both the *ranges* (the meaning of each bucket) and the *ratio* (the bucket-roll distribution) lean easier for freeform.

`difficultyRatio` lives alongside `difficulty` on `TriviaConfig`, `TriviaGame`, `SeasonEntry`, and the slot type (`FormatQuestion`). Per-format keying matches `difficulty`'s shape exactly so admins reason about both fields in the same way.

**Alternative considered:** flat (not per-format) `difficultyRatio: { easy, medium, hard }`. Rejected because admins who run mixed-format games may want freeform skewed easier than boolean/choice (the same reasoning that motivated per-format `difficulty` ranges in the first place). Per-format costs nothing — it falls back through the cascade like any other field.

### 2. Whole-object replace per cascade tier (not per-field merge)

`resolveDifficultyRatio(season, slot, game, config, format)` returns the first non-null match in the cascade:

```
slot.difficultyRatio?.[format]
  ?? season.difficultyRatio?.[format]
  ?? game.difficultyRatio?.[format]
  ?? config.difficultyRatio?.[format]
  ?? DEFAULT_DIFFICULTY_RATIO
```

This matches `resolveAnswersFormat` / `resolveQuestionType` exactly. **Not** the per-field merge used by `resolveDifficultyRanges`.

**Alternative considered:** per-field merge to match the sibling `difficulty` field's cascade behavior. Rejected because `{ easy: 5 }` at the slot tier would mean "set easy weight to 5, inherit medium/hard from above" — but admins reading the config can't tell what medium/hard end up as without tracing the cascade. With whole-object replace, the ratio is atomic: an admin sees `{ easy: 5, medium: 1, hard: 0 }` at the slot tier and knows the full distribution. Trade-off: admins must restate the full triple to change one weight, which is the same trade-off the other 4 weighted axes already accept.

### 3. Difficulty gate behavior: strict membership + one-shot reframe + ≥2-off reject

```
v1 self-rate
  │
  ├─ inside [min, max]    ──→ save
  │
  ├─ exactly ±1 off       ──→ REFRAME ONCE (rewrite to dial difficulty)
  │                            re-rate v2
  │                              ├─ inside ──→ save
  │                              └─ else  ──→ REJECT, re-roll get_ideas
  │
  └─ ≥2 off (above or below) → REJECT, re-roll get_ideas immediately
```

Three rules, no counters, bounded total cost (at most 2 question-writes per `get_ideas` call).

**Boolean-specific addition:** after the reframe, re-run the polarity self-check (step 3). Reframing a TRUE statement easier-by-swapping-a-detail can silently flip its truth value — the existing polarity gate is what catches this and must be re-run on v2.

**Alternative considered:** multi-pass reframe budget (max 2 or 3 passes). Rejected because Claude is unreliable at tracking which pass it's on inside a long prompt, and the one-shot rule encodes the same idea more crisply ("you get exactly one polite retry, then re-roll").

**Alternative considered:** keep the old "reject below threshold, anything above passes" semantics with `difficultyRatio` layered on top. Rejected because the whole point of removing `minimumThreshold` is to make the bucket's range mean what it says. Keeping the threshold would defeat the simplification.

### 4. Default ratios: 30/60/10 for boolean/choice, skewed-easy for freeform

- `boolean` / `choice` default to `{ easy: 3, medium: 6, hard: 1 }` — preserves the current 30%/60%/10% distribution as a no-op default. Admins who don't configure `difficultyRatio` get exactly today's behavior for these formats, just with the new strict-membership gate.
- `freeform` defaults to `{ easy: 5, medium: 4, hard: 1 }` — roughly 50%/40%/10%. Freeform is meaningfully harder than boolean/choice (typing the exact answer vs. picking from 2–4 options), so its default leans toward easier buckets.

The asymmetry is the same reasoning that already shifts `DEFAULT_DIFFICULTY_RANGES.freeform` down by 2 across every bucket. Both axes (ranges + ratio) lean easier for freeform in tandem.

**Alternative considered:** uniform `{ 1, 1, 1 }` for every format. Rejected because it would silently shift every existing deployment toward harder average difficulty — a regression for any admin who relied on the implicit 30/60/10.

**Alternative considered:** identical `{ 3, 6, 1 }` for every format including freeform. Rejected because it ignores the same asymmetry that already exists in the ranges — freeform players already get harder questions per-bucket; making the bucket-roll distribution identical too compounds the difficulty.

### 5. `minimumDifficultyThreshold` removed from the `get_ideas` response

The response field goes away with the underlying mechanism. No empty-default fallback, no deprecated-but-still-emitted field. The two prompt sites that reference it (`scheduledPrompts.ts:104,164,349`) are rewritten as part of the same change so there's no window where the prompt references a missing field.

## Risks / Trade-offs

- **[Increased rejection rate compared to old threshold model]** → Today's `minimumThreshold` accepts anything ≥ N (e.g. `medium: [7, 8]` with `threshold: 4` accepts any rating 4–10). New strict membership for the same bucket rejects 1–6 and 9–10. The one-shot reframe absorbs ±1 misses but anything further triggers a full re-roll. **Mitigation:** the default ratio + default ranges (`medium: [7, 8]`) produce roughly the same number of accepted-on-first-try questions as today because most Medium-rolled questions already self-rated in [7, 8]. If post-deploy data shows excessive re-rolls, the lever is widening the configured bucket ranges, not adding more retries.

- **[Self-rating drift after reframe]** → Claude may re-rate the reframed version more leniently than it deserves ("I made it easier, so it must now be inside the range") even when the actual question barely changed. **Mitigation:** the gate language for the re-rate step explicitly says "rate v2 on the same 1–10 scale, independent of v1's rating." This is best-effort — same risk exists today at the distractor plausibility gate, which handles it with the same prompt pattern.

- **[Polarity flip during boolean reframe]** → Reframing a TRUE statement by swapping a detail (e.g. "Shakespeare" → "Marlowe" to make it harder) can silently invert truth. **Mitigation:** the reframe step for boolean flows ends with a mandatory re-run of the existing polarity self-check.

- **[Topic mismatch persisting through reframe]** → If v1 is rated 3 and target is `hard: [8, 10]`, the topic is wrong, not the framing. We catch this with the ≥2-off → immediate reject rule, which short-circuits reframe entirely for large misses.

- **[Breaking change to on-disk config]** → `minimumThreshold` is dropped from the schema; any existing config file containing it fails validation. **Mitigation:** acknowledged in the proposal; the single live deployment will be hand-edited before deploy. No code-level migration.

- **[Two parallel cascade idioms in the same plugin]** → After this change, `difficulty` (the ranges) uses per-field merge while `difficultyRatio` uses whole-object replace. Slight asymmetry. **Mitigation:** documented in `domain/difficulty.ts` comments. The asymmetry reflects a real difference — ranges have 3 independently meaningful sub-fields, ratios don't.
