## ADDED Requirements

### Requirement: upsert_game CREATE requires an initial season when seasons are enabled

When `trivia.seasons.enabled` is `true`, the `upsert_game` CREATE branch (invoked when the named game does not yet exist) SHALL require an `initialSeason` argument and SHALL write it as the new game's first season entry in the same operation that creates the game — so a seasons-enabled game and its current season come into existence atomically, with no window in which the game exists without a current season.

`initialSeason` is a MINIMAL timeline bootstrap. Its schema is:

- `slug` (required): non-empty kebab-case string, unique within the new game's timeline.
- `expectedEndAt` (required): epoch-millis number; MUST be strictly greater than the resolved `startedAt`.
- `startedAt` (optional): epoch-millis number; defaults to the creation time (`now`) when omitted.

`initialSeason` SHALL NOT accept `categories`, `theme`, `format`, or any cascading axis field — those are tuned after creation in place via `upsert_season`. The created season entry SHALL carry only `slug`, `startedAt`, and `expectedEndAt`, inheriting everything else from the game/workspace cascade.

When `trivia.seasons.enabled` is `false`, the CREATE branch SHALL reject an `initialSeason` argument with a structured error (seasons are off; no timeline exists to seed). When `initialSeason` is supplied to the UPDATE branch (the game already exists), the tool SHALL reject it with a structured error directing the caller to `upsert_season` instead.

When seasons are enabled and the CREATE branch is invoked WITHOUT `initialSeason`, the tool SHALL return a structured error naming the missing field; the game SHALL NOT be created.

#### Scenario: CREATE with seasons enabled requires initialSeason

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** no game named `"ops"` exists
- **WHEN** `upsert_game({ name: "ops", channel: "C1", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: "America/Montreal" })` is called without `initialSeason`
- **THEN** the tool returns a structured error naming `initialSeason` as required
- **AND** no `"ops"` game entry is added to `config.trivia.games[]`

#### Scenario: CREATE with seasons enabled writes the game and first season atomically

- **GIVEN** `trivia.seasons.enabled` is `true`
- **AND** no game named `"ops"` exists
- **WHEN** `upsert_game({ name: "ops", channel: "C1", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: "America/Montreal", initialSeason: { slug: "kickoff-2026", expectedEndAt: <T_future> } })` is called
- **THEN** the `"ops"` game is created in `config.trivia.games[]`
- **AND** `data/plugins/trivia/games/ops/seasons.json` contains exactly one entry with `slug: "kickoff-2026"`, `startedAt` equal to the creation time, and `expectedEndAt: <T_future>`
- **AND** that entry has no `categories`, `theme`, `format`, or axis field

#### Scenario: initialSeason startedAt defaults to now

- **GIVEN** `trivia.seasons.enabled` is `true` and no game named `"ops"` exists
- **WHEN** `upsert_game` CREATE is called with `initialSeason: { slug: "kickoff-2026", expectedEndAt: <T_future> }` and no `startedAt`
- **THEN** the seeded season's `startedAt` equals the creation time
- **AND** the season is the current season immediately

#### Scenario: initialSeason rejected when seasons disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** `upsert_game` CREATE is called with an `initialSeason` argument
- **THEN** the tool returns a structured error stating seasons are disabled
- **AND** no `seasons.json` is written for the game

#### Scenario: initialSeason rejected on UPDATE

- **GIVEN** a game named `"ops"` already exists
- **WHEN** `upsert_game({ name: "ops", initialSeason: { slug: "x", expectedEndAt: <T> } })` is called
- **THEN** the tool returns a structured error directing the caller to `upsert_season`
- **AND** the game's `seasons.json` is unchanged

#### Scenario: initialSeason validates expectedEndAt after startedAt

- **GIVEN** `trivia.seasons.enabled` is `true` and no game named `"ops"` exists
- **WHEN** `upsert_game` CREATE is called with `initialSeason: { slug: "kickoff-2026", startedAt: <T2>, expectedEndAt: <T1> }` where `T1 < T2`
- **THEN** the tool returns a structured validation error
- **AND** no `"ops"` game is created
