## MODIFIED Requirements

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

## ADDED Requirements

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
