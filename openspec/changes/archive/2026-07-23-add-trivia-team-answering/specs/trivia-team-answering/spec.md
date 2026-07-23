# trivia-team-answering

## ADDED Requirements

### Requirement: Team answer slots live in a separate store with last-click-wins override

For a question stamped `answeringType: "byTeam"`, a team member's answer SHALL be persisted as a single slot keyed `(teamName, questionId)` in `data/plugins/trivia/games/<game>/team-answers.json` — carrying the per-format payload, `correct` verdict, `lastAnsweredBy`, `timestamp`, and `season`. A subsequent click by ANY member of the same team SHALL overwrite the slot in place (payload, verdict, `lastAnsweredBy`, timestamp). Team writes SHALL NOT create, modify, or delete rows in `answers.json`, and SHALL NOT trigger `recordJoin`/`refreshIdentities`. The store SHALL use a graceful zod reader (absent file → empty).

#### Scenario: Teammate overrides a previous member's answer

- **WHEN** member A of Team Red answers "True" and member B of Team Red then answers "False" on the same byTeam question
- **THEN** the single Team Red slot holds "False" with `lastAnsweredBy: B`, A's click leaves no surviving record in any store, and `answers.json` is untouched

#### Scenario: Absent store reads as no team answers

- **WHEN** `team-answers.json` does not exist for a game
- **THEN** the reader returns an empty list and no error surfaces

### Requirement: Free agents fall through to individual semantics

A clicker absent from the question's stamped roster SHALL be handled with `IndividualAnswering` semantics verbatim — `(userId, questionId)` upsert into `answers.json`, join/identity side effects on first write, individual scoring and rendering — on the same question where teammates write to slots.

#### Scenario: Mixed team and free-agent answers on one question

- **WHEN** a roster member and a non-member both answer a byTeam question
- **THEN** the member's answer lands in the team slot and the non-member's answer lands as a normal individual row, each scored and rendered under its own model

### Requirement: answeringType knob cascades and inert-falls-back

The config SHALL support an OPTIONAL `answeringType: "individual" | "byTeam"` field on `SeasonEntry`, `TriviaGame`, and `TriviaConfig`, resolving independently first-wins `season → game → workspace → "individual"` inside the teams resolver family (structural-special — NOT a `CascadeAxes` member). A resolved `"byTeam"` SHALL be effective only when the effective teams config is enabled with a non-empty roster; otherwise it SHALL resolve to `"individual"` and surface an inert warning through `list_games`.

#### Scenario: byTeam without an enabled teams config is inert

- **WHEN** a game sets `answeringType: "byTeam"` but no tier sets `teamsEnabled: true`
- **THEN** questions post as individual-answering and `list_games` warns that `answeringType` is inert

#### Scenario: First-wins precedence across tiers

- **WHEN** the season sets `answeringType: "byTeam"` and the game sets `answeringType: "individual"` (teams enabled with a roster)
- **THEN** the season value wins and the effective `answeringType` is `"byTeam"`, matching the independent first-wins order `season → game → workspace`

#### Scenario: Unset everywhere is byte-identical to today

- **WHEN** no tier sets `answeringType`
- **THEN** every question posts with individual answering and all observable behavior matches the pre-feature system exactly

### Requirement: answeringType and roster are stamped at post time

`post_questions` SHALL resolve the effective `answeringType` and, when `"byTeam"`, the effective roster, and stamp both on the question record (`answeringType`, and `teamsStamp` — an object `{ teams: TeamDef[] }` where each `TeamDef` is `{ name, userIds }`; distinct from the shipped `SeasonEntry.teamsStamp` which also carries `teamsScoring`). All slot ownership, membership lookups, and rendering for that question SHALL read the stamp, never live config. Absent stamps (legacy rows) SHALL read as individual.

#### Scenario: Mid-round roster edit does not reshuffle a live question

- **WHEN** an admin moves a user to a different team while a byTeam question is open
- **THEN** the open question keeps honoring its stamped roster (the user's clicks still write to their stamped team's slot); only questions posted after the edit use the new roster

#### Scenario: Mid-round roster removal falls back per the stamp

- **WHEN** a user is removed from every team while a byTeam question they are stamped into is open
- **THEN** that open question still resolves the user to their stamped team (clicks keep writing to the stamped team's slot); only on questions posted after the removal is the user a free agent writing individual rows

### Requirement: Live roster and reveal surfaces show the team as one entity

On a byTeam question, once any member answers, the live roster SHALL display the TEAM (bold plain-text name — never a Slack mention, independent of `tagPlayers`) in the appropriate answered group instead of any member's name, counting as ONE answered entity. The overriding member's identity (`lastAnsweredBy`) SHALL NOT be rendered on the card. Reveal voter buckets SHALL place the team by its slot's verdict, with free agents bucketed individually; the aggregate `groupVotersByTeam` path SHALL NOT run for byTeam questions.

#### Scenario: Team appears in the roster after a member answers

- **WHEN** a Team Red member answers "True" on a live byTeam boolean question with grouped roster visible
- **THEN** the 👍 group shows *Team Red* (no member name), and a second member's overriding click moves/keeps exactly one Team Red entry

#### Scenario: Attribution is suppressed on public surfaces

- **WHEN** the roster or reveal renders a team's answer
- **THEN** `lastAnsweredBy` appears nowhere on the card (it remains visible only via admin-tier `get_question_history`)

### Requirement: Team slots score as team standings; members earn no individual credit

A byTeam question's team standings SHALL be paid directly from slot correctness times the question's stamped points (one row per team — aggregate `teamsScoring` strategies do not apply to slot questions), summing with aggregate-path standings in mixed seasons. Synthetic team rows SHALL be excluded from the individual leaderboard, round summary, `roundMvp`, and `perfectRound`; free agents keep full individual scoring.

#### Scenario: Correct team slot pays the team, not a member

- **WHEN** Team Red's slot is correct on a 3-point byTeam question
- **THEN** Team Red's standing gains 3 points and no individual leaderboard entry changes for any Team Red member

#### Scenario: Mixed season sums both paths

- **WHEN** a season contains revealed individual-answering questions (aggregate teams scoring) and byTeam questions
- **THEN** each team's standing is the sum of its aggregate-path score and its slot-path score

### Requirement: Audit-family semantics for team slots

A cheat flag on a member SHALL keep dropping only that member's future clicks; when the flagged member is the slot's `lastAnsweredBy`, the slot SHALL be removed at flag time so a clean teammate can re-answer, and otherwise the slot survives. `override_answer` SHALL accept a `team:<name>` owner key to patch a slot's verdict (capturing the prior verdict per the `originalVerdict` pattern). The "See your answer" modal SHALL show a stamped-roster member their team's current answer labeled as the team's, with attribution suppressed. `get_question_history` SHALL include team-slot rows with `lastAnsweredBy`.

#### Scenario: Cheat flag on the slot holder frees the slot

- **WHEN** the member whose click holds Team Red's slot is flagged for cheating
- **THEN** the slot is removed, other Team Red members can answer fresh, and the flagged member's future clicks are dropped

#### Scenario: Member views the team's answer

- **WHEN** a stamped Team Red member clicks "See your answer" on a byTeam question Team Red has answered
- **THEN** the modal shows the team's current answer identified as Team Red's, without naming who submitted it

#### Scenario: override_answer rejects an unknown team key

- **WHEN** an admin calls `override_answer` with a `team:<name>` owner key whose name is absent from the question's stamped roster
- **THEN** the tool rejects the call with a clear error naming the missing team and writes nothing (no ghost slot is created)
