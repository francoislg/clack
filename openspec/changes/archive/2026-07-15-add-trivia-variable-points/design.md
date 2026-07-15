# Design — add-trivia-variable-points

## Context

Trivia scoring is binary: a scored `SubmittedAnswer` row contributes `1` to `totalCorrect` when `correct === true`, and every leaderboard/round/MVP surface counts those rows (`domain/computeLeaderboard.ts`, `tools/reveal/roundSummary.ts`, `tools/reveal/rollover.ts`). The cascade registry (`CascadeAxes` + `AXIS_REGISTRY`) makes adding an axis cheap: registry membership is compile-enforced, and `list_games` / `explain_cascade` iterate it automatically. The closest precedents are `judgeLeniency` (flat first-wins axis, resolved at `save_question` time, stamped on the record, no `get_ideas` roll) and `hint` (surfaced to Claude at generation time, drafted by prompt, persisted at save).

The user decisions locked in during exploration:

1. Axis shape: `{ max: number; guidance?: string }` — prompt-based selection with a validated cap.
2. Points-primary scoring: points become THE score (ranking, reveal table, MVP), reducing to correct-count when all questions are worth 1.
3. Card display: deterministic context block adjacent to the answer buttons, rendered at `post_questions` time.

## Goals / Non-Goals

**Goals:**

- Admins can make some questions worth more than one point, per slot/season/game/workspace, with free-text guidance interpreted by Claude at generation time.
- The board, round summary, and MVP reflect point totals; players see "Worth N points ⭐" on the card before answering.
- Absent config → byte-for-byte legacy behavior on every surface.

**Non-Goals:**

- Hint-costs-points (button-mode hints track `clickedBy`; a later change can dock points for hint users — this axis shape doesn't preclude it).
- A general question editor. `override_question` (D7) is a hard-allowlisted reclass tool, not an edit surface: `statement`, `answersFormat`, answer-key fields (owned by `settle_question` + reprocess), `season`/`slot` stamps, and internal bookkeeping stay un-overridable.
- Hint re-derivation on difficulty reclass. The `minDifficulty` gate runs at `get_ideas` time only — it decides whether Claude drafts a hint. Reclassing a question to "hard" cannot conjure hint text that was never written, and the Get Hint button renders purely from the stamped `hint` object; difficulty is never consulted at post time (nor displayed on the card).
- Partial credit (`correct` stays boolean; points multiply, they don't fractionalize).
- Redefining `accuracy` (stays `correct / answered`).
- Weighted-roll of the points value (the value is Claude-picked, not server-rolled — the whole point is letting difficulty/stakes inform it).

## Decisions

### D1: Flat first-wins axis `points: { max: number; guidance?: string }`

A `CascadeAxes` member registered via `makeFirstWins("points", DEFAULT_TRIVIA_POINTS)` with default `{ max: 1 }`. Whole-object replace per tier (setting `guidance` at the season tier without `max` masks the game's `max` — same semantics as `hint`/`choices`; documented in tool descriptions).

- `max`: integer, `1 ≤ max ≤ 10`, required. A **permission, not an instruction** — see D2.
- `guidance`: optional trimmed non-empty string, length-capped (500 chars) — admin free text surfaced verbatim to Claude. The **switch that turns generation-time points on**.

The two fields are deliberately separable, giving three meaningful states:

| Config | Claude at generation | Admin via `override_question` |
| --- | --- | --- |
| absent / `{ max: 1 }` | never picks (axis invisible) | may still set any value (D7) |
| `{ max: 3 }` | never picks — cap alone grants nothing | may set 1–10 |
| `{ max: 3, guidance: "…" }` | picks `1..3` per the guidance | may set 1–10 |

The middle row is the "statically allow 3, but let a human decide when" case: the workspace declares a stakes ceiling without spending any prompt budget or letting Claude reach for it.

**Alternative considered**: weighted map (`{ "1": 4, "3": 1 }`) rolled by `get_ideas` like `answersFormat`. Rejected: a server-side roll happens before Claude researches the question, so it cannot react to the difficulty Claude actually lands on — which is the driving use case ("difficulty affects points").

### D2: Guidance is the switch; Claude picks; `save_question` validates and stamps

**A cap alone never makes Claude spend points.** `get_ideas` surfaces the axis only when the resolved value has BOTH `max > 1` AND a `guidance` string; then the payload gains `maxPoints` + `pointsGuidance`. In every other case neither field is surfaced, so Claude cannot pick and every question stays worth 1 — the legacy path, byte-for-byte, with zero prompt cost.

Gating on `guidance` rather than on `max` alone is what makes `{ max: 3 }` a pure admin-override allowance (D1's middle row). The alternative — always surfacing `max > 1` and instructing "default to 1 unless you have a reason" — was rejected: it spends prompt budget on every fire and invites drift toward >1, when the admin's actual intent ("I'll decide case by case") is expressed perfectly by simply not writing guidance.

- The generation prompt (shared `PER_SLOT_GENERATION_PATHS` in `prompts/scheduledPrompts.ts`) gains a POINTS step, active only when `maxPoints` is present: pick an integer `1..maxPoints` honoring `pointsGuidance`, defaulting to 1 when the guidance doesn't call for more. Absent `maxPoints`, omit `points` entirely.
- `save_question` re-resolves the cascade (same pattern as `resolvedChoiceBounds`), rejects a non-integer or a value outside `[1, resolvedMax]`, and stamps `points` on the record **only when > 1** (absence reads as 1 — keeps legacy rows and 1-point rows identical on disk). A `points` argument supplied when the resolved max is 1 is rejected outright (mirrors `choiceEmojis` under `"numbers"`). Save validates against `max` only — it does NOT additionally require `guidance`, keeping one simple bound rule; surfacing is what gates generation.

**Alternative considered**: stamping unconditionally. Rejected: it would make freshly-written 1-point rows diverge from legacy rows for no consumer benefit.

### D3: Aggregation joins the question record; answers are never denormalized

`computeLeaderboard` gains a `questionPoints: Map<string, number>` parameter (questionId → stamped points, absent → 1). A correct row contributes `questionPoints.get(questionId) ?? 1` to new `totalPoints` / `currentSeasonPoints` fields; `totalCorrect` / `totalAnswered` / `accuracy` keep their exact current meaning.

**Alternative considered**: stamping `points` on `SubmittedAnswer` at scoring time. Rejected: there are four verdict-mutation paths (boolean/choice click scoring, freeform reveal judge, `override_answer`, `replay_question` re-derivation) plus invalidation; every one would have to maintain the denormalized value. The join gives them all consistency for free, and the question record is already loaded by every aggregating caller.

### D4: Points-primary ranking, correct-count preserved as data

- Sort comparators: `sortBy: "totalCorrect"` sorts by `totalPoints` desc with `accuracy` tiebreak; `sortBy: "accuracy"` unchanged except the secondary tiebreak becomes `totalPoints`. When all points are 1, `totalPoints ≡ totalCorrect` at every rank — no observable change.
- `roundSummary.perPlayer` gains `points` (sum of this round's correct-row points); round-MVP and `perfectRound` semantics keep their current definitions (`perfectRound` is about answering ALL correctly — unaffected by weights; round MVP picks by `points` with the current ordering as tiebreak).
- `pickSeasonMvp` picks by current-season points, ties broken as today.
- The reveal prompt's leaderboard-table directive renders point totals in the score cells and documents the new payload fields. The `retrieve_scores` tool result gains the same fields (additive).

### D5: Deterministic card block from the stamped record

`post_questions` appends a `context` block — `⭐ Worth N points` — immediately BEFORE the actions (answer-buttons) block, only when the record's stamped `points > 1`. Built deterministically from the record (never Claude-authored), so it can't drift from what scoring will pay out. It lands inside `postedBlocks`, so live-roster rebuilds (`editRosterIntoCard`) and reveal-time repaints preserve it for free. The string is direct-to-Slack → new key in the trivia plugin dictionary (en + fr) via `sdk.t()`.

**Alternative considered**: folding into the live roster footer line. Rejected: the roster line is rebuilt on every click and its renderer is per-answer-type; a posted-once block is simpler and churn-proof.

### D6: Registry/tooling touch-points follow the standard axis recipe

Per the `add-trivia-attribute` recipe: `CascadeAxes` field + `AXIS_REGISTRY` entry + `AXIS_KEYS` tuple + validator (`validateTriviaPoints`) + a standalone `triviaPointsZod` export. Flat axis → NOT in `TriviaAxisBag`, and correspondingly NOT in the `axisFieldsZod` map, which exists to let tools splat the weighted bag axes in one spread; flat axes are named exports consumed individually (`triviaChoicesZod`, `triviaJudgeLeniencyZod`). Write tools (`upsert_game`, `upsert_season` create/update/slot, `set_workspace_config`) get the zod field + validator call with omit-to-keep / null-to-clear; `list_games` / `explain_cascade` surface it via the registry; `upsert_game` shadowing detection covers it automatically (registry-driven). `find_previous_questions` surfaces the stamped `points` (it affects scoring — same rule that includes `difficulty` and `judgeLeniency`).

### D7: `override_question` — allowlisted reclass, not an editor

A new admin tool `override_question(questionId, { points?, difficulty? })` for retroactively correcting stamped values that no existing machinery can re-derive. The existing correction toolkit covers everything else: answer keys via `settle_question` (`override: true`) + reprocess, per-player verdicts via `override_answer`, whole-question nullification via invalidate/reopen, and cascade-derivable stamps (`revealResponses`, `judgeLeniency`) via reprocess re-stamping. `points` and `difficulty` are the gap because they are Claude-picked at generation — the cascade only supplies bounds/guidance — so an override must carry an explicit admin-supplied value.

- **Allowlist is the schema**: exactly `points` (integer 1–10) and `difficulty` (integer 1–10). `suggestedDifficulty` is deliberately excluded: it records what was ROLLED at generation (the audit trail of what Claude was asked to do), so overwriting it would falsify history rather than correct it. Everything else on the record is out of scope by construction.
- **The override is bounded by the ABSOLUTE 1–10, never by the live cascade `max`.** `max` bounds what Claude may pick at generation; it is not a policy ceiling over admins, and — decisively — **a config edit must never retroactively cap already-posed questions**. A live-max check would couple every past question to today's config: lowering a game's `max` from 3 to 1 would strand every 3-point question already on the board, making a sideways correction (3 → 2) impossible on questions that were legitimately posed at 3. Stamping exists precisely to sever that coupling (a question is worth what it was posed at), and the override is the human escape hatch on top of it. The two rules compose: config drift can neither change a stamped value nor block an admin from fixing one.
- **Original capture**: per-field originals are captured ONCE on first override (the `override_answer` `originalVerdict` pattern), enabling restore and preserving the generation-time fact.
- **Points normalization matches save**: an override to `points: 1` removes the field (absence reads as 1).
- **Repaint through `postedBlocks`**: a points override rewrites the worth-block inside the stored `postedBlocks` (insert / replace / remove as the new value dictates) and returns a `refreshHint`; leaving `postedBlocks` stale would let the next live-roster rebuild resurrect the old value. Scoring needs no touch at all — the aggregation join (D3) re-prices every surface on the next compute.
- **Difficulty reclass is metadata-only**: no card effect (difficulty is never rendered), no hint re-derivation (the `minDifficulty` gate ran at `get_ideas` time; the Get Hint button follows the stamped `hint` object).

**Alternative considered**: a general `update_question` editor. Rejected: the narrow purpose-built tool set is deliberate — a broad editor would let a prompt-confused Claude rewrite a posed question's statement or answer key, breaking the stamped-at-pose integrity model.

## Risks / Trade-offs

- **[Whole-object replace surprises]** A season setting `{ guidance }` alone would silently reset `max` — mitigated by making `max` required in the validator (you cannot write a tier value without a cap) and documenting replace semantics in tool descriptions.
- **[Claude ignores the guidance]** The value is prompt-picked, so a bad pick (e.g. always max) is possible — mitigated by the hard `[1, max]` validation at save, the difficulty-aware default instruction, and audit visibility (`find_previous_questions` surfaces `points` next to `difficulty`).
- **[Aggregation callers must supply the map]** A new consumer calling `computeLeaderboard` without the points map would silently fall back to 1-point scoring — mitigated by making `questionPoints` a required parameter (compile error, not a default).
- **[Retroactive re-pricing disagrees with announced history]** Overriding `points` on a processed question silently re-prices leaderboard totals that a past reveal already announced in prose — mitigated by keeping the tool admin-only, capturing originals for restore, and repainting the card; the escape-hatch nature is the point (fixing a mis-stamped value beats living with it).
- **[Prompt-size creep]** The POINTS generation step and reveal-table directive add tokens to every fire — mitigated by gating both on the resolved axis (`max > 1` surfaces fields; the static prompt text is a few lines).

## Migration Plan

None needed. No stored-shape changes (new optional fields only), no config migration (absent axis = legacy behavior), no re-scoring of historical rows (legacy questions read as 1 point, which is what they were worth).

## Open Questions

None — the three user-owned forks (axis shape, points-primary scoring, block placement) were resolved during exploration.
