## Context

The trivia cascade resolves every axis through `seasonSlot → season → gameSlot → game → workspace → default`. `resolveCascade` walks `CASCADE_TIER_ORDER` generically, so every first-wins axis rides the same code path and `AXIS_REGISTRY` is compile-time exhaustive against `CascadeAxes`.

Two of those tiers vary rules by **position** (`seasonSlot`, `gameSlot` — "slot 3 of every round"). None vary rules by **time**. A season is uniform from `startedAt` to `expectedEndAt`.

The season timeline itself is already an interval selector: `findCurrentSeason` picks the season whose `[startedAt, endedAt ?? expectedEndAt)` window contains `now`, with a no-overlap invariant enforced by `upsert_season`. Season phases are the same idea nested one level down — but deliberately *not* the same construct, for reasons in Decisions.

Five call sites build a `CascadeContext`: `get_ideas`, `save_question`, `post_questions`, `compute_answers`, `explain_cascade`. With `prepCron`, generation can precede posting by days, and reveal follows posting by hours — so "which phase is it" has three plausible answers depending on which clock is read.

## Goals / Non-Goals

**Goals:**

- Let a season vary any question-shaping rule over its own duration, so escalation ("gentle → ramp → gauntlet") is expressible once as configuration.
- Reuse the existing generic walker so all 16 `CascadeAxes` members — and every future one — gain phase support with no per-axis work.
- Make phase definitions **reusable across seasons**: an escalation curve written once should be correct for the next season without re-authoring timestamps.
- Keep a posed question's rules immutable after the fact, matching the existing stamping discipline (`points`, `judgeLeniency`, `answeringType`, `tagPlayers`, `liveAnswersVisible`).
- Zero behavior change for any season that declares no phases.

**Non-Goals:**

- **Phase-scoped scoring.** No per-phase leaderboard, MVP, or standings. A phase has no identity in the scoring model.
- **Per-slot escalation curves.** `phase.slotOverrides` and `phase.format` are out; see Decision 5.
- **Game-tier phases.** Deferred; see Decision 6.
- **Interpolated / continuous progressions.** Phases are discrete; see Decision 2.

## Decisions

### 1. A phase is a cascade tier, not a nested season

**Decision:** `seasonPhase` is a new `ConcreteTier`. A phase has no row in any data file of its own, no scoring identity, and no leaderboard scope.

**Why:** The tempting alternative is recursive seasons (`SeasonEntry.children`). It fails on the data model: `season` is stamped on every question, answer, and cheat record and scopes the leaderboard, season MVP, all-time rows, and `teamsStamp`. Making weeks into seasons would fragment one escalating season into four weekly leaderboards — the opposite of the intent.

Naming the distinction settles most downstream questions:

> **A phase is a rules window, not a scoring window.**

Everything scoring-shaped (`teams`, `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring`, `answeringType`, `perfectRoundsAward`, `allTimeRow`) is therefore excluded from `PhaseSlice` by construction, not by taste.

### 2. Duration-chained slices, not date ranges

**Decision:** `phases` is an ordered array. Each slice carries `days`; slice *n* begins where slice *n−1* ended, anchored at `season.startedAt`. The final slice **omits** `days` and runs open-ended to the season's end.

```
 season.startedAt                                        expectedEndAt
        │                                                      │
        ├──── warmup 14d ────┼──── ramp 14d ────┼─── gauntlet ──┤
        │                                       │     (open)    │
        └─ chained by construction ─────────────┘
```

**Alternatives considered:**

| Keying | Rejected because |
|---|---|
| Absolute `{ from, to }` windows | Must be re-authored every season — the curve rots. Needs overlap validation. Leaves an unconfigured tail if a season is extended. |
| Calendar units ("week 1..4") | 4-vs-5-week months force a judgement call the config cannot express. |
| Progress fraction (`0.0–0.33`) | Reusable, but degrades when `expectedEndAt` is nominal, and boundary dates become unintuitive to authors. |
| Round ordinal (nth fire) | Most semantically correct for escalation, but requires a fire counter and breaks under skipped days / catch-up. |
| Interpolated curve on `difficultyRatio` | One field, no tier — but only works for numeric-weight axes (interpolating `judgeLeniency` is meaningless), and a smooth gradient is invisible to players. "Week 3 is The Gauntlet" is better trivia than an unnoticeable ramp, and discrete slices can carry `theme` and `additionalInstructions` for the narrative. |

Chaining wins on three counts: overlap is impossible by construction (no validation needed), `days` is a duration rather than a calendar unit (no 4-vs-5 ambiguity), and the open-ended final slice absorbs a season extension for free.

### 3. Tier placement: below `seasonSlot`, above `season`

**Decision:**

```
  seasonSlot     ◄── pins what must NOT move
  seasonPhase    ◄── NEW: moves everything the slots did not pin
  season
  gameSlot
  game
  workspace
```

**Why not above `seasonSlot`:** because slot-pinning is what makes the deferred phase-slot tier unnecessary for the common case. A 3-slot format escalating over 8 weeks, with the pin expressed at the **season** slot tier (`season.slotOverrides[0]`):

```
  slot        seasonSlot sets      phase (gauntlet) sets all-hard   →  effective
 ────────────────────────────────────────────────────────────────────────────────
  warmup      difficultyRatio easy                                  →  easy   ✓ pinned
  main        —                                                     →  hard   ✓ moved
  stinger     —                                                     →  hard   ✓ moved
```

The slot declares what is fixed; the phase moves the rest. That covers "the warmup stays gentle while everything else escalates" with no extra tier.

**Pinning is a `seasonSlot` capability only.** `seasonPhase` outranks `gameSlot`, so a pin written on the GAME format's slot is overridden by an active phase. That follows the pre-existing rule that `season` already outranks `gameSlot` — the model working as designed, not a new asymmetry — but it has a real ergonomic consequence worth stating plainly: the repo's "game-authoritative writes" guidance puts formats on the game, yet an admin who wants a slot to survive escalation must write a season delta (`season.slotOverrides[i]`) for it. The game format still supplies the question COUNT and the base for every axis no phase touches.

What placement below `seasonSlot` cannot express: *different* escalation curves per slot (warmup easy→medium while stinger hard→brutal). That is Decision 5.

### 4. Resolve at generation, stamp on the record, read the stamp at reveal

**Decision:** `save_question` writes `phase?: string` (the slug) onto the question record. `process_reveal_answers` reconstructs the phase tier by looking the slug up on the season, **never** by re-selecting from `now`. A slug that no longer resolves (renamed or deleted phase) yields no phase tier.

**Why:** the three consumers sit at different moments in time.

```
   prep cron            question cron         reveal cron
       │                    │                      │
   get_ideas ──► save_question ──► post_questions ──► compute_answers
       │                    │                      │
       └──── days apart with prepCron ─────────────┘
                            ▲
              a boundary crossing here would flip `instructions`
              and `additionalInstructions` mid-round
```

This is exactly the pattern already used for `points`, `judgeLeniency`, `answeringType`, `tagPlayers`, and `liveAnswersVisible`: resolve once, stamp, sever from later config edits. Falling back to "no phase tier" on an unresolvable slug follows the graceful-reader philosophy for persisted state — a config edit degrades a question's provenance, it never corrupts it.

**Two consequences found while checking the reveal path:**

1. **The stamped season, not the current one.** `computeAnswers.ts:281` derives its season with `findCurrentSeason(state, now)` and feeds it to `buildCascadeContext` at `:348` and `:589`. Looking a stamped phase slug up on a `now`-derived season would reintroduce the very bug the stamp prevents, one tier higher: after a season rollover, a stamp-correct phase would be searched for in a different season's slice list. The cascade context's season must therefore come from `findSeasonBySlug(state, question.season)`, falling back to today's season when the question carries no season stamp (preserving current behavior). This binding is scoped to the **cascade context only** — `resolveTeamsConfig`, finale detection, and `resolvePerfectRoundsAward` keep the existing reveal-time season, since changing those would alter scoring.

2. **Batch anchor.** `instructions` / `additionalInstructions` are resolved **once per reveal batch**, not per question, using `firstSlotIndex`. With `format.flexible` and `prepCron`, a batch can legitimately contain questions stamped with different phases. The batch resolves against the **first reveal target's** stamp, matching the existing `firstSlotIndex` convention rather than inventing a per-question resolution shape.

**Residual:** generation resolves against `now`, not against the intended post time (which `get_ideas` does not know). A question staged by `prepCron` within a day of a boundary can be generated under the outgoing phase. Accepted — see Risks.

### 5. `phase.format` and `phase.slotOverrides` are deferred *together*

**Decision:** both are out of scope, as one future increment ("phases get a slot tier").

**Why they are coupled** — not a taste call:

```
  buildCascadeContext today:
    gameSlot   = game.format.questions[i]
    seasonSlot = season.slotOverrides[i] ?? season.format.questions[i]
                                            └── read by the seasonSlot TIER

  hypothetical phase.format, with no phase-slot tier:
    count      = phase.format.questions.length      ← applies ✓
    per-slot   = phase.format.questions[i].<axis>   ← nothing reads it ✗
```

A phase format would change the question **count** while its per-slot axes were silently dropped — a half-working feature. Supporting it correctly requires a `seasonPhaseSlot` tier, which also delivers `phase.slotOverrides`. Deferring both keeps this change coherent, and Decision 3's slot-pinning makes the deferral cheap in practice.

Adding the tier later is purely additive: no existing config changes meaning.

### 6. Season-only; `gamePhase` deferred

**Decision:** phases live on `SeasonEntry` only.

**Why:** a season has a start and an end, so escalation is meaningful. A game is perpetual — it has no day zero and no end, so it can only *cycle* (`monthly` / `weekly` anchors with period-remainder arithmetic), which is a different feature with genuinely new machinery. The one real argument for `gamePhase` is that with `seasons.enabled: false` there is no phase tier at all — but that is "time-varying rules for seasonless games", not "escalating season", and it should be proposed on its own merits.

When it is added, the resolution rule follows `format`'s existing precedent — **whole-structure replace per tier**, `season.phases ?? game.phases` — so the two tiers are mutually exclusive at runtime and no configuration ever has to reason about both at once.

### 7. `theme` and `categories` are threaded by hand; `format` is not

**Decision:** add a phase rung to `resolveTheme` and the category cascade. Leave `format` alone (Decision 5).

**Why:** `theme`, `categories`, and `format` are deliberately excluded from `CascadeAxes` (structural-special, own resolvers), so the generic walker does not carry them. `theme` and `categories` are both "what questions are like" and belong in a phase; `format` is round structure and does not.

`resolveActiveCategoriesWithSource` (and its thin `resolveActiveCategories` wrapper) currently take five positional arguments. Adding a sixth for the phase is the wrong direction — it is the last structural resolver not taking a `CascadeContext`. Migrating it is bundled here so the phase rung lands cleanly, and `resolveTheme` follows.

**Schema reuse.** The phase schema reuses **`seasonFormatSlotZod`** (`core/configParsers/format.ts:340`) — the existing full per-tier axis bag, already shared by `season.format.questions[i]` and `slotOverrides`. It validates all 16 axes. `axes.ts`'s `axisFieldsZod` / `TriviaAxisBag` covers only 7 of them and is the wrong base: reusing it would leave 9 axes on a phase slice unvalidated.

### 10. `seasons.json` needs a graceful reader built, not extended

**Decision:** introduce a permissive zod schema for `SeasonsState` / `SeasonEntry` and route `loadSeasonsState` through it.

**Why:** `loadSeasonsState` (`core/dataLayer.ts:187-193`) is `JSON.parse(raw)` cast straight to `SeasonsState` — no validation at all, and no `SeasonEntry` schema exists anywhere in the plugin. That already violates the repo rule that persisted state is parsed through zod, and it means there is no per-field drop mechanism for `phases` to plug into. Since `phases` feeds the cascade directly, an unvalidated array would reach the resolver.

The reader must stay **permissive** — the repo's explicit warning is that a too-strict schema on a state loader silently wipes real state. So: no `.strict()`, model legacy/optional fields, drop the offending field and log rather than discarding the entry. A phase array violating a chaining invariant drops **whole**, because a partially-applied chain would shift every later slice's window.

### 8. `CASCADE_TIER_ORDER` becomes the single source for the broadest-first walk

**Decision:** derive `difficulty.ts`'s `tiersBroadestFirst` from `CASCADE_TIER_ORDER` rather than hand-listing tiers.

**Why:** it is a pre-existing hazard, and this change is the one that triggers it. Of the six places a tier must be registered, four are compile-enforced (`CascadeContext`, `tierObjects`, `ADDITIONAL_INSTRUCTIONS_LABEL` — both `Record<ConcreteTier, …>` — and `buildCascadeContext`). `difficulty.ts:16` is a hand-written array that would silently skip the new tier for `difficulty` and `difficultyRatio` — the two axes an escalating season cares most about. Fixing it converts a silent wrong answer into a compile error for every future tier.

### 9. Derived windows must be visible

**Decision:** `list_seasons` and `explain_cascade` render each phase's **computed** window and which one is active (`gauntlet: Nov 12 – Nov 30, active`).

**Why:** chaining means boundary dates are never stored. Without surfacing them, an admin cannot answer "when does the gauntlet start?" without doing arithmetic against `startedAt`, and will not trust the feature. This is the cost of choosing durations over dates, and it is paid in the read tools.

## Risks / Trade-offs

- **A `prepCron`-staged question can be generated under the outgoing phase.** → Accepted. The stamp keeps the question internally consistent (generation, validation, and reveal all agree). Impact is bounded to questions staged across a boundary, and the boundary is authored by the admin. If it becomes a real problem, `get_ideas` can take an explicit `asOf` for the intended fire time — an additive change.

- **A 7-tier walk — six concrete tiers plus the built-in default — is more for an admin to hold in their head.** → Mitigated by Decision 6 (never two phase tiers) and Decision 9 (`explain_cascade` shows the full ladder with the winning tier, so provenance is never guesswork). The tier is also inert unless `phases` is declared.

- **A season shortened below its declared phase durations silently truncates later phases.** → Acceptable and arguably correct: the open-ended last slice model means the season end always wins. `list_seasons` showing computed windows makes a truncated or never-reached phase visible before it matters.

- **Renaming a phase slug orphans the stamps of already-posed questions.** → By design: those questions fall back to no phase tier at reveal rather than silently adopting a different phase's `instructions`. Slug changes are effectively a new phase, which is the safer default.

- **`difficulty.ts` refactor touches an axis used by every question.** → Behavior-preserving by construction (same tiers, same order) and covered by the existing `resolveCascade` / `difficulty` suites plus the cross-tool parity test.

## Migration Plan

None required. Both new fields (`SeasonEntry.phases`, `TriviaQuestion.phase`) are optional, and absence is meaningful — no phase tier, exactly today's resolution. Existing `seasons.json` and `questions.json` files parse unchanged under the graceful-reader philosophy for persisted state.

Rollback is removing the tier from `CASCADE_TIER_ORDER`; stamped `phase` values become inert data.

## Open Questions

- Should a phase's `theme` also reach the player-facing question opener, or only the finale/narrative prompts that consume `resolveTheme` today? (Affects `trivia-scheduled-prompts`, not the cascade.)
- Should `list_seasons` warn when declared phase durations sum to more than the season's length (a phase that will never be reached)?
