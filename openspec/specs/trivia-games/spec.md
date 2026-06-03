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
  prepCron?: string,       // OPTIONAL cron expression for pre-staging questions; channelless when emitted
  questionCron: string,    // cron expression for the daily question
  revealCron: string,      // cron expression for the daily reveal
  timezone: string,        // IANA timezone
  enabled?: boolean        // defaults to true; when false, see "Disabled games" below
}
```

Game lifecycle (create / rename / delete) SHALL be admin-edited config; no MCP tools SHALL be exposed for these operations. The plugin SHALL re-read `config.trivia.games[]` on every plugin load (which happens at every app boot and on config reload) and reconcile cron specs via `sdk.reconcileCronJobs("trivia", ...)`.

When `prepCron` is set on a game, the plugin SHALL emit a third cron spec (`<name>:prep`) in addition to the existing `<name>:question` and `<name>:reveal` specs. When `prepCron` is absent, the existing two-spec behavior SHALL be retained.

The `prepCron` value SHALL be validated as a cron expression at parse time. Malformed values SHALL be dropped with a logged warning naming the game and the offending value; the game still loads with the other fields preserved.

#### Scenario: Plugin loads games from config

- **GIVEN** `config.trivia.games[]` contains `[{ name: "main", channel: "C123", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "America/New_York" }]`
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", specs)` is invoked with two cron specs (`main:question`, `main:reveal`) whose prompts reference `game: "main"`

#### Scenario: Plugin loads game with prepCron

- **GIVEN** `config.trivia.games[0] = { name: "main", channel: "C123", prepCron: "30 8 * * *", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "America/New_York" }`
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", specs)` is invoked with three cron specs (`main:prep`, `main:question`, `main:reveal`)
- **AND** the `main:prep` spec is channelless and has a `requiredTools` list that excludes `post_questions`

#### Scenario: Empty games list is supported

- **GIVEN** `config.trivia.games[]` is absent or empty
- **WHEN** the trivia plugin loads
- **THEN** `sdk.reconcileCronJobs("trivia", [])` is invoked (empty spec list — clears any prior plugin-managed trivia cron jobs)

#### Scenario: Malformed prepCron drops the field

- **GIVEN** `config.trivia.games[0].prepCron = "garbage"`
- **WHEN** the games parser runs
- **THEN** the parsed `TriviaGame` has no `prepCron` field
- **AND** a structured warning is logged naming the game name and the offending value
- **AND** the plugin emits two specs (no prep) for that game

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
3. Per-game read tools (`get_question_history`, `retrieve_scores`, `list_seasons`, `check_season_status`, `get_ideas`) invoked with that game's `name` SHALL succeed (frozen-archive semantics). `find_previous_questions` is cross-game by default; when its `games` argument names a disabled entry, it also SHALL succeed.
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
- **WHEN** `find_previous_questions` is invoked with `games: ["retired"], keywords: ["..."]`
- **THEN** the tool succeeds and returns matching entries

### Requirement: Per-game data directory layout

For every entry in `config.trivia.games[]`, the Trivia plugin SHALL store that game's per-game data files under `data/plugins/trivia/games/<name>/` with the file names `questions.json`, `answers.json`, `cheats.json`, and (when `trivia.seasons.enabled`) `seasons.json`. These four files SHALL be the sole storage for that game's questions, answers, cheat reports, and season timeline. Cross-game reads and writes from one game's directory to another are forbidden.

`data/plugins/trivia/categories.json` and `data/plugins/trivia/users.json` SHALL remain at the trivia root and SHALL be global — shared by every game.

#### Scenario: Writes to one game do not appear in another's reads

- **GIVEN** `config.trivia.games[]` contains two entries: `main` and `sandbox`
- **WHEN** `save_question` is called with `game: "sandbox"` and a valid payload
- **THEN** the question is appended to `data/plugins/trivia/games/sandbox/questions.json`
- **AND** the question does NOT appear in `data/plugins/trivia/games/main/questions.json`
- **AND** `find_previous_questions` called with `games: ["main"]` does NOT return the sandbox question

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

Every Trivia plugin MCP tool that reads or writes per-game data — EXCEPT `find_previous_questions`, which is cross-game by default and accepts an optional `games: string[]` per its own capability — SHALL accept a required `game: string` argument. Each such tool SHALL, on every invocation, resolve the name against `config.trivia.games[]` and:

1. Return a structured "unknown game" error if no entry has that `name`.
2. Return a structured "game is disabled" error if the matching entry has `enabled: false` AND the tool is a write tool (per the "Enabled flag" requirement above).
3. Otherwise, route all per-game I/O through `data/plugins/trivia/games/<name>/`.

The single-`game`-arg per-game tools SHALL be: `get_ideas`, `save_question`, `get_question_history`, `submit_answers`, `retrieve_scores`, `save_cheating`. When `trivia.seasons.enabled` is `true`, additionally: `check_season_status`, `upsert_season`, `delete_season`, `list_seasons`. `find_previous_questions` resolves each entry of its optional `games: string[]` array the same way (unknown-name rejection + disabled-allowed read semantics).

#### Scenario: Unknown game rejected

- **GIVEN** `config.trivia.games[]` contains only `{ name: "main", ... }`
- **WHEN** `save_question` is called with `game: "ghost"` and otherwise-valid args
- **THEN** the tool returns a structured "unknown game" error
- **AND** no I/O occurs against any `games/*/` directory

#### Scenario: Unknown name in find_previous_questions games array rejected

- **GIVEN** `config.trivia.games[]` contains only `{ name: "main", ... }`
- **WHEN** `find_previous_questions` is called with `games: ["ghost"]`
- **THEN** the tool returns a structured "unknown game" error citing `"ghost"`
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
    difficultyRatio?: TriviaDifficultyRatioConfig,
    choices?: TriviaChoicesConfig,
    seasons?: { enabled: boolean, prompt: string },
    offDays?: OffDay[]
  },
  total: number
}
```

#### Scenario: list_games returns games and workspace defaults

- **WHEN** a `member`+ user calls `list_games` with no arguments
- **THEN** the response includes a `games` array (each entry carrying `name`, `channel`, `timezone`, `enabled`, `questionCron`, `revealCron`), a `workspaceDefaults` object, and a `total` count
- **AND** entries with `enabled: false` are excluded unless `includeDisabled: true` is passed

### Requirement: list_games surfaces plugin-managed cron job UUIDs

The Trivia plugin's `list_games` tool SHALL surface the underlying cron job UUIDs for each registered game so admins can act on those jobs (e.g., `run_scheduled_message_now({id})`) without a separate `list_scheduled_messages` lookup.

For each game entry, the response SHALL include three optional fields:

- `questionJobId` — the UUID of the cron job registered with `specKey: "<game>:question"`.
- `revealJobId` — the UUID of the cron job registered with `specKey: "<game>:reveal"`.
- `prepJobId` — the UUID of the cron job registered with `specKey: "<game>:prep"`. Present only when the game has `prepCron` set.

Each field SHALL be present IF AND ONLY IF the SDK lookup for the corresponding plugin-owned cron job (matching `plugin === "trivia"` AND `specKey === "<game>:<slot>"`) resolves to a job. The fields SHALL NOT be present when the lookup returns nothing (e.g., transient state between config save and reconcile).

The trivia plugin SHALL resolve these IDs via the plugin SDK, not by reading `data/state/cron-jobs.json` directly.

The trivia plugin SHALL batch the lookup — a single SDK query for all trivia plugin-managed jobs SHALL be used and indexed in-memory by `specKey`, rather than one lookup per game per slot.

#### Scenario: Question and reveal IDs surface for an enabled game

- **GIVEN** a game `daily` with `questionCron: "0 9 * * 1-5"` and `revealCron: "0 15 * * 1-5"` (no `prepCron`)
- **AND** the trivia plugin has reconciled cron jobs for it
- **WHEN** `list_games` is called
- **THEN** the `daily` entry includes `questionJobId` matching the registered job's UUID
- **AND** the entry includes `revealJobId` matching the registered job's UUID
- **AND** the entry does NOT include `prepJobId`

#### Scenario: Prep ID surfaces when prepCron is set

- **GIVEN** a game `daily` with `questionCron`, `revealCron`, AND `prepCron: "45 8 * * 1-5"` set
- **AND** the trivia plugin has reconciled cron jobs for all three slots
- **WHEN** `list_games` is called
- **THEN** the `daily` entry includes `prepJobId` matching the registered prep job's UUID
- **AND** the entry includes `questionJobId` and `revealJobId`

#### Scenario: IDs omitted when reconcile has not yet run

- **GIVEN** a game `daily` exists in `config.trivia.games[]`
- **AND** the SDK lookup for `{plugin: "trivia", specKey: "daily:question"}` returns no job
- **WHEN** `list_games` is called
- **THEN** the `daily` entry does NOT include `questionJobId`
- **AND** the call SHALL NOT error

#### Scenario: Disabled games still surface IDs when requested

- **GIVEN** a game `retired` with `enabled: false` whose cron jobs are still registered
- **WHEN** `list_games` is called with `includeDisabled: true`
- **THEN** the `retired` entry surfaces `questionJobId`, `revealJobId`, and (if `prepCron` is set) `prepJobId`

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

### Requirement: list_games surfaces prepCron

The `list_games` MCP tool SHALL include `prepCron` per-entry in its response when the corresponding `TriviaGame` has `prepCron` set. When the game has no `prepCron`, the field SHALL be omitted from that entry's response (not emitted as `null` or empty string).

#### Scenario: prepCron appears in list_games output

- **GIVEN** `config.trivia.games[0]` has `prepCron: "30 8 * * *"`
- **WHEN** `list_games` is called
- **THEN** the response entry for that game includes `prepCron: "30 8 * * *"` alongside `questionCron`, `revealCron`, `timezone`, and `channel`

#### Scenario: list_games omits prepCron when unset

- **GIVEN** `config.trivia.games[0]` has no `prepCron` field
- **WHEN** `list_games` is called
- **THEN** the response entry for that game does NOT include `prepCron` (not `null`, not empty string — absent)

### Requirement: upsert_game accepts prepCron

The `upsert_game` MCP tool SHALL accept an optional `prepCron: string` argument. When supplied, the tool SHALL validate it as a cron expression in the game's `timezone` and persist it on the game entry. When omitted, the existing field on the game (if any) SHALL be preserved unchanged.

Removing a previously-set `prepCron` SHALL be supported via an explicit empty string or null sentinel value (consistent with how other optional fields are cleared in `upsert_game`).

#### Scenario: upsert_game adds prepCron to an existing game

- **GIVEN** game `main` exists with no `prepCron`
- **WHEN** `upsert_game({ name: "main", prepCron: "30 8 * * *" })` is called
- **THEN** the game's `prepCron` field is set to `"30 8 * * *"`
- **AND** the next plugin reconcile emits three specs for `main` (prep, question, reveal)

#### Scenario: upsert_game rejects invalid prepCron

- **GIVEN** an admin calls `upsert_game({ name: "main", prepCron: "not a cron" })`
- **WHEN** the tool validates the input
- **THEN** the tool returns a validation error citing the invalid cron expression
- **AND** the game's `prepCron` field is unchanged

### Requirement: Management instruction documents prepCron derivation

The trivia management admin instruction SHALL document `prepCron` semantics, including:

- The default convention of 30 minutes before `questionCron`.
- Concrete cron-shift examples for the most common patterns (daily `M H * * *`, weekdays `M H * * 1-5`, weekly `M H * * D`).
- The midnight-crossing edge case and how to handle it (warn the admin, suggest a non-midnight `questionCron`, or accept the previous-day fire).
- The failure-mode guarantee: when prep fails or no `prepCron` is configured, the question cron inline-generates everything.
- The bot does NOT derive `prepCron` automatically — Claude proposes a value at game-setup time via reasoning, and the admin confirms or overrides.

#### Scenario: Admin sets up new game without specifying prepCron

- **GIVEN** an admin invokes the trivia game setup flow via Claude DM without supplying a `prepCron`
- **WHEN** Claude reasons through the management instruction
- **THEN** Claude proposes a `prepCron` 30 minutes before the admin's chosen `questionCron`
- **AND** Claude explains the trade-offs (latency margin, topical freshness) so the admin can adjust
- **AND** the admin can accept, override with a different value, or decline prep entirely

### Requirement: difficultyRatio axis at workspace and per-game tiers

The Trivia plugin's runtime configuration SHALL accept an optional `difficultyRatio` axis at the workspace tier (`config.trivia.difficultyRatio`) and the per-game tier (`config.trivia.games[i].difficultyRatio`). The axis is per-format:

```
TriviaDifficultyRatioConfig = Partial<Record<
  "boolean" | "choice" | "freeform",
  Record<"easy" | "medium" | "hard", number>
>>
```

Each per-format bucket weight map (the inner `{ easy, medium, hard }`) SHALL be validated as non-negative integers with at least one strictly positive entry. Unknown keys SHALL be rejected at config-load time. Missing keys SHALL be tolerated and normalized to weight `0` (matching the existing weighted-axis validator pattern used by `answersFormat` / `questionType` / `freeformAnswerShape`) — admins can write `{ easy: 1, medium: 1 }` to mean "never roll Hard" without having to write `hard: 0` explicitly. An empty inner map (`{}`) and an all-zeros inner map SHALL still be rejected because neither has a strictly positive entry.

Resolution SHALL follow the standard four-tier cascade — slot → season → game → workspace → built-in default — with **whole-object replace per tier**: the first tier that supplies a complete `{ easy, medium, hard }` weight map for the queried format wins; lower tiers do NOT contribute partial values into the resolved triple.

The built-in default SHALL be per-format: `boolean` and `choice` default to `{ easy: 3, medium: 6, hard: 1 }` (preserving the prior effective 30%/60%/10% distribution); `freeform` defaults to `{ easy: 5, medium: 4, hard: 1 }` to skew easier in tandem with the already-easier `DEFAULT_DIFFICULTY_RANGES.freeform` band.

The `list_games` tool SHALL surface `workspaceDefaults.difficultyRatio` IF AND ONLY IF `config.trivia.difficultyRatio` is set in the loaded config (absent fields signal the workspace relies on the cascade default).

#### Scenario: Workspace difficultyRatio surfaces via list_games

- **GIVEN** `config.trivia.difficultyRatio` is `{ boolean: { easy: 1, medium: 1, hard: 1 }, freeform: { easy: 5, medium: 4, hard: 1 } }` (and `choice` is absent)
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.difficultyRatio` matches the stored object exactly, including the absence of the `choice` key

#### Scenario: Workspace difficultyRatio absent when not configured

- **GIVEN** `config.trivia` has no `difficultyRatio` field set
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.difficultyRatio` is absent from the response

#### Scenario: Inner weight map with all-zero weights rejected at load

- **GIVEN** a config file with `trivia.difficultyRatio.boolean = { easy: 0, medium: 0, hard: 0 }`
- **WHEN** the config is loaded
- **THEN** validation fails with a structured error indicating the inner map must have at least one strictly positive weight

#### Scenario: Inner weight map with unknown bucket key rejected at load

- **GIVEN** a config file with `trivia.difficultyRatio.choice = { easy: 1, hard: 1, impossible: 1 }`
- **WHEN** the config is loaded
- **THEN** validation fails with a structured error naming `impossible` as an unknown bucket (allowed: `easy`, `medium`, `hard`)

#### Scenario: Per-game difficultyRatio overrides workspace tier

- **GIVEN** `config.trivia.difficultyRatio.boolean` is `{ easy: 1, medium: 1, hard: 1 }`
- **AND** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].difficultyRatio.boolean` is `{ easy: 0, medium: 1, hard: 0 }`
- **WHEN** `get_ideas(game: "main")` is invoked many times with `suggestedAnswersFormat` resolving to `"boolean"` and no season-tier override
- **THEN** every invocation produces `suggestedDifficulty = "Medium"`

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

### Requirement: liveAnswersVisible field on TriviaGame

`TriviaGame` (entries in `config.trivia.games[]`) SHALL accept an optional `liveAnswersVisible: boolean` field. When present, this value participates in the `liveAnswersVisible` cascade resolved at `post_questions` time (cascade order: `slot → season → game → workspace → default(true)`).

The field SHALL be parsed by `parseTriviaGames` with the following rules:

- Absence is valid — the cascade resolution falls through to workspace config and ultimately to the `true` default.
- Non-boolean values (strings, numbers, null) SHALL be rejected with a logged warning naming the game and the violating value, and the entry's `liveAnswersVisible` SHALL be treated as absent.
- The value SHALL be exposed on the `TriviaGame` shape returned by `parseTriviaGames` so that the cascade resolver can read it.

#### Scenario: Absent field cascades to workspace config

- **GIVEN** `config.trivia.games[]` has `{ name: "main", channel: "C123", ... }` (no `liveAnswersVisible` field)
- **AND** `config.trivia.liveAnswersVisible: true`
- **WHEN** `post_questions` resolves the cascade for a question in this game (no season / slot override)
- **THEN** the stamped value is `true` (workspace default carries through)

#### Scenario: Game-level false beats workspace default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", liveAnswersVisible: false, ... }`
- **AND** `config.trivia.liveAnswersVisible: true`
- **AND** no season / slot override
- **WHEN** `post_questions` resolves the cascade for a question in `main`
- **THEN** the stamped value is `false`

#### Scenario: Non-boolean field is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", liveAnswersVisible: "false", ... }` (string, not boolean)
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged identifying the game name and the invalid type
- **AND** the parsed game has no `liveAnswersVisible` field (treated as absent)

#### Scenario: list_games surfaces the field when set

- **GIVEN** a game with `liveAnswersVisible: false`
- **WHEN** `list_games` runs
- **THEN** the per-game entry in its response includes `liveAnswersVisible: false`

#### Scenario: list_games omits the field when absent

- **GIVEN** a game without an explicit `liveAnswersVisible` value
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include a `liveAnswersVisible` field (no default-injection at read time)

### Requirement: revealResponses field on TriviaGame

`TriviaGame` (entries in `config.trivia.games[]`) SHALL accept an optional `revealResponses: "no" | "just-correctness" | "yes"` field. When present, this value participates in the `revealResponses` cascade resolved at `post_questions` time (cascade order: `slot → season → game → workspace → default("yes")`).

The field SHALL be parsed by `parseTriviaGames` with the following rules:

- Absence is valid — the cascade resolution falls through to workspace config and ultimately to the `"yes"` default.
- Values other than the three string literals (`"no"`, `"just-correctness"`, `"yes"`) SHALL be rejected with a logged warning naming the game and the violating value, and the entry's `revealResponses` SHALL be treated as absent.
- The value SHALL be exposed on the `TriviaGame` shape returned by `parseTriviaGames` so that the cascade resolver can read it.

#### Scenario: Absent field cascades to workspace config

- **GIVEN** `config.trivia.games[]` has `{ name: "main", ... }` (no `revealResponses` field)
- **AND** `config.trivia.revealResponses: "just-correctness"`
- **WHEN** `post_questions` resolves the cascade for a question in this game (no season / slot override)
- **THEN** the stamped value is `"just-correctness"` (workspace carries through)

#### Scenario: Game-level value beats workspace default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: "no", ... }`
- **AND** `config.trivia.revealResponses: "yes"`
- **AND** no season / slot override
- **WHEN** `post_questions` resolves the cascade for a question in `main`
- **THEN** the stamped value is `"no"`

#### Scenario: Invalid string value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: "maybe", ... }`
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged identifying the game name and the invalid value
- **AND** the parsed game has no `revealResponses` field (treated as absent)

#### Scenario: Non-string value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", revealResponses: true, ... }`
- **WHEN** `parseTriviaGames` runs
- **THEN** a warning is logged
- **AND** the parsed game has no `revealResponses` field

#### Scenario: list_games surfaces revealResponses when set

- **GIVEN** a game with `revealResponses: "no"`
- **WHEN** `list_games` runs
- **THEN** the per-game entry in its response includes `revealResponses: "no"`

#### Scenario: list_games omits revealResponses when absent

- **GIVEN** a game without an explicit `revealResponses` value
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include a `revealResponses` field (no default-injection at read time)

### Requirement: Hint axis at workspace and per-game tiers

The Trivia plugin's runtime configuration SHALL accept an optional `hint` axis at the workspace tier (`config.trivia.hint`) and the per-game tier (`config.trivia.games[i].hint`). The axis shape, parser validation, cascade semantics, and runtime behavior are defined in the `trivia-question-hints` capability; this requirement records its placement in the per-game / workspace cascade tiers and its surfacing through `list_games`.

The `list_games` tool SHALL surface `workspaceDefaults.hint` IF AND ONLY IF `config.trivia.hint` is set in the loaded config, mirroring the additive pattern already used for `difficultyRatio`, `format`, `categories`, and `theme`. Each per-game entry's response SHALL include `hint` IF AND ONLY IF the corresponding `config.trivia.games[i].hint` is set.

Resolution at runtime SHALL follow the standard four-tier cascade — `slot → season → game → workspace → built-in default` — with whole-object replace per tier. When no tier sets `hint`, the resolved value SHALL be `{ mode: "none" }` (no hint generated, no hint UI rendered).

#### Scenario: Workspace hint surfaces via list_games

- **GIVEN** `config.trivia.hint` is `{ mode: "button", minDifficulty: "medium" }`
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.hint` matches the stored object exactly

#### Scenario: Workspace hint absent when not configured

- **GIVEN** `config.trivia` has no `hint` field set
- **WHEN** `list_games` is called
- **THEN** `workspaceDefaults.hint` is absent from the response

#### Scenario: Per-game hint surfaces via list_games

- **GIVEN** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].hint === { mode: "inline" }`
- **WHEN** `list_games` is called
- **THEN** the entry for `"main"` includes `hint: { mode: "inline" }` exactly as stored

#### Scenario: Per-game hint overrides workspace tier

- **GIVEN** `config.trivia.hint` is `{ mode: "button" }`
- **AND** `config.trivia.games[0].name === "main"` and `config.trivia.games[0].hint` is `{ mode: "none" }`
- **WHEN** `get_ideas(game: "main")` is invoked with no season-tier hint override
- **THEN** the payload's `suggestedHintMode` is `"none"` (game tier overrode workspace tier — whole-object replace, not field-level merge)

#### Scenario: Per-game hint absent — workspace cascade wins

- **GIVEN** `config.trivia.hint` is `{ mode: "inline", minDifficulty: "hard" }`
- **AND** `config.trivia.games[0].hint` is absent
- **AND** no season is active
- **WHEN** `get_ideas(game: "main")` is invoked and rolls `suggestedDifficulty: "Hard"`
- **THEN** the payload's `suggestedHintMode` is `"inline"`

### Requirement: Per-game and workspace `revealResponses` accept `"just-winners"`

The per-game `revealResponses` field on `TriviaGame` and the workspace-level `config.trivia.revealResponses` field SHALL accept `"just-winners"` in addition to `"no"`, `"just-correctness"`, and `"yes"`. The `upsert_game` and `set_workspace_config` tools SHALL validate and persist the value, and `list_games` SHALL surface it (per-game and in workspace defaults) when set.

#### Scenario: upsert_game persists just-winners

- **WHEN** an admin calls `upsert_game` with `revealResponses: "just-winners"`
- **THEN** the value is validated and written to the game's config
- **AND** `list_games` reports `revealResponses: "just-winners"` for that game

#### Scenario: set_workspace_config persists just-winners default

- **WHEN** an admin calls `set_workspace_config` with `revealResponses: "just-winners"`
- **THEN** the workspace default is persisted as `"just-winners"`

### Requirement: allTimeRow field on TriviaGame and workspace

`TriviaGame` (entries in `config.trivia.games[]`) AND the workspace tier (`config.trivia`) SHALL each accept an optional `allTimeRow: "always" | "never" | "end-of-season-only"` field. The value participates in the `allTimeRow` cascade resolved at reveal time (cascade order: `game → workspace → default("end-of-season-only")`) — there is no season or slot tier. It governs the All-Time leaderboard surface (the normal-reveal `All Time` row and the season-finale All-Time table), per `trivia-seasons`.

The field SHALL be parsed with the following rules:

- Absence is valid — the cascade falls through to workspace config and ultimately to the `"end-of-season-only"` default.
- Values other than the three string literals SHALL be rejected with a logged warning naming the tier (and game, at the game tier) and the violating value; the field SHALL then be treated as absent.
- The value SHALL be exposed on the parsed `TriviaGame` / `TriviaConfig` shapes so the cascade resolver can read it.

The `upsert_game` and `set_workspace_config` MCP tools SHALL accept `allTimeRow` as an optional argument (one of the three literals), persisting it on the game entry / workspace config respectively. Consistent with other optional fields, an explicit `null` SHALL clear a previously-set value, and omission SHALL preserve the existing value.

The `list_games` tool SHALL surface `allTimeRow` per-game when set (omitted from the entry when absent — no default injection at read time) and SHALL surface `workspaceDefaults.allTimeRow` IF AND ONLY IF `config.trivia.allTimeRow` is set in the loaded config.

#### Scenario: Absent field cascades to workspace then default

- **GIVEN** `config.trivia.games[]` has `{ name: "main", ... }` (no `allTimeRow`)
- **AND** `config.trivia` has no `allTimeRow`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `"end-of-season-only"` (the built-in default)

#### Scenario: Game-level value beats workspace

- **GIVEN** `config.trivia.games[]` has `{ name: "main", allTimeRow: "always", ... }`
- **AND** `config.trivia.allTimeRow: "never"`
- **WHEN** the reveal flow resolves the cascade for `main`
- **THEN** the resolved value is `"always"`

#### Scenario: Invalid value is rejected

- **GIVEN** `config.trivia.games[]` has `{ name: "main", allTimeRow: "sometimes", ... }`
- **WHEN** the config is parsed
- **THEN** a warning is logged identifying the game and the invalid value
- **AND** the parsed game has no `allTimeRow` field (treated as absent)

#### Scenario: upsert_game persists allTimeRow

- **WHEN** `upsert_game({ name: "main", allTimeRow: "always" })` is called
- **THEN** the game entry is persisted with `allTimeRow: "always"`

#### Scenario: set_workspace_config persists allTimeRow

- **WHEN** `set_workspace_config({ allTimeRow: "never" })` is called
- **THEN** `config.trivia.allTimeRow` is persisted as `"never"`

#### Scenario: list_games surfaces the field when set

- **GIVEN** a game with `allTimeRow: "always"` and `config.trivia.allTimeRow: "end-of-season-only"`
- **WHEN** `list_games` runs
- **THEN** the per-game entry includes `allTimeRow: "always"`
- **AND** `workspaceDefaults.allTimeRow` is `"end-of-season-only"`

#### Scenario: list_games omits the field when absent

- **GIVEN** a game without an explicit `allTimeRow` and `config.trivia` without `allTimeRow`
- **WHEN** `list_games` runs
- **THEN** the per-game entry does NOT include an `allTimeRow` field
- **AND** `workspaceDefaults.allTimeRow` is absent

### Requirement: list_games surfaces every registry axis

The `list_games` tool SHALL project its per-game `axisOverrides` and top-level `workspaceDefaults` from the shared `AXIS_REGISTRY` rather than a hand-maintained field list, so that every cascading axis present in the registry is surfaced. In particular `promptMedium` SHALL appear in `axisOverrides` when set on a game and in `workspaceDefaults` when set at the workspace tier (closing the prior omission). The present-iff-set rule is unchanged: an axis field appears for a game only when that game's entry literally set it, and in `workspaceDefaults` only when the workspace tier set it.

#### Scenario: promptMedium surfaces at the game tier

- **WHEN** a game sets `promptMedium` and a `member`+ user calls `list_games`
- **THEN** that game's `axisOverrides` includes `promptMedium` with the configured value

#### Scenario: promptMedium surfaces at the workspace tier

- **WHEN** the workspace tier sets `promptMedium` and a `member`+ user calls `list_games`
- **THEN** the response's `workspaceDefaults` includes `promptMedium`

#### Scenario: New axes surface without editing list_games

- **WHEN** a future cascading axis is added to `CascadeAxes` and `AXIS_REGISTRY`
- **THEN** `list_games` surfaces it in `axisOverrides` and `workspaceDefaults` with no edit to `list_games` itself

### Requirement: Per-slot axis overrides resolve from the effective format

Per-slot cascade-axis overrides SHALL be read from the EFFECTIVE format — `season.format` when the active season defines one, otherwise `game.format` — for ALL cascading axes, consistent with how per-slot `categories`/`label` and the post-time axes (`liveAnswersVisible`/`revealResponses`) already resolve. The `CascadeContext.slot` tier SHALL be constructed by a single shared helper used by `get_ideas`, `post_questions`, and `explain_cascade`, so all three resolve the slot tier identically. When a season format is active it REPLACES the game format (the existing effective-format model is unchanged); game-format slots contribute only when no season format is active.

#### Scenario: Game-format slot axis override takes effect

- **WHEN** no season format is active, a game defines `format.questions[0].answersFormat`, and `get_ideas` resolves slot 0
- **THEN** the slot's `answersFormat` override wins (tier `slot`), instead of being ignored

#### Scenario: Season format still wins when present

- **WHEN** an active season defines a `format` and the game also defines one
- **THEN** the slot tier resolves from the season's format slots, and the game's format slots do not contribute

#### Scenario: All three consumers agree on the slot tier

- **WHEN** `get_ideas`, `post_questions`, and `explain_cascade` build a context for the same `(game, slot)`
- **THEN** they produce the same `slot` tier object via the shared `buildCascadeContext` helper

#### Scenario: Out-of-range slot index yields no slot tier

- **WHEN** a slot index is not present in the effective format (or no format is active)
- **THEN** the `slot` tier is `null` and resolution proceeds from season → game → workspace → default (the tools' existing range validation rejects an explicit out-of-range `slot` argument before resolution)

### Requirement: upsert_game surfaces cascade shadowing

`upsert_game` writes the GAME tier, so a written field is "shadowed" when the cascade's winning tier for that field is strictly ABOVE `game` — the active `season`, or (for a game that has its own `format`) a per-`slot` override that masks the game's top-level value. When any written field (a cascading axis or the `format` pseudo-field) is shadowed, the tool SHALL include a `shadowedBy` object in its result: `{ tier: "season" | "slot", slug?: string, fields: string[] }`. `fields` SHALL be a string array of the shadowed field names, with `"format"` appearing as a string pseudo-field entry (resolved via `resolveEffectiveFormat`, not the axis registry); `slug` is present only for `tier: "season"`. The tool SHALL only DETECT and REPORT shadowing — it SHALL NOT mutate the season. When no written field is shadowed, `shadowedBy` is omitted.

#### Scenario: Season-shadowed game edit is reported

- **WHEN** an active season sets `answersFormat` and an admin calls `upsert_game(name, { answersFormat })`
- **THEN** the result includes `shadowedBy: { tier: "season", slug, fields: ["answersFormat"] }`

#### Scenario: Format shadowing is reported as a string pseudo-field

- **WHEN** an active season defines a `format` and an admin calls `upsert_game(name, { answersFormat, format })` with both shadowed
- **THEN** `shadowedBy.fields` is the string array `["answersFormat", "format"]` (not a nested object)

#### Scenario: A game's own format slot shadows its top-level axis

- **WHEN** no season is active, a game has a `format` whose slot overrides `answersFormat`, and an admin calls `upsert_game(name, { answersFormat })`
- **THEN** the result reports `shadowedBy: { tier: "slot", fields: ["answersFormat"] }` (no `slug`)

#### Scenario: No active season and no masking slot reports nothing

- **WHEN** the timeline is in a gap (no active season) and no game-format slot overrides the written field
- **THEN** `shadowedBy` is omitted

#### Scenario: Unshadowed edit reports nothing

- **WHEN** an admin edits a game field that no higher tier overrides
- **THEN** the result omits `shadowedBy`

### Requirement: Game-authoritative write default

The admin management instruction SHALL direct that game configuration edits default to the GAME tier (`upsert_game` / `set_workspace_config`), and that a season override (`upsert_season`) is written ONLY when the admin explicitly scopes a change to the current or a specific season. When a game edit is shadowed by an active season, the instruction SHALL direct Claude to surface the shadow and offer to apply the change to the current season too (per the trivia-seasons clear-to-inherit behavior).

#### Scenario: Default edit targets the game

- **WHEN** an admin says "make this game's questions harder" with no season qualifier
- **THEN** Claude edits the game tier (`upsert_game`), not the active season

#### Scenario: Explicit season scope targets the season

- **WHEN** an admin says "for THIS season, switch to image questions"
- **THEN** Claude writes the season override (`upsert_season`)

### Requirement: format axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `format: SeasonFormat` field on each entry of `config.trivia.games[]` (per-game tier). When present, the field MUST conform to the same shape and invariants enforced for the season-tier `format`:

```
format: {
  questions: Array<{
    label?: string,
    categories?: string[],
    answersFormat?: Record<"boolean" | "choice" | "freeform", number>,
    questionType?: Record<"fact" | "topical", number>,
    freeformAnswerShape?: Record<TriviaFreeformAnswerShape, number>,
    contexts?: Array<{ name: string; weight?: number }>,
    difficulty?: TriviaDifficultyConfig,
    difficultyRatio?: TriviaDifficultyRatioConfig
  }>
}
```

`parseTriviaGames` SHALL validate the field by delegating to the same `validateFormat` function used by `upsert_season`. When validation fails, the field SHALL be dropped (only the invalid field — the rest of the game entry survives) with a logged issue naming the field and the validator's error message. This matches the lenient axis-bag policy (`parseTriviaAxisBag`) and contrasts with the strict drop-the-whole-entry policy used for scheduling fields like `name` / `channel` / `cron` / `timezone` / `enabled`.

Resolution SHALL place the per-game tier between season and the single-question fallback. The effective format for a question-cron fire SHALL be the first present tier in the order: `season.format → game.format → (single-question fallback)`. When neither season nor game provides a `format`, the cron fire SHALL post a single question (pre-format behavior).

`list_games` SHALL surface each entry's `format` field IF AND ONLY IF the entry has one set.

#### Scenario: Game without format inherits the historical single-question behavior

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", ... }` with no `format` and no active season with a `format`
- **WHEN** the question cron fires for game `main`
- **THEN** a single question is posted (pre-format behavior unchanged)

#### Scenario: Game with format posts one question per slot

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", format: { questions: [{ label: "Warmup" }, { label: "Choice", answersFormat: { choice: 1 } }] }, ... }` and no active season with a `format`
- **WHEN** the question cron fires for game `main`
- **THEN** exactly two questions are posted in slot order

#### Scenario: Season format wins over game format

- **GIVEN** game `main` has `format: { questions: [{}] }` (one slot) and the active season has `format: { questions: [{}, {}, {}] }` (three slots)
- **WHEN** the question cron fires for game `main`
- **THEN** three questions are posted (season tier wins per the standard cascade)

#### Scenario: Invalid game format field dropped at load

- **GIVEN** `config.trivia.games[0].format.questions` is `[]` (empty)
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `format` field
- **AND** a logged issue names the field `trivia.games[0].format` and the validator error `format.questions must be a non-empty array`

#### Scenario: list_games surfaces per-game format when set

- **GIVEN** game `main` has `format: { questions: [{ label: "Warmup" }] }`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes a `format` field matching the stored value

#### Scenario: list_games omits format when absent

- **GIVEN** game `main` has no `format`
- **WHEN** `list_games` is called
- **THEN** the `main` entry has no `format` key

### Requirement: categories axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `categories: string[]` field on each entry of `config.trivia.games[]` (per-game tier). When present, the field MUST be a non-empty array of strings, deduped (preserving first-occurrence order) by `parseTriviaGames`.

Resolution for a question-cron fire SHALL follow the cascade: `slot.categories → season.categories → game.categories → categories.json`. The game tier sits between the active season and the global `data/plugins/trivia/categories.json` pool. The `save_question validates category` requirement on the `trivia-categories` capability SHALL consult the game tier as part of its active-source-pool resolution.

`list_games` SHALL surface each entry's `categories` field IF AND ONLY IF the entry has one set.

#### Scenario: Game categories override the global pool when no season is active

- **GIVEN** `categories.json` contains `["Science", "History", "Sports"]`
- **AND** `config.trivia.games[0]` is `{ name: "main", categories: ["History"] }`
- **AND** seasons are disabled (or no active season)
- **WHEN** `save_question` is called with `game: "main", category: "Science"`
- **THEN** the tool rejects the call with an error suggesting `add_categories` (the resolved pool for the game is `["History"]`)

#### Scenario: Season categories win over game categories

- **GIVEN** game `main` has `categories: ["History"]`
- **AND** the active season has `categories: ["Marine Biology"]`
- **WHEN** `save_question` is called with `game: "main", category: "History"`
- **THEN** the tool rejects the call (the active source pool is the season's `["Marine Biology"]`)

#### Scenario: Invalid game categories field dropped at load

- **GIVEN** `config.trivia.games[0].categories` is `[]` or contains only empty strings
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `categories` field
- **AND** a logged issue names the field `trivia.games[0].categories`

#### Scenario: list_games surfaces per-game categories when set

- **GIVEN** game `main` has `categories: ["History"]`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes `categories: ["History"]`

### Requirement: theme axis at per-game tier

The Trivia plugin's runtime configuration SHALL accept an optional `theme: string` field on each entry of `config.trivia.games[]` (per-game tier). When present, the value MUST be non-empty after trim. `parseTriviaGames` SHALL trim the value before storing it. When `theme` is present but not a string, or is blank after trim, the field SHALL be dropped (only the invalid field) with a logged issue — matching the lenient axis-bag policy.

Resolution SHALL place the per-game tier directly below the season tier. The effective theme for opener / finale prompt construction SHALL be the first present tier in the order: `season.theme → game.theme → (no theme)`. When neither tier provides a `theme`, no theme line is rendered (pre-theme behavior).

`list_games` SHALL surface each entry's `theme` field IF AND ONLY IF the entry has one set.

#### Scenario: Game theme used when no season theme is set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and no active season (or active season has no `theme`)
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Channel Lore Trivia"` as the theme

#### Scenario: Season theme wins over game theme

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"` and the active season has `theme: "Halloween Spooktacular"`
- **WHEN** an opener or finale is rendered for game `main`
- **THEN** the rendered text references `"Halloween Spooktacular"`

#### Scenario: Blank game theme field dropped at load

- **GIVEN** `config.trivia.games[0].theme` is `"   "` (whitespace only)
- **WHEN** the config is loaded
- **THEN** the entry survives in the parsed result but with no `theme` field
- **AND** a logged issue names the field `trivia.games[0].theme`

#### Scenario: list_games surfaces per-game theme when set

- **GIVEN** game `main` has `theme: "Channel Lore Trivia"`
- **WHEN** `list_games` is called
- **THEN** the `main` entry includes `theme: "Channel Lore Trivia"`

### Requirement: Game config validation is schema-driven

Validation of `TriviaGame` config fields (the axis weight maps, `format`/`slotOverrides` slots, `categories`, `theme`, `instructions`, `additionalInstructions`, per-format `difficulty` ranges) SHALL be expressed as a single rich zod schema per concept that encodes both shape and semantics (trim, dedup-preserving-order, weight maps non-negative with at least one strictly positive, `[min,max]` ranges within 1–10 with min≤max). The system SHALL NOT maintain a second hand-rolled validator layer for the same fields. Both the lenient file-load parser (`parseTriviaGames`) and the strict `upsert_game` tool path SHALL validate against the same schema object via `safeParse`; only the wrapping of the result differs (lenient accumulates + logs, strict rejects).

#### Scenario: A single schema gates both load and tool paths

- **WHEN** the same malformed game field (e.g. an `answersFormat` weight map with all-zero weights) is supplied both via `config.json` at load time and via `upsert_game`
- **THEN** both paths reject it through the same zod schema, the file-load path records a `ParseIssue` and drops the field while keeping the game, and the tool path returns an error result — with no separate hand-rolled validator consulted

#### Scenario: Lenient and strict paths differ only in wrapping

- **WHEN** any invalid field is validated through the file-load path versus the `upsert_game` tool path
- **THEN** both call `safeParse` on the identical schema object, the file-load path accumulates the issue, logs a warning, and drops the field while keeping the rest of the game, and the tool path returns an error result and does NOT apply the change — neither path consults a separate validator, so the two cannot diverge in which inputs they accept

#### Scenario: slotOverrides validated per-slot under numeric-string keys

- **WHEN** a `slotOverrides` record is supplied with a non-numeric key, or with a slot value that fails the slot schema (e.g. an `answersFormat` with no positive weight)
- **THEN** the schema rejects it with a path-labeled error (e.g. `'slotOverrides.2.answersFormat' must have at least one strictly positive weight`), using the same slot schema applied to `format.questions[n]`

#### Scenario: Adding an axis requires only the schema

- **WHEN** a new validated field is added to a slot or game
- **THEN** the validation rule is added in exactly one schema definition and is honored by every consumer, with no parallel `validate*` function to keep in sync

### Requirement: Game config error-message parity is preserved

The migration to schema-driven validation SHALL preserve the existing labeled error-message contract. Rejection messages SHALL retain their `'field.path' must …` form (path prefix supplied by the shared `zodErrorToResult` formatter, per-rule message from the schema), such that existing tests asserting exact error strings continue to pass unchanged.

#### Scenario: Error strings are byte-identical across every rejection mode

- **WHEN** any invalid game field is validated after the migration — including an `answersFormat` weight map with no positive weight, an unknown key in a weight map, a non-integer weight, a `categories` array that dedupes to empty, an empty-after-trim `theme`, and a difficulty range with `min > max`
- **THEN** each returned error string matches the corresponding pre-migration string captured by the characterization test exactly, and the existing per-validator unit tests asserting those strings continue to pass unchanged

