## Why

Plugin-managed cron jobs (trivia question/reveal/prep, casual-talk schedules, etc.) cannot be triggered on-demand via `run_scheduled_message_now` from the natural discovery paths. Two problems compound: (1) the trivia plugin's `list_games` tool surfaces cron *schedules* but not the job UUIDs needed by `run_scheduled_message_now`, and (2) `list_scheduled_messages` hides plugin-managed jobs by default — even when the caller explicitly passes `plugin: "<name>"` — because the dataset-scope filter (`getJobsByUser`) excludes jobs where `createdBy === null`, leaving the documented `plugin` filter as a no-op without an additional `all: true` flag the description does not mention.

The result: admins ask Claude to "run the prep job to test it" and Claude correctly observes the job exists, then has no actionable handle and proposes hacky workarounds (mutating the cron expression temporarily).

## What Changes

- **Trivia `list_games`** SHALL surface the underlying cron job UUIDs for each registered game: `prepJobId`, `questionJobId`, `revealJobId` (each present IF AND ONLY IF the corresponding spec is registered and resolved via SDK lookup by `{plugin: "trivia", specKey}`).
- **`list_scheduled_messages`** scope behavior reshapes:
  - The `all` argument is renamed to `includeOtherUsers` (admin/owner only). Behavior is unchanged for the rename itself — it still controls whether jobs created by *other users* are surfaced.
  - The default scope changes from "jobs I created" to "jobs I created **plus** all plugin-managed jobs (`createdBy === null`)". Plugin-managed jobs are not anyone's private content — surfacing them by default fixes the `plugin` filter and makes the `pluginManaged` jobs that anyone can see (but only admins can act on, per the existing Pattern A gate) discoverable.
  - Filters (`channel`, `plugin`) SHALL always narrow within the chosen scope. They no longer depend on `includeOtherUsers` to function.
- **BREAKING (tool-schema rename only)**: the `all` argument no longer exists on `list_scheduled_messages`. Callers that previously passed `all: true` migrate to `includeOtherUsers: true`. Internal callers and Claude itself adapt per turn from the tool description; no persisted data references the old name.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tools`: `list_scheduled_messages` requirement reshapes — `all` argument renamed to `includeOtherUsers`; default scope adds plugin-managed jobs; filters always apply within scope.
- `trivia-games`: `list_games` requirement extended — each entry SHALL include cron job UUIDs (`prepJobId`/`questionJobId`/`revealJobId`) when the corresponding cron spec is registered.

## Impact

- **Code**: `src/tools/query/listScheduledMessages.ts` (rename + scope change), `src/plugins/trivia/tools/games/listGames.ts` (new fields, new SDK lookup), `src/plugins/sdk.ts` (potentially a new helper for "find plugin job by specKey" if one doesn't exist — investigate during implementation).
- **Tests**: existing tests for both tools update; new tests cover plugin-managed visibility in the default scope and the renamed `includeOtherUsers` argument.
- **No data migration**: no on-disk state references the `all` argument.
- **Tool description updates**: both tools' Claude-facing descriptions update to match the new behavior. No instruction-file changes (LANGUAGE-directive content is unaffected).
