# Design: Trivia Answering Strategy Seam

## Context

Two orthogonal axes exist in trivia answering, but only one is abstracted today:

- **Axis 1 — answer shape** (`AnswerTypeHandler`, exists): what a vote *means* — boolean / choice / freeform. Owns `resolveClick`, `toAnswerPatch`, `rosterGroupKey`, reveal projection.
- **Axis 2 — answer ownership** (this change): who *owns* the persisted slot. Today it is implicit — the `(userId, questionId)` key is hardcoded in the click installer (`clickHandlerInstaller.ts:166-186`), freeform's modal submit (`freeform.ts:511-530`), and every read path.

The planned `byTeam` mode ("shared buzzer": one slot per team, any member's click overrides it, stored in a separate `team-answers.json`) is a second ownership model. It composes with all three shapes, so it must live on its own axis, not inside the handlers.

Constraints: plugin one-surface rule (everything stays inside `src/plugins/trivia/`), test conventions (canonical fakes, no hand-rolled stubs), and CLAUDE.md's AnswerTypeHandler rule — no `answersFormat` branching in consumers; by extension, no `answeringType` branching in consumers either: consumers call the strategy.

## Goals / Non-Goals

**Goals:**

- Extract an `AnsweringStrategy` interface; ship `IndividualAnswering` reproducing today's semantics byte-for-byte.
- Route BOTH write sites (click installer, freeform modal submit) through the strategy.
- Classify every `loadAnswers()` call site as **scoring-view** (migrates) or **audit-view** (stays raw), and migrate the scoring-view set.
- Zero observable behavior change — the existing suite passes unmodified (plus new strategy unit tests).

**Non-Goals:**

- No `ByTeamAnswering`, no `answeringType` config knob, no team store, no stamping — all in `add-trivia-team-answering`.
- No change to `SubmittedAnswer` schema or `answers.json` format.
- No migration of audit-view reads (deliberate: they operate on raw individual rows even under a future team mode).

## Decisions

### D1 — Interface shape: six members, sized from real consumer needs

```ts
// src/plugins/trivia/answering/types.ts
export interface AnsweringStrategy {
  /** What THIS clicker currently sees as their answer (click re-check, freeform modal prefill + submit lookup). */
  getCurrentAnswerFor(userId: string, questionId: string): Promise<SubmittedAnswer | undefined>;
  /** Upsert into the owning slot. Individual: (userId, questionId) save-or-update, recordJoin/refreshIdentities on first write. */
  answer(userId: string, questionId: string, patch: Partial<SubmittedAnswer>, opts: { season?: string }): Promise<void>;
  /** Projected per-question rows — roster, reveal buckets, per-question judging. */
  getFinalAnswers(questionId: string): Promise<SubmittedAnswer[]>;
  /** Projected game-wide rows — leaderboard, retrieve_scores. */
  getAllScoredAnswers(): Promise<SubmittedAnswer[]>;
  /** Judge/reprocess/settle verdict flips onto the owning slot. Individual: ownerKey IS the userId. */
  applyVerdict(ownerKey: string, questionId: string, patch: Partial<SubmittedAnswer>): Promise<void>;
  /** Display seam: how an owner renders (individual: renderPlayerRef / mention). Phase 2: team name. */
  ownerLabel(ownerKey: string, deps: OwnerLabelDeps): string;
}

// OwnerLabelDeps carries what renderPlayerRef needs today — the resolved tagPlayers
// flag and the identity map for display-name lookup. Phase 2 adds nothing (team names
// come from the stamped roster the ByTeam strategy already holds).
export interface OwnerLabelDeps {
  tagPlayers: boolean;
  users: ReadonlyMap<string, TriviaUser>;
}
```

Why six and not the three sketched in exploration: the reveal pipeline *writes* verdicts (freeform judge flips `correct: undefined → boolean`, reprocess re-derives, settle stamps prediction verdicts), and identity rendering resolves owner keys to display strings. Discovering those mid-Phase-2 would force an interface break; sizing now is cheap.

`ownerKey` is a plain `string` — `userId` today, `team:<name>` later. Rows returned by projection methods keep the `SubmittedAnswer` shape (Phase 2 projects team slots into synthetic rows), so downstream consumers never change types. Alternative considered: a discriminated `AnswerOwner` union — rejected as premature; the string key plus `ownerLabel` covers both phases without forking every consumer signature.

### D2 — Construction and injection: one strategy per scoped game, built beside the data layer

`createIndividualAnswering(scoped: ScopedTriviaDataLayer, data: TriviaDataLayer)` — a factory over the scoped data layer, mirroring how `data.forGame(name)` scopes everything else. Consumers get it the same way they get `scoped` today: threaded through existing deps objects (`ProcessRevealDeps`/`ProjectRevealDeps` gain a `strategy` member; `InteractionRegistrationDeps` consumers construct it per click after game resolution). No SDK surface change, no plugin-boundary impact.

Alternative considered: a global registry keyed by game — rejected; the per-call construction is stateless and matches the existing `forGame` idiom. This per-call pattern is also deliberately forward-compatible: every construction site already has the question in hand, so Phase 2 can swap `createIndividualAnswering(...)` for a question-aware `selectAnsweringStrategy(question, ...)` at the same sites with no structural change (a global registry would have foreclosed that).

### D3 — Read-site classification (the contract Phase 2 builds on)

From the full `loadAnswers()` inventory (excluding dataLayer internals):

| Call site | Class | Migrates to |
|---|---|---|
| `clickHandlerInstaller.ts:166` (existing-row lookup) | scoring | `getCurrentAnswerFor` |
| `freeform.ts:440` (modal prefill), `:511` (submit lookup) | scoring | `getCurrentAnswerFor` |
| `freeform/roster.ts:263` (live roster) | scoring | `getFinalAnswers` |
| `boolean.ts:148`, `choice.ts:238`, `freeform.ts:240` (per-question reveal rows) | scoring | `getFinalAnswers` |
| `boolean.ts:177`, `choice.ts:271`, `freeform.ts:308` (bucket assembly) | scoring | `getFinalAnswers` |
| `computeAnswers.ts:248`, `:370` (refresh + leaderboard feed) | scoring | `getAllScoredAnswers` |
| `retrieveScores.ts:55` (leaderboard) | scoring | `getAllScoredAnswers` |
| `settleQuestion.ts:12` (prediction verdict re-derivation) | scoring | `getFinalAnswers` + `applyVerdict` |
| `overrideAnswer.ts:82` | **audit — raw** | — |
| `getQuestionHistory.ts:57` | **audit — raw** | — |
| `revealCards/seeAnswerButton.ts:34` ("See your answer") | **audit — raw** | — (Phase 2 revisits: a team member's "your answer" may become the team's) |

The cheat family (`tools/answers/saveCheating.ts`, `tools/answers/removeCheat.ts`) reads `cheats.json`, NOT `answers.json` — it calls no answer-read method, so it is outside the guard's scope entirely (neither migrated nor allowlisted). Only three files read answers on the audit side: `overrideAnswer.ts`, `getQuestionHistory.ts`, `seeAnswerButton.ts` — the exact allowlist the guard test carries.

Rationale for the audit set: the correction family targets a *specific user's row* by identity; projecting synthetic rows into those tools would corrupt admin semantics. Keeping them raw is a Phase-2 design decision made now, deliberately.

### D4 — Verdict writes go through `applyVerdict`, not `updateAnswer`

Freeform judging, reprocess re-derivation, and `settle_question` currently call `scoped.updateAnswer(userId, questionId, …)` directly. They migrate to `strategy.applyVerdict(row.userId, questionId, …)` — a rename-shaped change under `IndividualAnswering` (it delegates to `updateAnswer`), but it is the load-bearing seam: in Phase 2 the same call lands on the team slot. Raw `saveAnswer`/`updateAnswer` remain on the data layer for the audit tools.

### D5 — Testing strategy

- New unit tests for `IndividualAnswering` against the canonical `createTriviaDataLayer` fake (real data layer over faked I/O, per test conventions) — asserting upsert/first-write side effects (`recordJoin`, `refreshIdentities`), projection pass-through, verdict flips.
- The existing suite is the behavior-identity proof: no existing test's assertions change. Any test that must be edited beyond mock-wiring (constructing/passing the strategy) is a red flag to investigate, not accommodate.
- Guard-style check (same spirit as `cascadeSingleImplementation`): scoring-view files must not call `loadAnswers()` directly — enforced by a small grep-based guard test over the classified file list, so Phase 2 can't be silently bypassed.

## Risks / Trade-offs

- [Threading churn: `strategy` added to reveal deps objects touches every handler's `processReveal`/`projectReveal` signature] → mechanical; deps objects already exist precisely to absorb this kind of growth.
- [`getCurrentAnswerFor` per-click does a full `loadAnswers()` scan, same as today] → no perf regression (identical I/O); Phase 2 keeps team slots in a small separate file.
- [Guard test false-positives on future legitimate raw reads] → the guard lists audit files explicitly; adding a new audit read is a conscious one-line allowlist edit with review visibility.
- [Interface over-fit to Phase 2 guesses (`ownerLabel`, `applyVerdict`)] → both are exercised by `IndividualAnswering` consumers *today* (renderPlayerRef call sites, judge flips), so they earn their place even if Phase 2 shifted.

## Migration Plan

Pure refactor, no data migration, no config change. Land as one commit on main (repo convention); rollback = revert. Deploy carries zero operational steps.

## Open Questions

- None blocking. One deferred-by-design: whether "See your answer" shows the team's answer in `byTeam` mode — recorded in D3 as a Phase-2 decision.
