# Design: Trivia Team Answering (Shared Buzzer)

## Context

Prerequisite: `refactor-trivia-answering-strategy` has landed — all scoring-view reads/writes flow through `AnsweringStrategy`, audit-view tools read raw rows, and the guard test enforces the split.

The shipped teams feature (archived `2026-07-16-add-trivia-teams`) is a **pure projection** at reveal: members answer individually, `computeTeamStandings` aggregates. Its two deliberate exclusions — click-time team ownership and a team-aware live roster — are exactly this change. The existing building blocks reused here: `TeamDef`, `resolveTeamsConfig` (season → game → workspace, `inertEnabled` signal), `buildTeamIndexByUser` (the ONE membership-lookup derivation, shared so scoring and rendering can't diverge).

## Goals / Non-Goals

**Goals:**

- One answer slot per team per question; any member's click overrides it (last-click-wins).
- Live roster and reveal surfaces show the **team** for team answers; free agents stay individual everywhere.
- Zero impact when `answeringType` is unset/`"individual"`; zero impact on the shipped aggregate-teams mode.

**Non-Goals:**

- No changes to the shipped `teamsScoring` aggregate mode for `individual` questions — both modes coexist.
- No self-serve team joining/leaving; rosters stay admin-managed config.
- No per-slot/`CascadeAxes` tier for `answeringType` (structural-special like `teamsEnabled`).
- No migration of historical answers into team slots.

## Decisions

### D1 — Separate store, projection at the strategy boundary

`data/plugins/trivia/games/<game>/team-answers.json`:

```ts
interface TeamAnswerSlot {
  teamName: string;        // stable key within the stamped roster
  questionId: string;
  answer?: boolean;        // same per-format payload fields as SubmittedAnswer
  answerIndex?: number;
  answerText?: string;
  correct?: boolean;       // same verdict semantics (undefined = pending freeform)
  lastAnsweredBy: string;  // audit: the member whose click currently holds the slot
  timestamp: number;
  season?: string;
}
```

Graceful zod reader (absent → `[]`), mirroring `answers.json` conventions. Override is an overwrite of the `(teamName, questionId)` slot — never a delete, never a write to another user's individual row. This preserves the shipped feature's "no destructive cross-user writes" property while giving the team a first-class slot.

`ByTeamAnswering.getFinalAnswers`/`getAllScoredAnswers` return free-agent raw rows merged with synthetic rows projected from slots: `{ userId: "team:<name>", questionId, ...payload, correct, timestamp, season }`. Downstream consumers (leaderboard, buckets, roster) are unchanged by construction — that was the point of Phase 1. The `team:` prefix is unambiguous: Slack user IDs never contain `:`.

Alternative (rejected): supersession markers inside `answers.json` — forces every reader to filter for the active row and breaks the audit-view tools' raw-row semantics.

### D2 — Strategy selection reads the question's stamp, not live config

`selectAnsweringStrategy(question, scoped, data)` returns `ByTeamAnswering` iff `question.answeringType === "byTeam"` (with its stamped roster), else `IndividualAnswering`. `post_questions` resolves `answeringType` + effective roster once (via `resolveTeamsConfig`) and stamps both on the record:

```ts
// on TriviaQuestion (optional; absent → individual)
answeringType?: "byTeam";
teamsStamp?: { teams: TeamDef[] };   // frozen roster for THIS question
// NOTE: distinct from the shipped SeasonEntry.teamsStamp ({ teams, teamsScoring }).
// Same name, different type/shape, different purpose (per-question vs per-season-close).
// If the collision proves confusing in code, name the question field questionTeamsStamp.
```

Rationale (the `tagPlayers` pattern, and the archived change's season-close stamping): mid-round knob flips or roster edits must not orphan slots or reshuffle membership on live questions. A user's team for question Q is decided when Q is posted, forever.

Consequence: strategy construction sites (click installer, freeform modal, reveal deps, roster) become question-aware — they already have the question in hand at every call site, so this is a parameter, not a redesign.

### D3 — `answeringType` knob: structural-special, gated on effective teams

Cascade `season → game → workspace → "individual"`, independent first-wins per tier, resolved inside `resolveTeamsConfig`'s family (extend `EffectiveTeamsConfig` with `answeringType`). NOT a `CascadeAxes` member — it is per-game policy like `teamsEnabled`, and slot-level variance would let one fire mix ownership models within a round for no articulated need.

Inertness: `answeringType: "byTeam"` with teams disabled or an empty roster resolves to `"individual"` and sets an `inertAnsweringType` warning surfaced by `list_games` (the `inertEnabled` precedent). Admin tools (`upsert_game`, `upsert_season`, `set_workspace_config`) take `"individual" | "byTeam" | null` with omit-keep/null-clear + shadowing detection.

### D4 — Free agents fall through to individual semantics

`ByTeamAnswering` composes over `IndividualAnswering` (holds an instance): for a clicker absent from the stamped roster, every member delegates verbatim. One strategy instance per question keeps the roster/no-roster branch in exactly one place — consumers never see the difference.

### D5 — Scoring: team slots are points-primary rows; members earn no individual credit

- The synthetic `team:<name>` rows flow through `computeLeaderboard`/`computeRoundSummary` mechanically, but the individual leaderboard/round-summary **filters out `team:` rows** — team results render exclusively in team standings (the reveal already has a team table). Free agents populate the individual surfaces as today.
- Team standings for `byTeam` questions come straight from slot correctness paying the question's stamped points — `computeTeamStandings`' aggregate strategies (`one-right-is-right`/`total-points`) are inapplicable to slot questions (one row per team by construction). `computeTeamStandings` gains a slot-question path; mixed seasons (some questions individual-aggregate, some byTeam) sum both paths per team.
- MVP/perfect-round: `roundMvp` and `perfectRound` are individual honors — free agents only on `byTeam` fires. No team MVP in this change.

### D6 — Rendering: `ownerLabel` carries the whole surface

- Live roster: synthetic team rows group normally (`rosterGroupKey` works on the projected payload); name rendering goes through `strategy.ownerLabel`, which renders `*<teamName>*` (bold plain text — never a mention, `tagPlayers`-independent) for `team:` keys and delegates to `renderPlayerRef` otherwise. `lastAnsweredBy` is never rendered on the card.
- Reveal footer/buckets: same seam. For `byTeam` questions the existing `groupVotersByTeam` aggregate path is **skipped** (slots are already team-shaped); free agents pass through as individuals exactly as its current contract states.
- "Answered" count semantics: a team counts as ONE answered entity in rosters and buckets.

### D7 — Audit-family semantics (the Phase-2 decisions Phase 1 deferred)

- **Cheat flag on a member**: drops only that member's *clicks* (click handler rejects flagged users before the strategy runs — unchanged). An existing slot survives if `lastAnsweredBy` is not the flagged user; if it is, the slot is removed at flag time (`save_cheat` gains a team-slot sweep) so a clean teammate can re-answer. Rationale: "the team is responsible" cannot mean one cheater voids teammates' ability to play, but a cheater's own answer must not stand.
- **`override_answer`**: stays user-keyed for individual rows. For team slots, it accepts the `team:<name>` owner key (surfaced by `get_question_history`'s team-slot projection) and patches the slot's verdict — reusing the `originalVerdict` capture pattern.
- **"See your answer"**: a stamped-roster member sees the team's current answer labeled as the team's (attribution suppressed); free agents see their own row as today.
- **`get_question_history`**: gains team-slot rows (with `lastAnsweredBy`, admin-tier so attribution is visible there) alongside individual rows.

### D8 — Freeform composition

Freeform's modal flow works unchanged through the strategy: prefill = the team's current `answerText`, submit = slot overwrite, judge verdict flip = `applyVerdict("team:<name>", …)` landing on the slot, live roster groups the team under its normalized-text group. The judge sees one text per team — cheaper, no new judging semantics.

## Risks / Trade-offs

- [Synthetic `team:` userIds leaking into identity plumbing (`users.json`, `recordJoin`, `refreshIdentities`, mention rendering)] → `ByTeamAnswering.answer` never calls join/identity side effects for team writes; guard-test the `team:` prefix never reaches `recordJoin`/`refreshIdentities`; all rendering goes through `ownerLabel`.
- [Two teammates click near-simultaneously] → both writes are full-slot overwrites keyed to the same slot; last write wins deterministically — no torn state, matches "override" semantics by definition.
- [Mixed-mode seasons confuse standings (aggregate vs slot paths)] → both paths pay into the same per-team totals; document in the reveal prompt's teams contract; parity test covering a mixed season.
- [Roster edits mid-round ignored (stamp wins)] → intentional; `list_games` surfaces the stamp-vs-config divergence on live questions so admins aren't surprised.
- [`override_answer` schema growth (team keys)] → additive and admin-only; the allowlist-IS-the-schema principle from `override_question` applies — only verdict fields accept team keys.

## Migration Plan

No data migration. New store is graceful-absent; new question fields optional. Ships as one commit on main after Phase 1; rollback = revert (existing `team-answers.json` files become inert orphans, harmless). Deploy has zero operational steps; the knob activates per game only when an admin sets `answeringType: "byTeam"` on a game whose teams config is enabled.

## Open Questions

- Team MVP / finale honors for byTeam-heavy seasons — deferred; individual honors cover free agents, team standings cover teams.
- Whether `upsert_season` should reject `answeringType: "byTeam"` mid-season when live questions carry `individual` stamps — current answer: allow (stamps protect live questions), revisit if admins find it surprising.
