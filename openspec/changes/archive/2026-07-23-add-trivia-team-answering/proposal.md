# Add Trivia Team Answering (Shared Buzzer)

## Why

The shipped teams feature (2026-07-16) aggregates *individual* answers into team standings at reveal — every member still answers separately, and the live roster deliberately stayed individual. Workspaces want a true shared-buzzer mode: the **team** owns one answer per question, any member's click overrides the previous member's answer, and the live roster shows the team name instead of individual members. Non-members keep playing individually. The `AnsweringStrategy` seam (`refactor-trivia-answering-strategy`, prerequisite) makes this a strategy implementation rather than a rewrite.

## What Changes

- **New `ByTeamAnswering` strategy** (`src/plugins/trivia/answering/byTeam.ts`): resolves the clicker's team via the existing roster (`resolveTeamsConfig` / `buildTeamIndexByUser`); team members write to a single team slot, free agents fall through to `IndividualAnswering` semantics unchanged.
- **Separate team-answer store**: `data/plugins/trivia/games/<game>/team-answers.json`, keyed `(teamName, questionId)`, carrying the answer payload + `correct` + `lastAnsweredBy: userId` + `timestamp` + `season`. Graceful zod reader (absent file → `[]`). Override = plain overwrite of the slot — no deletes, no cross-user row mutation, no change to `answers.json`.
- **Projection to `SubmittedAnswer` shape**: `getFinalAnswers`/`getAllScoredAnswers` merge free-agent raw rows with synthetic team rows (`userId: "team:<name>"`), so leaderboard, round summary, reveal buckets, and roster consume them unchanged. `ownerLabel` renders the team name (bold plain text, never a mention) for team keys.
- **New `answeringType` knob**: `"individual" | "byTeam"`, default `"individual"`. Structural-special cascade `season → game → workspace` (like `teamsEnabled` — NOT a `CascadeAxes` member). Effective only when the resolved teams config is enabled with a non-empty roster; otherwise inert (falls back to individual with a `list_games` warning, mirroring `inertEnabled`).
- **Stamped at post time**: `post_questions` stamps `answeringType` and the resolved team roster (name + userIds per team) on the question record — mid-round config/roster edits never orphan or reshuffle a live question's slots (the `tagPlayers` pattern).
- **Live roster shows teams**: for a `byTeam` question, the roster renders the team name in the answered group once any member answers; the overriding member's identity is not surfaced on the card (it is retained as `lastAnsweredBy` for audit).
- **Scoring in byTeam mode**: team standings are computed from team slots (one scored row per team per question — `teamsScoring` collapses to slot correctness); free agents keep individual scoring. The individual leaderboard surfaces free agents only; team members earn no individual credit for team answers.
- **Semantics decisions** (from exploration): a cheat flag on a member drops only *that member's* clicks (the slot survives if a clean teammate answered — `lastAnsweredBy` makes this enforceable); `override_answer` on a team slot addresses it via a team-aware path documented in design; "See your answer" for a team member shows the team's current answer with attribution suppressed.
- **Admin surface**: `upsert_game` / `upsert_season` / `set_workspace_config` gain `answeringType` (null-clear / omit-keep, shadowing detection); `list_games` / `list_seasons` surface it present-iff-set plus the inert warning.

## Capabilities

### New Capabilities

- `trivia-team-answering`: the shared-buzzer ownership model — team slot store, override semantics, free-agent fallthrough, projection contract, post-time stamping, roster/reveal/scoring surfaces, and the `answeringType` knob's cascade + inertness rules.

### Modified Capabilities

- `trivia-answering-strategy`: registry gains a second implementation selected by the stamped `answeringType`; strategy construction becomes question-aware (reads the stamp, not live config).
- `trivia-teams`: teams config gains `answeringType`; the "live roster stays individual" exclusion is superseded for `byTeam` questions; `teamsScoring` documented as inapplicable to team-slot questions.
- `trivia-management-tools`: `upsert_game` / `upsert_season` / `set_workspace_config` accept `answeringType`; `list_games` / `list_seasons` project it and its inert warning.
- `trivia-question-posting`: `post_questions` stamps `answeringType` + resolved roster on the question record.

## Impact

- **New code**: `answering/byTeam.ts` (+ tests), `core` team-answer store read/write in the data layer, config parser for `answeringType`.
- **Modified code**: `core/configTypes.ts` + parsers, `tools/games/upsertGame.ts` / `setWorkspaceConfig.ts` / `tools/seasons/upsertSeason.ts` / `listGames.ts` / `listSeasons.ts`, `tools/questions/postQuestions.ts` (stamping), strategy selection at each construction site, `freeform/roster.ts` + `revealCards/` owner-label rendering, `tools/reveal/computeAnswers.ts` team-standings path for slot questions, audit-tool touch points per design (override/see-answer/cheat).
- **Data**: new `team-answers.json` per game (graceful reader, no migration); `TriviaQuestion` gains optional `answeringType` + `teamsStamp` fields (absent on legacy rows → individual).
- **Behavior when disabled**: `answeringType` unset/`"individual"` everywhere → observably identical to today (Phase 1 guarantees the seam is inert).
- **Depends on**: `refactor-trivia-answering-strategy` (must land first).
