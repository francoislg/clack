# trivia-games Specification

## Purpose

Per-game data isolation for the trivia plugin. Games are declarative — defined in `config.trivia.games[]` and reconciled into cron jobs by `buildGameSpecs` on every plugin load — so admins manage the lifecycle by editing config (no `create_game` / `delete_game` MCP tools). Each game owns its own directory under `data/plugins/trivia/games/<name>/` for questions, answers, cheats, and seasons. Categories and users stay global. Every per-game tool takes a required `game: string` argument validated against the registry.

## Requirements

### Requirement: Games registry lives in config

The Trivia plugin SHALL treat `config.trivia.games[]` (defined in `src/config.ts`) as the authoritative registry of trivia games. Each entry SHALL have the shape:

```
{
  name: string,            // unique within games[]; matches ^[a-z0-9-]+$; length 1–32
  channel: string,         // Slack channel ID where this game's scheduled posts live
  questionCron: string,    // cron expression for the daily question
  revealCron: string,      // cron expression for the daily reveal
  timezone: string,        // IANA timezone
  enabled?: boolean        // defaults to true; when false, see "Disabled games" below
}
```

Game lifecycle (create / rename / delete) SHALL be admin-edited config; no MCP tools SHALL be exposed for these operations. The plugin SHALL re-read `config.trivia.games[]` on every plugin load (which happens at every app boot and on config reload) and reconcile cron specs via `sdk.reconcileCronJobs("trivia", ...)`.

#### Scenario: Plugin loads games from config

- **GIVEN** `config.trivia.games[]` contains `[{ name: "main", channel: "C123", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "America/New_York" }]`
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", specs)` is invoked with two cron specs (`main:question`, `main:reveal`) whose prompts reference `game: "main"`

#### Scenario: Empty games list is supported

- **GIVEN** `config.trivia.games[]` is absent or empty
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", [])` is invoked (empty spec list — clears any prior plugin-managed trivia cron jobs)

### Requirement: Name format validation

The `parseTriviaGames` function SHALL reject entries whose `name` does not match `^[a-z0-9-]+$` OR whose `name` length is outside 1–32 chars (inclusive). Rejected entries SHALL be dropped from the parsed result with a logged warning that names the index and the violating value. The existing rejections (non-object entry, missing/non-string name, duplicate name, invalid channel/cron/timezone) SHALL be preserved.

#### Scenario: Valid name accepted

- **WHEN** `parseTriviaGames` parses an entry with `name: "main"`, `name: "staging-feature-x"`, or `name: "test-2026"`
- **THEN** the name passes format validation and the entry is included in the result

#### Scenario: Uppercase rejected

- **GIVEN** an entry with `name: "Main"` or `name: "MAIN"`
- **WHEN** `parseTriviaGames` runs
- **THEN** the entry is dropped from the result
- **AND** a warning is logged identifying the index and the invalid name

#### Scenario: Whitespace rejected

- **GIVEN** an entry with `name: "has spaces"`
- **WHEN** `parseTriviaGames` runs
- **THEN** the entry is dropped from the result with a warning

#### Scenario: Over 32 chars rejected

- **GIVEN** an entry with `name` 33 characters long
- **WHEN** `parseTriviaGames` runs
- **THEN** the entry is dropped from the result with a warning

#### Scenario: Path-traversal characters rejected

- **GIVEN** an entry with `name: "../etc"` or `name: "a/b"`
- **WHEN** `parseTriviaGames` runs
- **THEN** the entry is dropped from the result with a warning

#### Scenario: Existing rejections preserved

- **GIVEN** an entry with duplicate `name` or invalid `channel` / `questionCron` / `revealCron` / `timezone`
- **WHEN** `parseTriviaGames` runs
- **THEN** the entry is dropped with a warning (existing behavior unchanged)

### Requirement: Enabled flag

The `parseTriviaGames` function SHALL accept an optional `enabled: boolean` field on each entry. When absent, the parser SHALL default it to `true`. When present but malformed (non-boolean), the entry SHALL be dropped with a warning, consistent with the parser's drop-on-invalid policy.

When `enabled` is `false` on a game entry:

1. `buildGameSpecs` SHALL skip the entry — no cron jobs are reconciled for it.
2. Per-game write tools (`save_question`, `submit_answers`, `save_cheating`, `upsert_season`, `delete_season`) invoked with that game's `name` SHALL return a structured "game is disabled" error.
3. Per-game read tools (`find_previous_questions`, `get_question_history`, `retrieve_scores`, `list_seasons`, `check_season_status`, `get_ideas`) invoked with that game's `name` SHALL succeed (frozen-archive semantics).
4. `list_games` SHALL exclude the entry from its default response; pass `includeDisabled: true` to surface it.

#### Scenario: Disabled game omitted from cron reconcile

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** the trivia plugin loads
- **THEN** the reconcile spec list does NOT include `retired:question` or `retired:reveal`

#### Scenario: Disabled game refuses writes

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `save_question` is invoked with `game: "retired"` and otherwise-valid args
- **THEN** the tool returns a structured "game is disabled" error
- **AND** no file is created or modified

#### Scenario: Disabled game allows reads

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **AND** `data/plugins/trivia/games/retired/questions.json` contains historical entries
- **WHEN** `find_previous_questions` is invoked with `game: "retired", text: "..."`
- **THEN** the tool succeeds and returns matching entries

### Requirement: Per-game data directory layout

For every entry in `config.trivia.games[]`, the Trivia plugin SHALL store that game's per-game data files under `data/plugins/trivia/games/<name>/` with the file names `questions.json`, `answers.json`, `cheats.json`, and (when `trivia.seasons.enabled`) `seasons.json`. These four files SHALL be the sole storage for that game's questions, answers, cheat reports, and season timeline. Cross-game reads and writes from one game's directory to another are forbidden.

`data/plugins/trivia/categories.json` and `data/plugins/trivia/users.json` SHALL remain at the trivia root and SHALL be global — shared by every game.

#### Scenario: Writes to one game do not appear in another's reads

- **GIVEN** `config.trivia.games[]` contains two entries: `main` and `sandbox`
- **WHEN** `save_question` is called with `game: "sandbox"` and a valid payload
- **THEN** the question is appended to `data/plugins/trivia/games/sandbox/questions.json`
- **AND** the question does NOT appear in `data/plugins/trivia/games/main/questions.json`
- **AND** `find_previous_questions` called with `game: "main"` does NOT return the sandbox question

#### Scenario: Categories and users are shared across games

- **GIVEN** `data/plugins/trivia/categories.json` contains `["Science", "History"]`
- **AND** `data/plugins/trivia/users.json` contains `U123` with `cheatAttempts: 2`
- **WHEN** `save_question(game: "sandbox", ...)` reads category validation
- **THEN** the call reads from the root-level `categories.json` (not a per-game copy)
- **AND** `save_cheating(game: "sandbox", cheaterUserId: "U123", ...)` increments `cheatAttempts` to `3` on the root-level `users.json`

#### Scenario: First write creates the game directory and file lazily

- **GIVEN** `config.trivia.games[]` contains `{ name: "newgame", enabled: true, ... }`
- **AND** `data/plugins/trivia/games/newgame/` does NOT yet exist
- **WHEN** `save_question` is invoked with `game: "newgame"` and a valid payload
- **THEN** `data/plugins/trivia/games/newgame/questions.json` is created with the new question
- **AND** the parent directory is created if missing

### Requirement: Universal `game` argument on per-game tools

Every Trivia plugin MCP tool that reads or writes per-game data SHALL accept a required `game: string` argument. Each such tool SHALL, on every invocation, resolve the name against `config.trivia.games[]` and:

1. Return a structured "unknown game" error if no entry has that `name`.
2. Return a structured "game is disabled" error if the matching entry has `enabled: false` AND the tool is a write tool (per the "Enabled flag" requirement above).
3. Otherwise, route all per-game I/O through `data/plugins/trivia/games/<name>/`.

The per-game tools SHALL be: `get_ideas`, `save_question`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `save_cheating`. When `trivia.seasons.enabled` is `true`, additionally: `check_season_status`, `upsert_season`, `delete_season`, `list_seasons`.

#### Scenario: Unknown game rejected

- **GIVEN** `config.trivia.games[]` contains only `{ name: "main", ... }`
- **WHEN** `find_previous_questions` is called with `game: "ghost"` and any other valid args
- **THEN** the tool returns a structured "unknown game" error
- **AND** no I/O occurs against any `games/*/` directory

#### Scenario: Missing game argument rejected by Zod

- **WHEN** any per-game tool is called without a `game` argument
- **THEN** Zod schema validation fails before any handler logic runs

### Requirement: list_games tool

The Trivia plugin SHALL expose a `list_games` MCP tool gated to the `member` role that returns the list of games from `config.trivia.games[]` AND the workspace tier of the cascading axis configuration so admins can audit every tier without reading `config.json` by hand. The tool SHALL accept one optional argument:

- `includeDisabled` (boolean, optional, default `false`) — when `true`, entries with `enabled: false` are included in the response.

The tool SHALL return:

```
{
  games: Array<{
    name: string,
    channel: string,
    timezone: string,
    enabled: boolean,
    questionCron: string,
    revealCron: string
  }>,
  workspaceDefaults: {
    answersFormat?: TriviaAnswersFormatWeights,
    questionType?: TriviaQuestionTypeWeights,
    freeformAnswerShape?: TriviaFreeformAnswerShapeWeights,
    contexts?: TriviaContextEntry[],
    difficulty?: TriviaDifficultyConfig,
    choices?: TriviaChoicesConfig,
    seasons?: { enabled: boolean, prompt: string },
    offDays?: OffDay[]
  },
  total: number
}
```

Entries SHALL be returned in their config order. The previously-excluded `questionCron` and `revealCron` fields SHALL now be included on every game entry to support configuration audits.

The `workspaceDefaults` block SHALL surface workspace-tier configuration from `config.trivia.*`. Each field SHALL be present in `workspaceDefaults` IF AND ONLY IF `config.trivia` carries an explicit value for it (e.g. `freeformAnswerShape` appears only when `config.trivia.freeformAnswerShape` is set in the loaded config). Absent fields signal that the workspace relies on the built-in cascade default. The block is included unconditionally on every response (possibly as `{}`) so callers can distinguish "workspace had no overrides" from "we forgot to ask".

The tool's description SHALL explicitly state the cascade rule (slot → season → workspace → built-in default) and point Claude at `list_seasons` for the slot + season tiers, so the response can be reasoned about without out-of-band knowledge.

#### Scenario: Default response excludes disabled games

- **GIVEN** `config.trivia.games[]` contains `main` (enabled) and `retired` (`enabled: false`)
- **WHEN** `list_games` is called with no arguments
- **THEN** the response contains exactly one entry with `name: "main"`
- **AND** `total` is 1

#### Scenario: includeDisabled returns the full registry

- **GIVEN** `config.trivia.games[]` contains `main` (enabled) and `retired` (`enabled: false`)
- **WHEN** `list_games` is called with `includeDisabled: true`
- **THEN** the response contains both entries
- **AND** `total` is 2

#### Scenario: Cron expressions and timezone are surfaced per game

- **GIVEN** a game `main` configured with `questionCron: "0 9 * * MON-FRI"` and `revealCron: "0 17 * * MON-FRI"` in `America/Toronto`
- **WHEN** `list_games` is called
- **THEN** the `main` entry's `questionCron` is `"0 9 * * MON-FRI"`
- **AND** the entry's `revealCron` is `"0 17 * * MON-FRI"`
- **AND** the entry's `timezone` is `"America/Toronto"`

#### Scenario: Workspace defaults surface every set axis

- **GIVEN** `config.trivia` has `answersFormat: { boolean: 2, choice: 1, freeform: 0 }` and `freeformAnswerShape: { name: 3, place: 1, phrase: 1, title: 1, date: 0, number: 0, other: 1 }` and `seasons: { enabled: true, prompt: "Monthly" }` but no `questionType`, `contexts`, `difficulty`, or `offDays`
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.answersFormat` matches the stored value
- **AND** `workspaceDefaults.freeformAnswerShape` matches the stored value
- **AND** `workspaceDefaults.seasons` matches the stored value
- **AND** `workspaceDefaults.questionType` is absent
- **AND** `workspaceDefaults.contexts` is absent
- **AND** `workspaceDefaults.difficulty` is absent
- **AND** `workspaceDefaults.offDays` is absent

#### Scenario: Empty workspace defaults still present in response

- **GIVEN** `config.trivia` has no axis configuration set at all (only `games` populated)
- **WHEN** `list_games` is called
- **THEN** the response includes a `workspaceDefaults` key
- **AND** `workspaceDefaults` is `{}` (empty object)

#### Scenario: Empty config returns empty array

- **GIVEN** `config.trivia.games[]` is absent or empty
- **WHEN** `list_games` is called
- **THEN** the response is `{ games: [], workspaceDefaults: {...}, total: 0 }` (workspaceDefaults still reflects workspace tier)

#### Scenario: Tool is gated to member

- **WHEN** a session's user has role `member` or higher
- **THEN** `list_games` appears in the session's MCP catalog

### Requirement: Channel→game inference for reactive sessions

The Trivia plugin SHALL provide a `resolveGameFromChannel(channelId: string)` helper that returns the unique `name` from `config.trivia.games[]` whose `channel` equals `channelId`, or `null` if no entry matches. The helper SHALL NOT consider `enabled: false` entries to be matches (a disabled game's channel is treated as unconfigured for reactive purposes).

The `triviaCheckInstruction` SHALL direct Claude that, in reactive sessions (DM / mention / reaction triggers — i.e. NOT scheduled cron runs which already know their game from the spec), Claude SHALL resolve the channel ID from session context and use that to determine the game before any per-game trivia tool call. When the inference returns `null`, Claude SHALL surface a clear "no trivia game is configured for this channel" error rather than guessing a game name or calling tools without a `game` arg.

#### Scenario: Channel matches a configured game

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", channel: "C123", enabled: true, ... }`
- **WHEN** `resolveGameFromChannel("C123")` is called
- **THEN** the helper returns `"main"`

#### Scenario: Channel matches a disabled game

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", channel: "C456", enabled: false, ... }`
- **WHEN** `resolveGameFromChannel("C456")` is called
- **THEN** the helper returns `null` (disabled games don't count as configured)

#### Scenario: Unconfigured channel returns null

- **GIVEN** `config.trivia.games[]` has no entry with `channel: "C999"`
- **WHEN** `resolveGameFromChannel("C999")` is called
- **THEN** the helper returns `null`

### Requirement: Data-move via migration 019

The pre-existing blocking boot migration `019-trivia-games-migration` SHALL, in a single pass, both (a) convert legacy dispatcher-style trivia cron jobs into `config.trivia.games[]` entries (its original behavior) AND (b) move legacy flat-file trivia data into the per-game directory layout. The two passes run in that order so newly-created `legacy-<channel>` entries are eligible inheritance targets for the data move.

The data-move step SHALL:

1. Check whether any per-game file already exists under `data/plugins/trivia/games/initialgame/`. If yes, the data move is a no-op (idempotent — assume a prior run already migrated).
2. Check whether any of `data/plugins/trivia/{questions,answers,cheats,seasons}.json` exist. If none, the data move is a no-op (no data to migrate).
3. Otherwise select the destination game name in this priority order:
   a. The first newly-created `legacy-<channel>` entry from the cron-jobs step in this same migration run.
   b. The first pre-existing entry in `config.trivia.games[]`.
   c. A new fallback entry `{ name: "initialgame", channel: "C000000000", questionCron: "0 0 * * 0", revealCron: "0 0 * * 0", timezone: "UTC", enabled: false }` appended to `config.trivia.games[]`.
4. Move the present flat files into `data/plugins/trivia/games/<target>/<file>.json` (preserving content byte-for-byte).

The migration SHALL NOT modify `data/plugins/trivia/categories.json` or `data/plugins/trivia/users.json`.

The fallback `initialgame` entry uses placeholder values that parse cleanly (so `parseTriviaGames` does not drop the entry) but `enabled: false` ensures the plugin's cron reconciler does not spawn schedules for it. Operators replace the placeholders and flip `enabled` to `true` when ready to resume scheduled trivia for this game.

#### Scenario: Fresh deployment writes nothing

- **GIVEN** a deployment with no trivia cron jobs, no `config.trivia.games[]` entries, and no flat data files at `data/plugins/trivia/`
- **WHEN** migration 019 runs at boot
- **THEN** the migration is a no-op — no config entries added, no per-game files created

#### Scenario: Flat data + dispatcher schedule → data lands in legacy-<channel>

- **GIVEN** a deployment with dispatcher-style trivia cron jobs for one channel `C123` AND flat data files at `data/plugins/trivia/`
- **WHEN** migration 019 runs at boot
- **THEN** `config.trivia.games[]` gains a single `legacy-c123` entry (lowercased channel) carrying the schedule's cron/timezone
- **AND** the flat data files are moved into `data/plugins/trivia/games/legacy-c123/`
- **AND** no `initialgame` entry is created
- **AND** the source dispatcher cron jobs are deleted from `cron-jobs.json`

#### Scenario: Flat data + no schedule + no config game → fallback initialgame

- **GIVEN** a deployment with flat data files at `data/plugins/trivia/`, no trivia cron jobs, and no pre-existing `config.trivia.games[]` entries
- **WHEN** migration 019 runs at boot
- **THEN** `config.trivia.games[]` gains a single `initialgame` entry with placeholder `channel`, crons, and `enabled: false`
- **AND** the flat data files are moved into `data/plugins/trivia/games/initialgame/`

#### Scenario: Flat data + pre-existing config game → data lands in first entry

- **GIVEN** a deployment with flat data files AND `config.trivia.games[]` containing entries `[main, secondary]`
- **WHEN** migration 019 runs at boot
- **THEN** `config.trivia.games[]` is unchanged (no new entries added)
- **AND** the flat data files are moved into `data/plugins/trivia/games/main/` (the first pre-existing entry)
- **AND** `data/plugins/trivia/games/secondary/` is untouched

#### Scenario: Multi-channel dispatcher + flat data → data lands in the first newly-created legacy entry

- **GIVEN** a deployment with dispatcher-style cron jobs for two channels `CA` and `CB` AND flat data files
- **WHEN** migration 019 runs at boot
- **THEN** `config.trivia.games[]` gains two `legacy-<channel>` entries
- **AND** the flat data files are moved into the FIRST newly-created entry's directory

#### Scenario: Data-move step is idempotent

- **GIVEN** migration 019 has already run once and `data/plugins/trivia/games/initialgame/` contains migrated files
- **AND** the flat files are no longer present (or are present from a partial earlier run)
- **WHEN** migration 019 runs again at a subsequent boot
- **THEN** the data-move step is a no-op — no files are moved or deleted

#### Scenario: Dispatcher schedule + no flat data → step 1 runs, step 2 is a no-op

- **GIVEN** a deployment with dispatcher-style cron jobs for one channel `C123` AND no flat data files
- **WHEN** migration 019 runs at boot
- **THEN** `config.trivia.games[]` gains the `legacy-c123` entry from step 1
- **AND** no per-game data files are created (nothing to migrate)
- **AND** no `initialgame` fallback is created

#### Scenario: Migration runs before the plugin loads

- **GIVEN** migration 019 is registered with `priority: "blocking"`
- **WHEN** the app boots
- **THEN** migration 019 runs to completion BEFORE the trivia plugin's load function executes
- **AND** the plugin observes the post-migration state of `data/plugins/trivia/` and `config.json`
