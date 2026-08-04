## Context

Trivia already computes a per-fire "perfect round" (`perfectRound: true` on `roundSummary.perPlayer`) — a player who answered every question correctly on a fire of ≥3 questions (`PERFECT_ROUND_MIN_QUESTIONS`, `tools/reveal/roundSummary.ts`). This flag exists only for the fire being revealed; it is never tallied across a season. The season finale (`process_reveal_answers` when `seasonStatus.isLastFireOfSeason`) renders a points podium (🥇🥈🥉) and an MVP shout-out, both driven by `currentSeasonPoints`. Consistency across the whole season is invisible.

Questions carry `batchId` (`core/types.ts`), stamped once per `post_questions` call — one cron fire = one batch. `process_reveal_answers` already groups by `batchId` to drain one batch per reveal. At the finale, `computeAnswers` has loaded every season question and every scored answer (for the leaderboard). So a season-wide perfect-round tally is reconstructable at read time with no new persistence.

## Goals / Non-Goals

**Goals:**
- Recognize the player(s) with the most perfect rounds across the season with a bonus 🎖️ medal at the finale.
- Make the feature opt-in and cascading (`season → game → workspace → default(off)`), byte-identical to today when off everywhere.
- Reuse the existing clean-sweep rule and existing stored data; no scoring change, no migration.

**Non-Goals:**
- No change to scoring, ranking, the leaderboard table, or the points podium.
- No per-fire display change (the existing `This Round` ⭐ is untouched).
- No slot-tier or `get_ideas`/`save_question` involvement — this is not a per-question axis.
- No seasonless-game support in this change (award is season-finale-scoped). Seasonless wind-down is a possible later extension.

## Decisions

### 1. Structural-special knob, not a `CascadeAxes` member
`perfectRoundsAward` cascades `season → game → workspace → default` with whole-value replace per tier, resolved by a dedicated `resolvePerfectRoundsAward(season, game, workspace)` — exactly the `answeringType` / `tagPlayers` pattern. It is deliberately **excluded** from `CascadeAxes`/`AXIS_REGISTRY` because it has no slot tier and no generation-time roll (it's a whole-season honor, decided at the finale). Adding it to `CascadeAxes` would wrongly force slot semantics and a `get_ideas` roll.

_Alternative considered:_ a `CascadeAxes` member with a slot tier — rejected; a slot-level "perfect rounds award" is meaningless.

### 2. Config shape: bare `enabled` boolean
`perfectRoundsAward?: { enabled: boolean }`. No `minRounds` floor, no label override — the award always goes to whoever has the most perfect rounds (built-in behavior), and the label/tone is Claude's persona-driven prose. An object (not a bare boolean) keeps the door open for future sub-fields without a shape migration.

_Alternative considered:_ `{ enabled, minRounds }` — rejected per product decision; the built-in rule is simply "the most."

### 3. Aggregation by `batchId`, reusing the clean-sweep rule
At the finale only (`isLastFireOfSeason && resolved.enabled`), group the current season's **revealed** questions (`processedAt` set, `season === currentSlug`) by `batchId`. Questions with an undefined `batchId` (legacy rows) are singleton batches (size 1, never perfect) — ignored for free. For each batch of ≥`PERFECT_ROUND_MIN_QUESTIONS` questions, a player scores a perfect round iff they answered **every** question in the batch correctly (same dedupe/`isTeamOwnerKey` exclusion as `computeRoundSummary`). Tally per player; the champion is the player(s) with the maximum count.

This is a generalization of `computeRoundSummary`'s per-fire logic to the whole season. Factor the shared per-batch sweep check so both call sites use one implementation.

### 4. Tie & suppression semantics
- Ties at the top → **all** tied players share the 🎖️ (consistent with dense-rank tie-sharing across trivia surfaces).
- If **every** participating player ties the max (no standout), the award is **still** rendered (product decision — "could be fun").
- The award is **omitted** only when the max count is 0 (nobody had a perfect round all season).

### 5. Payload field
`SeasonStatusOut.perfectRoundsChampion?: { userIds: string[]; count: number }` — present only when the resolved knob is enabled AND `count ≥ 1`. Individual honor: `team:` rows are excluded from the tally even in teams mode (mirrors the individual MVP shout-out). The finale prompt reads it and renders the 🎖️ line; absence = render nothing.

### 6. Rendering
A dedicated line in the SEASON FINALE LAYOUT (`scheduledPrompts.ts`) plus a sentence in `FINALE_TONE_CONTENT` (`topicInstructions.ts`) directs Claude to award the 🎖️ bonus medal to `perfectRoundsChampion.userIds` (naming per the payload's `tagPlayers` MENTION POLICY, ties listed together). 🎖️ (`:medal:`) is chosen deliberately to read distinctly from the podium's 🥇🥈🥉.

## Risks / Trade-offs

- **[Legacy questions without `batchId` undercount perfect rounds]** → Acceptable: `batchId` has been stamped by `post_questions` for a long time; only very old rows lack it, and they degrade to singleton batches (never perfect) rather than erroring. The tally is "best-effort over reconstructable fires," documented in the spec.
- **[Aggregation cost at the finale]** → Bounded by one season's questions/answers, already in memory for the leaderboard; a single extra grouping pass. Negligible, and only on the last fire of a season.
- **[Award feels redundant when it lands on the points champion too]** → By design it often won't (perfection is completeness, not points); when it does coincide, it's a legitimate double honor. No mitigation needed.
- **[Teams mode]** → The award stays individual (team rows excluded), matching the existing individual MVP shout-out; team standings are unaffected.
