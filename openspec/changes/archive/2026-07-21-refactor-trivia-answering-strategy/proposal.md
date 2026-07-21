# Refactor: Trivia Answering Strategy Seam

## Why

Answer *ownership* (who owns the persisted answer slot for a click) is tangled into the click installer, the freeform modal submit, and every read path — all hardcoded to the `(userId, questionId)` key. A planned team-play mode ("shared buzzer": one answer per team, any member's click overrides it) needs a second ownership model, which is impossible to add safely while ownership is implicit. This change extracts the seam as a pure, behavior-identical refactor so the team mode can land on top as a small, isolated strategy.

## What Changes

- **New `AnsweringStrategy` abstraction** (`src/plugins/trivia/answering/`): owns answer-slot ownership and persistence. One implementation ships now — `IndividualAnswering`, which reproduces today's `(userId, questionId)` upsert semantics exactly.
- **Interface surface** (~6 members, sized from real consumer needs, not just the click path):
  - `getCurrentAnswerFor(userId, questionId)` — what THIS clicker sees as their current answer
  - `answer(userId, questionId, patch, opts)` — upsert into the owning slot (click + freeform modal submit)
  - `getFinalAnswers(questionId)` — projected per-question rows (roster, reveal buckets)
  - `getAllScoredAnswers()` — projected game-wide rows (leaderboard, retrieve_scores)
  - `applyVerdict(ownerKey, questionId, patch)` — judge/reprocess verdict flips (freeform judging, reprocess re-derivation)
  - `ownerLabel(ownerKey, deps)` seam for display rendering (user mention today)
- **Both write sites migrate**: the shared clickable installer (`clickHandlerInstaller.ts`) AND freeform's modal-submit persistence (`freeform.ts`) route through the strategy.
- **Read-site classification, not blanket migration**: every `loadAnswers()` call site is classified **scoring-view** (migrates to the strategy: leaderboard, round summary, reveal buckets, live roster, retrieve_scores) or **audit-view** (stays on raw rows: `override_answer`, `get_question_history`, cheat flagging/`remove_cheat`, "See your answer" modal). The classification is documented in design.md and is the contract Phase 2 builds on.
- **No behavior change**: with `IndividualAnswering` as the only strategy, every observable surface (files written, blocks rendered, tool payloads) is byte-identical. The existing test suite is the proof.
- **NOT in this change**: no `byTeam` strategy, no `answeringType` config knob, no team-answer store, no schema changes. Those are the follow-up change (`add-trivia-team-answering`).

## Capabilities

### New Capabilities

- `trivia-answering-strategy`: the answer-ownership abstraction — strategy interface contract, `IndividualAnswering` semantics, the scoring-view vs audit-view read classification, and the requirement that write sites (click installer, freeform modal) route through the active strategy.

### Modified Capabilities

<!-- None. This is a behavior-identical internal refactor: no requirement-level change to any existing trivia capability. Reveal, roster, scoring, and admin-tool behavior are unchanged. -->

## Impact

- **New code**: `src/plugins/trivia/answering/` (types + `IndividualAnswering` + tests).
- **Modified code**: `answerTypes/clickHandlerInstaller.ts` (write path), `answerTypes/freeform.ts` (modal-submit write path + judge verdict flips), `freeform/roster.ts` (per-question read), `tools/reveal/computeAnswers.ts`, `tools/reveal/roundSummary.ts` consumers, `tools/answers/retrieveScores.ts` (game-wide reads), each answer-type handler's `processReveal`/`projectReveal` deps as needed to thread the strategy.
- **Untouched**: `SubmittedAnswer` schema, `answers.json` format, all admin/audit tools' raw reads, reveal rendering, prompts, config schema. No migration.
- **Risk**: low — mechanical extraction validated by the existing suite; the main cost is threading the strategy through `ProcessRevealDeps`/`ProjectRevealDeps` without widening plugin-boundary surface.
