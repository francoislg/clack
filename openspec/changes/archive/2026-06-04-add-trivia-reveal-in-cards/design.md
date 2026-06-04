## Context

After `refactor-trivia-reveal-tools`, the reveal is three steps: `compute_answers` → `update_answers_block` (deterministic card projection) → `submit_response` (summary + leaderboard). Each question's narrative lives in the summary; cards carry only the deterministic facts footer. `includeRevealInQuestions: "yes"` moves the narrative into the cards. It is the card-side of what was originally one `revealType` axis; the summary-side is `add-trivia-final-reveal-summary`. The two are independent and compose (e.g. cards carry narrative AND the summary is suppressed → `includeRevealInQuestions: yes` + `finalRevealSummary: no`).

This is a game+workspace setting like `allTimeRow` — a reveal batch renders one way or the other, so it skips the per-question `CascadeAxes` machinery and uses a dedicated two-tier resolver.

## Goals / Non-Goals

**Goals:**
- One game-level (workspace-defaulted) switch for whether cards carry the reveal narrative, defaulting to today.
- Keep card facts deterministic/replayable in both modes; only the narrative is the new authored layer.
- Make authored card content recoverable for re-emit/repair without regeneration.

**Non-Goals:**
- Per-season/slot setting; `CascadeAxes` membership.
- Anything about the standalone summary message (that is `add-trivia-final-reveal-summary`).
- Changing behavior when the axis is unset.

## Decisions

### Decision 1: Dedicated game→workspace resolver (mirror allTimeRow)

Add `includeRevealInQuestions?: "yes" | "no"` to `TriviaGame` + `TriviaConfig`, `DEFAULT_INCLUDE_REVEAL_IN_QUESTIONS = "no"`, and `resolveIncludeRevealInQuestions(game, workspace)` in `domain/includeRevealInQuestions.ts` — verbatim shape of `resolveAllTimeRow`. Wiring mirrors `allTimeRow` end to end (configTypes, parsers/axes, games, configBridge, list_games).

### Decision 2: Resolve fresh at reveal, return in the payload

`compute_answers` resolves the axis at reveal time and returns it; not stamped on the record. Rationale matches `allTimeRow`: a game-level presentation choice with no per-question variance.

### Decision 3: `revealBlocks` is the authored narrative layer ONLY

In `"yes"` mode `update_answers_block` still renders the deterministic results footer from `answers.json` and **appends** the question's stored `revealBlocks` beneath it (before the "See your answer" button). `revealBlocks` holds only narrative — never the facts. Preserves the refactor's replay model: re-scoring updates the footer on re-projection automatically; re-authoring narrative is an independent `update_question` write.

### Decision 4: `update_question` persists; `update_answers_block` projects (one writer)

`update_question(game, questionId, revealBlocks)` writes to `questions.json`, no Slack — `update_answers_block` stays the sole card editor. It rejects `revealBlocks` when `resolveIncludeRevealInQuestions` is `"no"`. `"yes"`-mode sequence: `compute_answers` → per question `update_question(blocks)` → `update_answers_block(batchId)` → `submit_response`.

### Decision 5: `find_previous_questions.revealBlocks`, gated and revealed-only

Exposed only on opt-in (specific ids or `includeRevealBlocks`), only for `processedAt`-set questions (never leak the answer key for live questions), never in the default list. Serves re-emit when a card was deleted, distinct from `update_answers_block` re-projecting to the original message.

## Risks / Trade-offs

- **Claude authors cards but the axis is `"no"`** → `update_question` rejects in `"no"` mode; prompt only authors in `"yes"`; `update_question` in `requiredTools` is harmless when unused.
- **`revealBlocks` drift vs facts** → separate layers (Decision 3); footer always re-derived from `answers.json`.
- **Payload bloat in `find_previous_questions`** → gated to targeted/opt-in lookups.

## Migration Plan

1. Type + default + fields + parser/validator + `resolveIncludeRevealInQuestions` (mirror `allTimeRow`).
2. `compute_answers` returns the axis.
3. `revealBlocks?` on `TriviaQuestion`; build `update_question` (persist + `"no"` guard).
4. `update_answers_block` append branch; `find_previous_questions` opt-in field.
5. Prompt authors per-card narrative in `"yes"`; add `update_question` to reveal `requiredTools`.
6. `upsert_game` / `set_workspace_config` accept it; `list_games` surfaces it.
7. Tests; **rollback:** revert commit, all fields optional/absent-default, no data migration.

## Open Questions

- `update_question` single-question vs batch (`{questionId, revealBlocks}[]`)? Leaning single-question first; batch is an easy follow-up if call volume matters.
- Shares prompt/payload/trivia-games touch-points with `add-trivia-final-reveal-summary`; apply one change, sync, then the other to avoid delta collisions.
