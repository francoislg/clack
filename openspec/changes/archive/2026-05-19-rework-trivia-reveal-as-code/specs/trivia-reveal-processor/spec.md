## ADDED Requirements

### Requirement: `process_reveal_answers` MCP tool

The trivia plugin SHALL register an `admin`-tier MCP tool named `process_reveal_answers` that takes `{ game: string, reprocessQuestionIds?: string[] }` and returns a structured `ProcessRevealResult` payload. The tool SHALL absorb the deterministic work previously performed by Claude across `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, and (when seasons are enabled) `check_season_status` + `upsert_season` for the scheduled reveal flow.

The returned payload SHALL have the following shape:

```ts
type ProcessRevealResult = {
  game: string;
  reveals: Array<{
    questionId: string;
    statement: string;
    category: string;
    emojis: string[];
    messageLink: string;
    wasReprocessed: boolean;
    answer:
      | { type: "boolean"; isTrue: boolean }
      | { type: "choice"; choices: string[]; correctIndex: number };
    voters: {
      correct: Array<{ userId: string; displayName: string }>;
      incorrect: Array<{ userId: string; displayName: string }>;
      fenceSitters: Array<{ userId: string; displayName: string }>; // boolean only — empty for choice
      wildcards: Array<{ userId: string; displayName: string; emoji: string }>;
    };
  }>;
  leaderboard: Array<{
    userId: string;
    displayName: string;
    totalCorrect: number;
    totalAnswered: number;
    accuracy: number;
    currentSeasonCorrect?: number;
    currentSeasonAnswered?: number;
  }>;
  seasonStatus?: {
    currentSlug: string;
    isLastFireOfSeason: boolean;
    seasonClosed: boolean;
    newSeasonStarted?: { slug: string; expectedEndAt: number };
    mvp?: { userId: string; displayName: string; currentSeasonCorrect: number };
  };
};
```

The tool SHALL exclude the bot's own user ID, every user ID flagged as a cheater for the relevant question, and (for choice questions) any user who reacted with two or more numbered emojis (multi-react voters) from EVERY field of the returned payload. These exclusions SHALL be structural — the renderer SHALL NOT be required to filter the payload further. The tool SHALL determine the bot's user ID at call time (e.g. via `client.auth.test()`); it SHALL NOT hardcode a specific value.

#### Scenario: Tool registers at admin tier

- **WHEN** the trivia plugin loads
- **THEN** `process_reveal_answers` is registered on the trivia MCP server with `minRole: "admin"`
- **AND** the tool is callable as `mcp__trivia__process_reveal_answers`

#### Scenario: Bot user ID is excluded from every voter list

- **GIVEN** the bot reacted with `:+1:` on a boolean question's message (as it typically does at post time)
- **WHEN** `process_reveal_answers({ game })` is called and returns
- **THEN** the bot's user ID does not appear in any `reveals[*].voters.correct`, `voters.incorrect`, `voters.fenceSitters`, or `voters.wildcards` array

#### Scenario: Cheaters are excluded from every voter list

- **GIVEN** users U1 and U2 are flagged as cheaters for the target questionId via `cheats.json`
- **AND** both reacted with `:-1:` on the question
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** neither U1 nor U2 appears in any `voters.*` array of the returned reveal

#### Scenario: Multi-react voters are excluded on choice questions

- **GIVEN** the target question is `type: "choice"` and user U3 reacted with both `:one:` and `:two:`
- **WHEN** `process_reveal_answers({ game })` is called
- **THEN** U3 does not appear in `voters.correct`, `voters.incorrect`, or `voters.wildcards`
- **AND** the payload contains no field that names or counts multi-react voters

### Requirement: Default-mode processes the oldest unprocessed question

When `reprocessQuestionIds` is absent or an empty array, the tool SHALL process the single oldest question in the named game whose `postedAt` field is set AND whose `processedAt` field is unset. "Oldest" SHALL be determined by ascending `postedAt`. The tool SHALL stamp `processedAt = Date.now()` on the processed question before returning.

When no question matches (no pending questions for this game), the tool SHALL return `reveals: []`, an up-to-date `leaderboard`, and the `seasonStatus` if seasons are enabled. The caller (renderer) interprets an empty `reveals` array as "nothing to reveal."

The tool SHALL NOT process more than one question per default-mode call, even when multiple are pending. Multiple pending questions SHALL be drained one-per-fire across successive cron ticks (or via explicit `reprocessQuestionIds` for admin batch operations).

#### Scenario: One question pending, no reprocess IDs

- **GIVEN** `games/main/questions.json` contains one row with `postedAt: T1` and no `processedAt`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** that row is selected and `reveals[0].questionId` matches its `id`
- **AND** the row's `processedAt` is stamped before the call returns
- **AND** `reveals[0].wasReprocessed` is `false`

#### Scenario: Multiple pending, oldest wins

- **GIVEN** two pending rows with `postedAt: T1` and `postedAt: T2` where `T1 < T2`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** the `T1` row is selected
- **AND** the `T2` row remains unprocessed (its `processedAt` is still unset)

#### Scenario: No pending questions returns empty reveals

- **GIVEN** every row in `games/main/questions.json` has both `postedAt` and `processedAt` set
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `reveals` is `[]`
- **AND** `leaderboard` still reflects the current standings for this game
- **AND** the call does not throw

### Requirement: Reprocess mode hard-deletes and re-derives the listed questions

When `reprocessQuestionIds` is a non-empty array, the tool SHALL process EACH listed questionId in that order:

1. Hard-delete every `SubmittedAnswer` row in `games/<game>/answers.json` whose `questionId` matches.
2. Re-fetch the question's Slack message via the Slack Web API (using the question's stored `messageTs`).
3. Re-categorize voters against the CURRENT state of `cheats.json` (which may include cheaters added since the original reveal).
4. Persist a fresh batch of `SubmittedAnswer` rows.
5. Stamp `processedAt = Date.now()` on the question (overwriting any prior value).
6. Include the resulting reveal in the returned `reveals[]` with `wasReprocessed: true`.

In reprocess mode, the tool SHALL NOT also process pending questions outside the listed IDs. If a listed questionId does not exist or its message is not retrievable, the tool SHALL include a structured error for that ID in its response and continue processing the remainder.

#### Scenario: Reprocessing a question deletes prior answers

- **GIVEN** `games/main/answers.json` contains 5 rows for questionId Q123
- **WHEN** `process_reveal_answers({ game: "main", reprocessQuestionIds: ["Q123"] })` is called
- **THEN** before the call returns, all prior Q123 rows are removed from `answers.json`
- **AND** new rows are written reflecting the current reaction state on Q123's Slack message

#### Scenario: Reprocessing excludes cheaters flagged after the original reveal

- **GIVEN** Q123 was originally processed with no cheaters flagged
- **AND** user U1 reacted `:+1:` on Q123 and was scored as a correct answer at the time
- **AND** an admin later writes a cheat report flagging U1 on Q123
- **WHEN** `process_reveal_answers({ game: "main", reprocessQuestionIds: ["Q123"] })` is called
- **THEN** U1 is excluded from every voter list in the returned reveal
- **AND** no `SubmittedAnswer` row exists for `userId: "U1"` and `questionId: "Q123"` after the call

#### Scenario: Reprocess mode does not pick up unrelated pending questions

- **GIVEN** Q123 has `processedAt` set and Q456 has `postedAt` set with no `processedAt`
- **WHEN** `process_reveal_answers({ game: "main", reprocessQuestionIds: ["Q123"] })` is called
- **THEN** `reveals` contains exactly one entry, for Q123
- **AND** Q456 remains unprocessed (its `processedAt` is still unset)

#### Scenario: Unknown questionId yields a per-id error without aborting the batch

- **GIVEN** Q123 exists and Q-bogus does not
- **WHEN** `process_reveal_answers({ game: "main", reprocessQuestionIds: ["Q-bogus", "Q123"] })` is called
- **THEN** Q123 is processed and appears in `reveals`
- **AND** the response surfaces a structured error referencing `Q-bogus`

### Requirement: Tool internally composes leaderboard and season-status logic

The tool SHALL internally invoke shared helpers — equivalent to the implementations behind `retrieve_scores` and `check_season_status` — to populate the `leaderboard` and `seasonStatus` fields of its return value. Specifically:

- The `leaderboard` field SHALL be the result of the same aggregation logic used by the `retrieve_scores` tool (a shared `computeLeaderboard` helper SHALL be the single source of truth for ranking, and both tools SHALL call it).
- The `seasonStatus` field SHALL be populated when and only when `trivia.seasons.enabled === true`. Its `currentSlug` and `isLastFireOfSeason` values SHALL be computed identically to the `check_season_status` MCP tool.
- When `seasons.enabled` is `false`, the `seasonStatus` field SHALL be omitted from the return value.

#### Scenario: Leaderboard matches retrieve_scores for the same game

- **GIVEN** seasons disabled and `games/main/answers.json` contains a fixed set of answer rows
- **WHEN** `process_reveal_answers({ game: "main" })` and `retrieve_scores({ game: "main", sortBy: "totalCorrect" })` are both invoked
- **THEN** the `leaderboard` field of the first call's return matches the `leaderboard` array returned by the second call, entry-for-entry (same ordering, same per-user totals)

#### Scenario: seasonStatus omitted when seasons disabled

- **GIVEN** `config.trivia.seasons.enabled` is `false` (or absent)
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** the return value has no `seasonStatus` field

#### Scenario: seasonStatus populated when seasons enabled

- **GIVEN** `config.trivia.seasons.enabled` is `true` and a current season exists for the game
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `seasonStatus.currentSlug` matches the current season's slug
- **AND** `seasonStatus.isLastFireOfSeason` reflects whether today is the season's last scheduled reveal date

### Requirement: Season rollover happens inside the tool

When `seasons.enabled === true` AND the tool's internal `check_season_status` computation reports `isLastFireOfSeason: true`, the tool SHALL perform the season-end rollover inline, before returning. Rollover consists of:

1. Stamping `endedAt = Date.now()` on the closing season entry (idempotent — no-op if `endedAt` is already set).
2. If no future season entry exists in this game's `seasons.json` with `startedAt > now`, creating a continuation season entry with a deterministically-derived slug (e.g. `season-YYYY-MM` for the next month) and `categories` copied from the global `categories.json` baseline.

The tool SHALL report the outcome via `seasonStatus.seasonClosed` (true iff this run stamped `endedAt`) and, when a continuation was created, `seasonStatus.newSeasonStarted: { slug, expectedEndAt }`. The tool SHALL identify the season MVP (player at index 0 of the current-season-ordered leaderboard) and include them in `seasonStatus.mvp` for the renderer.

When `isLastFireOfSeason` is `false`, the tool SHALL NOT perform any rollover, SHALL NOT mutate any season entry, and SHALL set `seasonStatus.seasonClosed: false` with no `newSeasonStarted` field.

#### Scenario: Last-fire reveal closes the season inline

- **GIVEN** `seasons.enabled` is `true`, the current season's `expectedEndAt` makes today its last fire, and no future season is queued
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** before the call returns, the closing season's entry in `games/main/seasons.json` has `endedAt` stamped to a value close to `Date.now()`
- **AND** a new season entry is appended with a fresh slug, `startedAt` close to `Date.now()`, and `categories` matching the global baseline
- **AND** the returned `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` references the new entry's slug and expectedEndAt

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
- **AND** `seasonStatus.seasonClosed` is `true`
- **AND** `seasonStatus.newSeasonStarted` is absent (no new entry was created by this run)

#### Scenario: Season MVP is identified

- **GIVEN** `seasons.enabled` is `true`, today is the last fire, and Alice leads the current-season leaderboard with the highest `currentSeasonCorrect`
- **WHEN** `process_reveal_answers({ game: "main" })` is called
- **THEN** `seasonStatus.mvp.userId` equals Alice's user ID
- **AND** `seasonStatus.mvp.currentSeasonCorrect` equals her current-season correct count

### Requirement: `processedAt` field on TriviaQuestion

The `TriviaQuestion` type SHALL gain an optional `processedAt?: number` field (epoch milliseconds). The field SHALL be stamped by `process_reveal_answers` when (a) processing the oldest pending question in default mode, or (b) reprocessing a question via `reprocessQuestionIds`. Legacy rows lacking the field SHALL NOT be retroactively populated by reads — they remain `undefined` until explicitly set by a write or by a one-shot back-fill at deploy time (see migration plan in the change's design document).

The default-mode question selection filter SHALL be `(question.postedAt !== undefined) AND (question.processedAt === undefined)`.

#### Scenario: processedAt is stamped on default-mode processing

- **GIVEN** a question with `postedAt: 1000`, no `processedAt`
- **WHEN** the tool processes it in default mode
- **THEN** after the call, the question row's `processedAt` is a positive number close to `Date.now()`

#### Scenario: processedAt is overwritten on reprocess

- **GIVEN** a question with `processedAt: 5000`
- **WHEN** the tool reprocesses it via `reprocessQuestionIds`
- **THEN** after the call, the question row's `processedAt` is a positive number greater than `5000`

#### Scenario: processedAt makes a question ineligible for default-mode selection

- **GIVEN** question Q has `postedAt: 1000` and `processedAt: 2000`, and question Q' has `postedAt: 1500` and no `processedAt`
- **WHEN** the tool is invoked in default mode
- **THEN** Q' is selected (Q is excluded by the filter)

### Requirement: `asOf` flows from tool context, not tool arguments

The shared `QueryToolContext` type SHALL gain an optional `asOf?: Date` field. The cron scheduler (in `executeJob` / `executeDynamicJob`) SHALL populate it when the job is being replayed with an explicit `asOf` parameter. The `process_reveal_answers` tool SHALL read this context value to define its effective "now" for `processedAt`-stamping and for the season-status computation. The tool's Zod argument schema SHALL NOT include an `asOf` parameter — the value is always sourced from context.

When `ctx.asOf` is absent, the tool SHALL use real wall-clock `Date.now()`.

#### Scenario: Tool reads asOf from context during replay

- **GIVEN** the cron scheduler invokes a replay with `asOf: <T>`
- **AND** the tool runs in that session
- **THEN** the `processedAt` stamped by the tool equals (approximately) `T.getTime()`
- **AND** the `seasonStatus.isLastFireOfSeason` computation uses `T` as the effective current date

#### Scenario: Tool uses wall-clock time when asOf is absent

- **GIVEN** the tool is invoked outside of a replay context (cron tick, admin Slack invocation)
- **THEN** the `processedAt` stamped by the tool is close to wall-clock `Date.now()`

### Requirement: Idempotency of repeated default-mode calls

In default mode, the tool SHALL be safe to call repeatedly without unintended side effects. After a successful default-mode call that processed question Q, a second default-mode call on the same game SHALL return `reveals: []` (because Q now has `processedAt` set) — it SHALL NOT redo Q's processing, SHALL NOT re-write Q's answers, and SHALL NOT re-stamp Q's `processedAt`.

A repeated call MAY still observe other side-effecting changes if new state has accrued between calls (e.g. new questions posted, new cheats flagged, new season transitions) — idempotency applies to the previously-processed question, not to the entire system state.

#### Scenario: Second default-mode call after a successful first call returns empty reveals

- **GIVEN** the first call processed question Q and stamped its `processedAt`
- **WHEN** a second default-mode call is made immediately afterward and no other questions are pending
- **THEN** `reveals` is `[]`
- **AND** Q's `processedAt` is unchanged from the value stamped by the first call

### Requirement: Tool registration retains existing hot-path tools for ad-hoc use

The introduction of `process_reveal_answers` SHALL NOT remove the registration of any existing trivia or clack tool. `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, and `check_season_status` SHALL remain registered with their current behavior and role tiers, available for ad-hoc admin queries. They simply leave the cron-driven reveal hot path. `fetch_channel_messages` (on the clack core MCP server) is similarly unaffected.

#### Scenario: Existing tools remain callable

- **GIVEN** the trivia plugin loaded with the new `process_reveal_answers` tool registered
- **WHEN** Claude (in any session with sufficient role) attempts to call `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, or `check_season_status`
- **THEN** the call resolves to the existing tool implementation with unchanged behavior
