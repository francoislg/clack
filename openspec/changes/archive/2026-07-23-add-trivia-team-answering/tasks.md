# Tasks: add-trivia-team-answering

> Prerequisite: `refactor-trivia-answering-strategy` fully landed (strategy seam + guard test green).

## 1. Config: answeringType knob

- [x] 1.1 Add `answeringType?: "individual" | "byTeam"` to `SeasonEntry`, `TriviaGame`, `TriviaConfig` (`core/configTypes.ts` + `core/types.ts`); extend the teams parser (`core/configParsers/teams.ts`) and game/season/workspace parsers
- [x] 1.2 Extend `resolveTeamsConfig` → `EffectiveTeamsConfig` with `answeringType` + `inertAnsweringType` (byTeam requires enabled + non-empty roster), with unit tests
- [x] 1.3 Add the field to `upsert_game` / `upsert_season` / `set_workspace_config` schemas (omit-keep / null-clear, shadowing detection) and surface in `list_games` / `list_seasons` incl. the inert warning (the divergence note for stale byTeam stamps is added later in task 3.2)

## 2. Team-answer store

- [x] 2.1 Add `TeamAnswerSlot` type + graceful zod reader/writer to the data layer (`loadTeamAnswers` / `upsertTeamAnswer` / `removeTeamAnswer`, scoped per game at `games/<game>/team-answers.json`), with unit tests
- [x] 2.2 Extend the canonical `createTriviaDataLayer` test fake with the new members (open-closed rule — fix the fake in its helpers module)

## 3. Stamping at post time

- [x] 3.1 Add optional `answeringType` + `teamsStamp` to `TriviaQuestion`; stamp both in `post_questions` when resolved byTeam (absent for individual)
- [x] 3.2 `list_games` divergence note: detect when a game has live (un-revealed) questions stamped `answeringType: "byTeam"` while the game's CURRENT resolved config is `"individual"` or teams-disabled; emit a note that the stamp still governs those live questions but new fires will differ. Apply the same check to `list_seasons` for season-tier questions

## 4. ByTeamAnswering strategy

- [x] 4.1 Implement `answering/byTeam.ts`: stamped-roster membership lookup (via `buildTeamIndexByUser`), slot upsert with `lastAnsweredBy` (no join/identity side effects), free-agent delegation to a wrapped `IndividualAnswering`, projection of slots to synthetic `team:<name>` rows merged with free-agent rows, `applyVerdict` onto slots, `ownerLabel` rendering bold team names
- [x] 4.2 Implement `selectAnsweringStrategy(question, scoped, data)` — stamp-driven, legacy-absent → individual; migrate the Phase-1 construction sites to it: (a) `clickHandlerInstaller.ts` (per-click, after question load), (b) `freeform.ts` modal handlers, (c) the `ProcessRevealDeps`/`ProjectRevealDeps` construction in `computeAnswers.ts`, (d) `freeform/roster.ts` roster rendering
- [x] 4.3 Unit tests: override semantics (last-click-wins, `lastAnsweredBy` swap), free-agent fallthrough, projection shape, no `team:` key ever reaching `recordJoin`/`refreshIdentities` (guard-style assertion)

## 5. Rendering

- [x] 5.1 Route roster + reveal-footer name rendering through `strategy.ownerLabel`; team entries render bold plain text, one answered entity per team, `lastAnsweredBy` never on-card
- [x] 5.2 Skip `groupVotersByTeam` for byTeam questions in the reveal bucket path (slots are already team-shaped); free agents bucket individually
- [x] 5.3 Roster/reveal tests for a mixed team + free-agent question across boolean, choice, and freeform

## 6. Scoring

- [x] 6.1 Filter `team:` rows out of individual leaderboard / round summary / MVP / perfectRound surfaces
- [x] 6.2 Add the slot path to `computeTeamStandings` (slot correctness × stamped points) summing with the aggregate path; mixed-season parity test
- [x] 6.3 `retrieve_scores` returns team standings incl. slot-path questions

## 7. Audit family

- [x] 7.1 Cheat-flag slot sweep in `tools/answers/saveCheating.ts`: when the flagged user is a team slot's `lastAnsweredBy`, remove that slot via the data layer's `removeTeamAnswer` so clean teammates can re-answer; slots held by a non-flagged member are left intact; tests
- [x] 7.2 `override_answer` accepts `team:<name>` owner keys for slot verdict patches with `originalVerdict` capture; `get_question_history` projects team-slot rows with `lastAnsweredBy`
- [x] 7.3 "See your answer": stamped-roster member sees the team's answer, attribution suppressed

## 8. Freeform composition

- [x] 8.1 Verify modal prefill/submit/judge flow through the strategy on a byTeam freeform question (team text in modal, judge flips slot verdict, roster groups team under text group); integration-style test

## 9. Docs + verification

- [x] 9.1 Update reveal/admin prompt contracts (`prompts/`) where teams rendering is described; update CLAUDE.md trivia section with the answering axis
- [x] 9.2 Full suite + `npx tsc` + lint/format on touched files; verify disabled-knob byte-identity (no-stamp path untouched)
- [x] 9.3 Run `graphify update .`
