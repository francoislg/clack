# Design — add-trivia-teams

## Context

Trivia scoring is per-user end to end: `answers.json` rows are `{userId, questionId, correct, season}`, `computeLeaderboard(answers, users)` is a pure aggregation, and every rendered surface (standings table, reveal footer, narrative) names individuals. The cascade system has two established field families:

- **`CascadeAxes` members** — per-question axes (difficulty, hint, judgeLeniency, …) resolving `seasonSlot → season → gameSlot → game → workspace → default` through `resolveCascade` + `AXIS_REGISTRY`.
- **Structural-special fields** — per-game policy (`format`, `categories`, `theme`, `allTimeRow`, `tagPlayers`) with bespoke resolvers in `domain/*.ts`, audited via `list_games`/`list_seasons`, deliberately off `CascadeAxes`.

Teams is policy, not a per-question generation axis, so it joins the second family. Season history is durable (`seasons.json` keeps ended `SeasonEntry` records), which is the hook for team all-time.

## Goals / Non-Goals

**Goals:**

- Admin-defined teams (no self-serve opt-in) at season, game, or workspace scope, cascading season-wins.
- Team scoring as a pure recomputation layer over unchanged `answers.json` — membership edits apply retroactively.
- Pluggable scoring algorithms behind a registry; two launch modes.
- Teams-mode reveal surfaces: team-first standings table, team names in footers/narrative, free agents preserved as individuals.
- Deterministic team all-time via season-close stamping.
- Zero observable change when `teamsEnabled` is off everywhere.

**Non-Goals:**

- Self-serve joining/leaving, team captains, or any interactive team management.
- Team-aware live answer roster (mid-question surfaces stay individual).
- Per-question team stamping or answer-record changes.
- Balancing/fairness tooling (admin owns roster balance).
- Team identity beyond exact name match across seasons.

## Decisions

### D1: Four independent structural fields, not one `teams` object and not `CascadeAxes` members

`teams` (roster), `teamsEnabled`, `teamsFinaleIndividuals`, `teamsScoring` each cascade **independently first-wins** across `season → game → workspace → default`, resolved by a bespoke `resolveTeamsConfig(season, game, workspace)` in `domain/teams/`.

- *Why not one object*: the house cascade idiom is whole-value replace per tier. A single object would make a season that sets only `{ enabled: true }` mask a workspace roster — precisely the accidental coupling the design must avoid. Independent fields let a season flip enablement while inheriting the roster from a lower tier.
- *Why not `CascadeAxes`*: these are game/season policy, not per-slot generation axes; there is no meaningful slot tier. Same reasoning that keeps `theme`/`allTimeRow`/`tagPlayers` off the registry (see trivia-cascade-registry's structural-special rule).
- *Precedence*: season → game → workspace matches every other structural field (`theme`, `format`, `categories`).

### D2: Enablement is explicit; roster presence never activates

`teamsEnabled` defaults to `false`. A workspace or game roster is inert data until some tier sets `teamsEnabled: true`. Additionally, effective `teamsEnabled: true` with an **empty effective roster resolves to OFF** (surfaced as a warning in `list_games` projection rather than producing a zero-team reveal).

- *Alternative rejected*: presence-implies-enabled — cannot express "roster staged above, this season plays individual" without destroying data.
- Setting `teamsEnabled` on the current season gives natural scoping for "add teams to the next game in channel X": teams mode ends with the season, no cleanup.

### D3: Scoring is a pure projection with a strategy registry

New `domain/teams/computeTeamStandings.ts`: `(answers, roster, mode, filterSeason) → TeamStanding[]`, a sibling of `computeLeaderboard`. Per question, member answers are folded through a `TeamScoringStrategy`:

```ts
interface TeamScoringStrategy {
  scoreQuestion(memberAnswers: readonly ScoredMemberAnswer[], questionPoints: number): number;
}
const TEAM_SCORING_REGISTRY: Record<TeamsScoringMode, TeamScoringStrategy> = {
  "one-right-is-right": {
    scoreQuestion: (a, pts) => (a.some((x) => x.correct) ? pts : 0),
  },
  "total-points": {
    scoreQuestion: (a, pts) => a.filter((x) => x.correct).length * pts,
  },
};
```

`questionPoints` is the question's stamped worth (absent = 1), joined via the existing `QuestionPointsMap` — team scoring is points-aware, matching the points-primary individual scoring ("teams are a layer above the points"). On all-1-point questions the two modes reduce exactly to "≥1 correct → 1" and "count of correct members".

The mapped-type registry makes a missing strategy a compile error (same trick as `AXIS_REGISTRY`); consumers never branch on the mode (house idiom: behavior lives in the handler). Pending freeform rows (`correct === undefined`), cheaters, and the bot are excluded exactly as `computeLeaderboard` does — reuse its filter.

- *Alternative rejected*: stamping team attribution on answers at submit time — breaks "recompute as a layer", requires backfill on membership edits, and adds a migration for zero benefit.

### D4: Season-close stamping of roster + scoring mode

At season close (`start_new_season` / season-end path — the moment that already mutates `seasons.json`, concretely `applySeasonRollover` in `tools/reveal/rollover.ts`), the **effective** roster and `teamsScoring` are stamped onto the ending `SeasonEntry` as a single `teamsStamp: { teams, teamsScoring }` object (only when teams mode was effectively on). The stamp is a field DISTINCT from the season-tier config fields: `SeasonEntry.teams` is cascade input, `SeasonEntry.teamsStamp` is resolved output — conflating them would make a season-tier roster on a teams-off ended season read as team history. Live season always computes from live config; ended seasons read their stamp.

- *Why*: game/workspace-tier config is not versioned — without a stamp, next season's roster edit silently rewrites last season's team history. Follows the existing stamp-at-time-of-use idiom (`tagPlayers` on question records).
- Graceful reader: stamped fields are optional on `SeasonEntry`; legacy rows simply have no team history.

### D5: Team all-time = per-cell name match over stamped history

Team identity across seasons is **exact name match**. All-time for a team = Σ over ended seasons (stamped roster contains the name → score that season with its stamped roster and stamped mode) + live season with live roster/mode. In the standings table the All Time row keeps its existing `allTimeRow` gating; a team cell renders only when the name appears in ≥1 prior stamped roster, else the cell is empty (`–`). Free-agent cells always show individual all-time.

- *Alternative rejected*: computing all-time from the current roster retroactively ("as if from the start" across seasons) — credits teams with answers from seasons where teams didn't exist; reads as nonsense in the finale.

### D6: Reveal surfaces resolve live at reveal time; buckets by team verdict

`compute_answers` resolves the effective teams config at reveal time (same pattern as `tagPlayers` today) and, when on, adds `teamStandings` (this-round + current-season + all-time-by-name-match) and **team-grouped voter buckets** to the payload: a team is Correct if ≥1 member correct, Incorrect if members answered but none correct, NoAnswer if no member answered; members are absorbed into the team name. Free agents remain individual entries in the buckets. `revealCards/footer.ts` renders those grouped buckets; under freeform `revealResponses: "yes"`, member answer texts are listed unattributed under the team name. The prompt contract (`scheduledPrompts.ts`) gains a TEAMS MODE section: team columns first, free agents after, per-cell All Time rule, and — on the season's last fire when `teamsFinaleIndividuals` is true — an appended classic individual leaderboard.

- Individual data is never lost: `retrieve_scores` keeps serving the individual view (and gains team standings alongside when teams mode is on).

### D7: Admin surface = extend existing upsert tools only

`upsert_game`, `upsert_season`, `set_workspace_config` gain the four fields with standard null-to-clear / omit-to-keep semantics; roster is validated (non-empty team names, unique team names, valid Slack user id shape, a user in at most one team). Shadowing detection (`domain/shadowing.ts`) extends to the teams fields so a game-tier roster edit masked by a season roster is surfaced. `list_games` / `list_seasons` project present-iff-set; `explain_cascade` is NOT extended (registry-only tool) — the audit path for structural fields remains the list tools, per convention.

- *Alternative rejected*: a dedicated `manage_teams` verb tool — second write path to the same config, more surface; can be added later without redesign.

## Risks / Trade-offs

- [Duplicate display names across teams/eras confuse all-time name matching] → identity is team *name* only, documented in the admin instruction; renaming a team deliberately severs history (that is the escape hatch, not a bug).
- [A user in multiple teams would double-count] → validation rejects overlapping `userIds` within one roster at write time.
- [Roster references users who never answered] → harmless; they contribute nothing until they answer. Rendering resolves display names via the existing users registry; unknown ids fall back to the raw id.
- [Season closes without stamping (crash mid-path)] → stamping is idempotent and re-derivable while the config is unedited; the catch-up/reveal path re-stamps if absent. Worst case: that season's team history is lost, individual history intact.
- [`total-points` favors big teams] → documented; admins pick the mode. Strategy registry keeps a future normalized mode cheap.
- [Prompt-rendered table means Claude can deviate from the contract] → same trust model as the existing leaderboard table; deterministic payload (`teamStandings`) keeps the numbers right even if layout drifts.

## Migration Plan

None required. All new fields are optional on config and `SeasonEntry` (graceful readers). Rollback = unset `teamsEnabled`; stamped season fields are inert extra data.

## Open Questions

- Optional per-team emoji (`{ name, emoji?, userIds }`) for table headers/footers — deferred; name-only at launch, additive later.
