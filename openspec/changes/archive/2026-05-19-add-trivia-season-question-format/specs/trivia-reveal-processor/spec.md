## ADDED Requirements

### Requirement: Per-fire round summary in payload

The `ProcessRevealResult` payload returned by `process_reveal_answers` SHALL include a `roundSummary` field describing each player's correctness across this fire's revealed questions:

```ts
roundSummary: {
  totalQuestions: number; // === reveals.length
  perPlayer: Array<{
    userId: string;
    displayName: string;
    correct: number; // count of reveals where this player appears in voters.correct
    answered: number; // count of reveals where this player appears in any of voters.{correct, incorrect, fenceSitters, wildcards}
    roundMvp?: true; // present iff this player is tied for the highest `correct` count this fire
  }>;
}
```

The field SHALL be present whenever `reveals.length >= 1` — including length-1 reveals (where it describes the one question). When `reveals.length === 0` (no pending questions), `roundSummary.totalQuestions` SHALL be `0` and `perPlayer` SHALL be `[]`.

`perPlayer` SHALL include only players who appear in at least one reveal's voter list for this fire — players with `answered === 0` SHALL NOT be present.

`perPlayer` SHALL be sorted by `correct` descending, ties broken by `displayName` ascending (case-insensitive, locale-sensitive comparison).

`roundMvp: true` SHALL be set on EVERY player tied for the highest `correct` value in `perPlayer`. When no player has `correct > 0`, `roundMvp` SHALL be absent from all entries.

The structural-exclusion guarantees of the `voters` field carry through to `roundSummary` — the bot, flagged cheaters, and (for choice questions) multi-react voters are absent from the counts because they are absent from the source `voters` lists. The renderer SHALL NOT need to filter `perPlayer`.

#### Scenario: Length-1 reveal still produces a roundSummary

- **GIVEN** one pending question with `voters.correct: [alice, bob]` and `voters.incorrect: [carol]`
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `1`
- **AND** `roundSummary.perPlayer` includes alice/bob with `correct: 1, answered: 1`, carol with `correct: 0, answered: 1`
- **AND** alice and bob both carry `roundMvp: true` (tied for top); carol does not

#### Scenario: Length-3 reveal aggregates per player

- **GIVEN** three pending questions
- **AND** alice voted correctly on Q1 and Q2, incorrectly on Q3
- **AND** bob voted correctly on Q1, did not vote on Q2, voted correctly on Q3
- **AND** carol voted correctly on all three
- **WHEN** `process_reveal_answers` returns
- **THEN** `roundSummary.totalQuestions` equals `3`
- **AND** alice has `correct: 2, answered: 3`
- **AND** bob has `correct: 2, answered: 2`
- **AND** carol has `correct: 3, answered: 3, roundMvp: true`
- **AND** neither alice nor bob carries `roundMvp`

#### Scenario: Player who answered zero questions is omitted

- **GIVEN** two pending questions
- **AND** dave voted on neither
- **WHEN** `process_reveal_answers` returns
- **THEN** dave does NOT appear in `roundSummary.perPlayer`

#### Scenario: Round MVPs share the title on a tie

- **GIVEN** four players all scoring 2/3 correct on a 3-question fire
- **WHEN** `process_reveal_answers` returns
- **THEN** all four entries in `roundSummary.perPlayer` carry `roundMvp: true`

#### Scenario: No correct answers → no MVPs

- **GIVEN** a fire where every voter was incorrect on every question
- **WHEN** `process_reveal_answers` returns
- **THEN** every entry in `roundSummary.perPlayer` has `correct: 0`
- **AND** no entry carries `roundMvp`

#### Scenario: Empty payload still carries a roundSummary

- **GIVEN** no pending questions for the game
- **WHEN** `process_reveal_answers` returns
- **THEN** `reveals` is `[]`
- **AND** `roundSummary.totalQuestions` is `0`
- **AND** `roundSummary.perPlayer` is `[]`

#### Scenario: Cheaters and multi-react voters do not appear in roundSummary

- **GIVEN** a question where bob is a flagged cheater and dave is a multi-react voter (choice question)
- **WHEN** `process_reveal_answers` returns
- **THEN** neither bob nor dave appears in `roundSummary.perPlayer` (they are structurally excluded from `voters`)

## MODIFIED Requirements

### Requirement: Season rollover happens inside the tool

When `seasons.enabled === true` AND the tool's internal `check_season_status` computation reports `isLastFireOfSeason: true`, the tool SHALL perform the season-end rollover inline, before returning. Rollover consists of:

1. Stamping `endedAt = Date.now()` on the closing season entry (idempotent — no-op if `endedAt` is already set).
2. If no future season entry exists in this game's `seasons.json` with `startedAt > now`, creating a continuation season entry. The continuation season SHALL inherit `categories`, `questionTypes`, and `format` from the closing season (deep copies of each field; absent fields stay absent). The continuation's `slug` SHALL be deterministically derived (e.g. `season-YYYY-MM` for the next month). The continuation's `startedAt` SHALL be `Date.now()` and `expectedEndAt` SHALL be end-of-current-UTC-month.

The continuation's inheritance of `categories` is a **behavioral change** from the prior rule (which copied from `categories.json` baseline). The "repeat" semantic is intentional: auto-continuation means "keep going with the same setup", and resetting any one field while inheriting the others is harder to reason about than uniform inheritance. Staged future seasons (entries with `startedAt > now` already on the timeline at the moment of rollover) SHALL NOT be replaced or augmented — admin intent overrides inheritance.

The tool SHALL report the outcome via `seasonStatus.seasonClosed` (true iff this run stamped `endedAt`) and, when a continuation was created, `seasonStatus.newSeasonStarted: { slug, expectedEndAt }`. The tool SHALL identify the season MVP (player at index 0 of the current-season-ordered leaderboard) and include them in `seasonStatus.mvp` for the renderer.

When `isLastFireOfSeason` is `false`, the tool SHALL NOT perform any rollover, SHALL NOT mutate any season entry, and SHALL set `seasonStatus.seasonClosed: false` with no `newSeasonStarted` field.

#### Scenario: Last-fire reveal closes the season inline

- **GIVEN** `seasons.enabled` is `true`, the current season's `expectedEndAt` makes today its last fire, and no future season is queued
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** before the call returns, the closing season's entry in `games/main/seasons.json` has `endedAt` stamped to a value close to `Date.now()`
- **AND** a new season entry is appended with a fresh slug, `startedAt` close to `Date.now()`, and `expectedEndAt` set to end-of-current-UTC-month
- **AND** the returned `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` references the new entry's slug and expectedEndAt

#### Scenario: Auto-continuation inherits categories from the closing season

- **GIVEN** the closing season's `categories` is `["Marine Biology", "Cephalopods", "Tides"]` (a themed pool that differs from the global baseline)
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `categories` is a deep copy of `["Marine Biology", "Cephalopods", "Tides"]`
- **AND** the new entry's `categories` is NOT a copy of the global `categories.json` baseline

#### Scenario: Auto-continuation inherits questionTypes from the closing season

- **GIVEN** the closing season's `questionTypes` is `{ choice: 1 }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `questionTypes` is `{ choice: 1 }`

#### Scenario: Auto-continuation inherits format from the closing season

- **GIVEN** the closing season has `format: { questions: [{ label: "GK 1" }, { label: "History Choice", questionTypes: { choice: 1 } }] }`
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry's `format` is a deep copy of the closing season's `format`
- **AND** the next question-cron fire for this game posts 2 questions matching the inherited slot structure

#### Scenario: Auto-continuation absent fields stay absent

- **GIVEN** the closing season has no `questionTypes` field and no `format` field
- **WHEN** `process_reveal_answers` performs auto-continuation
- **THEN** the new continuation entry has no `questionTypes` field and no `format` field
- **AND** the new entry's `categories` is still a deep copy of the closing season's `categories`

#### Scenario: Mid-season reveal does not roll over

- **GIVEN** `seasons.enabled` is `true` and today is NOT the last fire of the current season
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `games/main/seasons.json` is unchanged after the call
- **AND** `seasonStatus.seasonClosed` is `false`
- **AND** `seasonStatus.newSeasonStarted` is absent

#### Scenario: Last-fire reveal with continuation already queued does not create another

- **GIVEN** `seasons.enabled` is `true`, today is the last fire of the current season, AND a future season already exists with `startedAt > now`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** the closing season is stamped with `endedAt`
- **AND** NO additional season entry is appended (the existing future entry is honored as the continuation)
- **AND** the existing future entry is NOT modified — its `categories`, `questionTypes`, and `format` retain whatever values the admin set
- **AND** `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` is absent (no new entry was created by this run)

#### Scenario: Season MVP is identified

- **GIVEN** `seasons.enabled` is `true`, today is the last fire, and Alice leads the current-season leaderboard with the highest `currentSeasonCorrect`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `seasonStatus.mvp.userId` equals Alice's user ID
- **AND** `seasonStatus.mvp.currentSeasonCorrect` equals her current-season correct count
