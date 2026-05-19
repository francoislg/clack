## REMOVED Requirements

### Requirement: Send Questions Instructions Tool

**Reason**: The `send_questions_instructions` MCP tool existed solely to back the thin-dispatcher cron prompt. With config-driven schedules and embedded prompts at reconcile time, the wrapper has no consumer.

**Migration**: The prompt text moved into the `SEND_QUESTIONS_INSTRUCTIONS` constant exported by `src/plugins/trivia/scheduledPrompts.ts`. The trivia plugin's reconcile loop reads it directly when constructing each game's question spec.

### Requirement: Process Responses Instructions Tool

**Reason**: Same as above — the wrapper is unused.

**Migration**: The prompt-building helper `getProcessResponsesInstructions(seasonsEnabled)` in `src/plugins/trivia/scheduledPrompts.ts` returns the substantive text (seasons-aware). The trivia reconcile loop calls it when building each game's reveal spec.

### Requirement: Create Schedules Instructions Tool

**Reason**: The admin-facing setup wizard is replaced by config-driven setup. Admins declare games in `config.trivia.games[]`; the plugin creates the schedules. The interactive recipe is no longer needed.

**Migration**: Admins switch to editing `data/config.json`. The legacy migration converts pre-existing trivia cron jobs into config entries automatically, so existing deployments do not need manual recreation.

### Requirement: Schedule Prompts Are Thin Dispatchers

**Reason**: With substantive prompts embedded at reconcile time, the thin-dispatcher pattern no longer exists.

**Migration**: The legacy migration converts dispatcher-style cron jobs to `config.trivia.games[]` entries; the next reconcile creates plugin-managed jobs with the full embedded prompts.

### Requirement: Existing Trivia Cron Jobs Remain Functional

**Reason**: The compatibility-shim requirement (which kept inline fat-prompt cron jobs running during the dispatcher transition) is no longer applicable.

**Migration**: The blocking legacy migration handles every dispatcher-style job. Inline fat-prompt jobs are left in place with a per-job warning; operators decide whether to delete or keep them.

## ADDED Requirements

### Requirement: Legacy Trivia Cron Migration

A blocking migration SHALL run at boot to convert pre-existing dispatcher-style trivia cron jobs into `config.trivia.games[]` entries and delete them from `cron-jobs.json`. The migration SHALL be idempotent and safe to run multiple times.

A cron job is considered a candidate iff `plugin === "trivia"` AND `prompt` matches one of the known dispatcher patterns (e.g., `"Call send_questions_instructions and follow"` or `"Call process_responses_instructions and follow"`).

For each pair of candidates sharing the same `channel` (one question + one reveal), the migration SHALL:
1. Derive a `name` — when not derivable from job metadata, generate `"legacy-<channel>"` or `"legacy-N"`.
2. Append a `TriviaGame` entry to `config.trivia.games[]` with `channel`, `questionCron` (the earlier-firing one), `revealCron` (the later one), and `timezone` (from the first matched job).
3. Delete both source jobs from `cron-jobs.json`.

#### Scenario: Dispatcher pair migrates cleanly

- **GIVEN** two cron jobs in channel `C123` with `plugin === "trivia"`, one having `prompt` matching the question dispatcher and `cronExpression: "0 9 * * 1-5"`, the other matching the reveal dispatcher with `cronExpression: "0 15 * * 1-5"`
- **WHEN** the migration runs
- **THEN** `config.trivia.games[]` gains an entry matching `{ name: <derived>, channel: "C123", questionCron: "0 9 * * 1-5", revealCron: "0 15 * * 1-5", timezone: <inherited> }`
- **AND** both source jobs are removed from `cron-jobs.json`

#### Scenario: Inline fat-prompt legacy job is left in place

- **GIVEN** a cron job with `plugin === "trivia"` whose `prompt` is a heavily customized multi-line text (not a known dispatcher pattern)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated
- **AND** a warning is logged identifying the job by `id` and channel
- **AND** the job persists in `cron-jobs.json` and continues to fire on its current schedule

#### Scenario: Migration is idempotent

- **GIVEN** the migration has run once and converted all candidates
- **WHEN** the migration runs again on the next boot
- **THEN** no candidates are found
- **AND** the migration is a no-op (no writes to either file)

#### Scenario: Unpaired candidate is flagged

- **GIVEN** a single dispatcher-style job in channel `C123` with no matching pair (only a question, no reveal — or vice versa)
- **WHEN** the migration runs
- **THEN** the job is NOT migrated (a `TriviaGame` requires both question and reveal crons)
- **AND** a warning is logged identifying the orphan job's `id` and channel
- **AND** the job continues to fire
