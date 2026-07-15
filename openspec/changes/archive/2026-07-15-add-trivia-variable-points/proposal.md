# Add Trivia Variable Points

## Why

Every trivia question is worth exactly one leaderboard point today, regardless of difficulty or stakes. Admins want variable stakes — e.g. "hard questions are worth 3 points" or a high-stakes final slot — driven by prompt guidance rather than rigid config, so Claude can weigh the points against the difficulty it actually landed on at generation time.

## What Changes

- **New cascading axis `points`** — a flat first-wins `CascadeAxes` member with value `{ max: number; guidance?: string }`, cascading `seasonSlot → season → gameSlot → game → workspace → { max: 1 }` (whole-object replace per tier). `max` is a validated hard cap (integer, 1–10); `guidance` is admin-authored free text (e.g. "difficulty drives points: easy 1, hard 3").
- **Prompt-based value selection** — when the resolved `max > 1`, `get_ideas` surfaces `maxPoints` + `pointsGuidance`; Claude picks an integer in `[1, max]` at generation time; `save_question` validates the range and **stamps `points` on the question record** (omitted when 1 — absence reads as 1), so a question is worth what it was posed at, immune to later config edits.
- **Card display** — `post_questions` appends a deterministic "Worth 2 points ⭐" context block adjacent to the answer buttons when the stamped `points > 1` (part of `postedBlocks`, so it survives live-roster rebuilds). Direct-to-Slack string → goes through the plugin i18n dictionary.
- **Points-primary scoring** — leaderboard aggregation joins `questionId → question.points ?? 1` for correct rows (no denormalization onto answer rows, so `override_answer` / `replay_question` / invalidation stay consistent for free). `LeaderboardEntry` gains `totalPoints` / `currentSeasonPoints`; ranking sorts by points; the reveal table's score cells, the This Round row (`roundSummary` gains per-player `points`), and season-MVP selection all use points. When every question is worth 1, points ≡ correct-count — existing deployments observe zero change.
- **Management + audit surfaces** — `upsert_game`, `upsert_season` (create/update/slot tiers), and `set_workspace_config` accept the axis (omit-to-keep / null-to-clear); `list_games` / `explain_cascade` surface it automatically via the axis registry; `find_previous_questions` surfaces the stamped `points`.
- **New admin `override_question` tool** — a narrow, allowlisted reclass tool for stamped question fields that no existing machinery can re-derive (they were Claude-picked at generation, not cascade-derived, so `compute_answers` reprocess can't restore them). Initial allowlist: `points`, `difficulty` (the 1–10 self-rating; `suggestedDifficulty` stays un-overridable — it records what was ROLLED at generation, an audit fact). Follows the `override_answer` pattern (originals captured once for restore); a points override rewrites the worth-block inside the stored `postedBlocks` and returns a `refreshHint` so the card repaints; difficulty reclass is pure audit metadata (no card effect, no hint re-derivation). Answer-key edits stay with `settle_question`; statement/format/season/slot stay un-overridable.

## Capabilities

### New Capabilities

- `trivia-question-points`: the `points` cascade axis end-to-end — config shape and validation, cascade resolution, `get_ideas` surfacing, `save_question` validation + stamping, the "worth N points" card block, the aggregation join rule, and the MCP read/write surface (mirrors how `trivia-judge-leniency` owns its axis).
- `trivia-question-override`: the admin `override_question` reclass tool — field allowlist (`points`, `difficulty`), original-capture semantics, `postedBlocks` worth-block rewrite + `refreshHint` on points changes, and the un-overridable field boundary.

### Modified Capabilities

- `trivia-reveal-processor`: leaderboard composition becomes points-aware — `LeaderboardEntry` carries point totals, ranking/tiebreaks sort by points, `roundSummary.perPlayer` carries `points`, and season-MVP selection picks by points (all reducing to today's correct-count behavior when every question is worth 1).

## Impact

- **Cascade registry**: `CascadeAxes` + `AXIS_REGISTRY` + `AXIS_KEYS` + per-axis validator/zod (`core/cascadeAxes.ts`, `domain/resolveCascade.ts`, `core/configParsers/axes.ts`). Parity tests enforce parser ⇄ registry sync.
- **Generation/persistence**: `tools/questions/getIdeas.ts`, `saveQuestion.ts`, `postQuestions.ts`, `TriviaQuestion` in `core/types.ts`, generation prompt sections in `prompts/scheduledPrompts.ts`.
- **Scoring**: `domain/computeLeaderboard.ts` (signature gains a points map), `tools/reveal/computeAnswers.ts`, `roundSummary.ts`, `rollover.ts` (MVP), `tools/answers/retrieveScores.ts`, reveal-prompt leaderboard/table directives.
- **Management tools**: `tools/games/upsertGame.ts`, `setWorkspaceConfig.ts`, `tools/seasons/upsertSeason.ts`, `tools/questions/findPreviousQuestions.ts`; new `tools/questions/overrideQuestion.ts` registered admin-only in `index.ts`.
- **i18n**: new key in the trivia plugin dictionary (en + fr) for the "worth N points" line.
- **No breaking changes**: axis absent everywhere → byte-for-byte legacy behavior (nothing surfaced, nothing stamped, no card block, identical leaderboard).
