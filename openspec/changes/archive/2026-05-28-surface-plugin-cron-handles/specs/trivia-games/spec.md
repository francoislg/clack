## ADDED Requirements

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
