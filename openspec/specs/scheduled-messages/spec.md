# scheduled-messages Specification

## Purpose
Scheduled message tools allowing users to schedule, list, and cancel future Slack messages via Claude, with timezone-aware scheduling and a configuration gate.
## Requirements
### Requirement: Scheduled Cron-Job Prompt Format Guidance Uses Blocks Vocabulary

Scheduled cron-job prompt text (the `jobs[].prompt` field of `data/state/cron-jobs.json`) SHALL, when it references response formatting, layout, or markdown patterns, use the blocks vocabulary defined in the `clack-tool-response` capability (`header`, `section`, `context`, `divider`, `image`, `fields`). Prompts that do not reference formatting remain free-text instructions for Claude to run at fire time, with delivery handled by `submit_response` as for any other Claude run.

There is no schema change on the `CronJob` type — the `prompt` field remains `string`. This requirement governs the *content* of prompts with format guidance, not the storage shape.

#### Scenario: format-agnostic prompt runs without special handling

- **GIVEN** a cron job whose `prompt` text does not reference response formatting (e.g., "Ask the channel what they worked on yesterday")
- **WHEN** the cron scheduler fires the job
- **THEN** Claude runs with the prompt as input and calls `submit_response` with blocks as with any other trigger
- **AND** the scheduler does not inject any format-specific guidance

#### Scenario: format-guided prompt drives block-aware response

- **GIVEN** a cron job whose `prompt` text references block types (e.g., "Open with a header block summarizing the week; follow with one section per topic")
- **WHEN** the cron scheduler fires the job
- **THEN** Claude runs with the prompt as input and produces a `submit_response` call whose `blocks` array matches the prompt's intent
- **AND** the response is delivered through the standard `submit_response` path

#### Scenario: cron job fires before the enhancement migration has rewritten its prompt

- **GIVEN** a freshly-deployed Clack instance where the enhancement migration has started but not yet processed job `J`
- **AND** job `J`'s `prompt` still contains legacy format guidance (e.g., "respond with bullet points")
- **WHEN** the cron scheduler fires job `J`
- **THEN** Claude receives the legacy prompt text as-is
- **AND** Claude still produces a valid block-based response (the new instruction files teach blocks vocabulary regardless of prompt wording)
- **AND** the response is delivered through `submit_response` with the same block validation as any other trigger
- **AND** the migration eventually reaches job `J` on a subsequent scheduler cycle, rewriting the prompt; the in-flight run is unaffected

### Requirement: Automatic Migration Of Pre-Existing Scheduled Prompts

An enhancement migration SHALL iterate every `jobs[].prompt` entry in `data/state/cron-jobs.json` and, for prompts that reference response formatting, layout, or markdown patterns, rewrite the prompt text so its format guidance uses the new blocks vocabulary. Format-agnostic prompts SHALL be left untouched byte-for-byte. The migration is fully automatic, Claude-powered, runs in enhancement (background) priority, and is idempotent.

#### Scenario: format-agnostic prompt is untouched

- **GIVEN** a persisted cron job with `prompt: "Ask the channel what they worked on yesterday."`
- **WHEN** the enhancement migration runs
- **THEN** the output is byte-for-byte identical to the input
- **AND** the persisted prompt on disk is unchanged

#### Scenario: format-specific prompt is rewritten

- **GIVEN** a persisted cron job with `prompt: "Respond with a bold title and bullet points for each item."`
- **WHEN** the enhancement migration runs
- **THEN** the output replaces "bold title" with a reference to a `header` block (or a titled section), and replaces "bullet points" with a reference to a `section` block containing a markdown list
- **AND** the rewritten text no longer mentions bare markdown/mrkdwn formatting patterns as response guidance
- **AND** the rewritten prompt is persisted back to `data/state/cron-jobs.json` with the rest of the `CronJob` record unchanged
- **AND** the semantic intent (what Claude should communicate) is preserved — only the format guidance is restated in block terms

#### Scenario: migration is idempotent

- **GIVEN** a cron job whose `prompt` already references block types (`header`, `section`, `context`, `divider`)
- **WHEN** the enhancement migration runs a second time on the same prompt
- **THEN** the output is byte-for-byte identical to the input
- **AND** no extra rewrite passes are performed

#### Scenario: migration skips ambiguous prompts safely

- **GIVEN** a prompt where the migration engine cannot determine with confidence whether format guidance is present (e.g., mixed semantic and formatting content, or prompts in non-English text the engine cannot analyze)
- **WHEN** the migration runs
- **THEN** the prompt is left unchanged (migration defaults to preserving intent when uncertain)
- **AND** the skip is logged for observability

#### Scenario: migration continues on per-prompt failure

- **GIVEN** a migration run where one cron job's prompt causes a migration engine failure (e.g., model timeout, parse failure on the engine's response)
- **WHEN** the migration processes prompts sequentially
- **THEN** the failed prompt is logged with its job `id` and error reason
- **AND** the `jobs[].prompt` field on disk is left untouched for that job (no partial write)
- **AND** the migration continues to the next job rather than aborting the whole run
- **AND** on the next startup the migration re-attempts any prompts that previously failed

#### Scenario: migration runs without admin intervention

- **WHEN** the enhancement migration phase starts after startup
- **THEN** the migration executes against all persisted cron-job prompts without prompting administrators
- **AND** does not expose an opt-out per prompt
- **AND** logs its activity for observability but does not surface a summary UI

### Requirement: Schedule a Message

The system SHALL provide a `schedule_reminder` tool that schedules a future message to a Slack channel via `chat.scheduleMessage`.

#### Scenario: Schedule a message with valid parameters

- **WHEN** Claude calls `schedule_reminder` with `channel`, `message`, and `post_at` (ISO 8601 timestamp)
- **THEN** the tool resolves the channel via the shared `resolveChannelId` helper
- **AND** constructs an attributed message: `🔔 Reminder from <@{userId}>:\n{message}`
- **AND** calls `chat.scheduleMessage` with the resolved channel ID, attributed text, and Unix timestamp
- **AND** returns the `scheduled_message_id`, channel, and `post_at` to Claude

#### Scenario: Channel resolution from name

- **WHEN** Claude provides a channel name (e.g., `#ops` or `ops`)
- **THEN** the tool delegates resolution to the shared `resolveChannelId` helper
- **AND** uses the resolved channel ID for scheduling
- **AND** surfaces any resolution error (e.g., channel not found) back to Claude

#### Scenario: Channel provided as channel ID

- **WHEN** Claude provides a channel ID (`C…`, `G…`, or `D…`)
- **THEN** the resolver passes it through unchanged
- **AND** the tool uses it directly for scheduling

#### Scenario: User ID for self-DM

- **WHEN** Claude provides a user ID (`U…`) equal to the requesting user
- **THEN** the resolver opens a DM with that user via `openDmChannel`
- **AND** the tool schedules the message to the resulting DM channel

#### Scenario: User ID for another user rejected

- **WHEN** Claude provides a user ID (`U…`) that does NOT match the requesting user
- **THEN** the resolver returns an error indicating the tool can only DM the requesting user
- **AND** the tool returns the error to Claude without calling `chat.scheduleMessage`

#### Scenario: Scheduling beyond 120-day limit

- **WHEN** the `post_at` timestamp is more than 120 days in the future
- **THEN** the Slack API returns a `time_too_far` error
- **AND** the tool returns this error to Claude
- **AND** Claude communicates the 120-day limit to the user

#### Scenario: Scheduling in the past

- **WHEN** the `post_at` timestamp is in the past
- **THEN** the Slack API returns a `time_in_past` error
- **AND** the tool returns this error to Claude

#### Scenario: Bot not in channel

- **WHEN** the target channel is one the bot is not a member of
- **THEN** the Slack API returns a `channel_not_found` or `not_in_channel` error
- **AND** the tool returns this error to Claude

### Requirement: List Scheduled Messages

The system SHALL provide a `list_reminders` tool that lists all pending scheduled messages via `chat.scheduledMessages.list`.

#### Scenario: List all pending messages

- **WHEN** Claude calls `list_reminders` with no parameters
- **THEN** the tool calls `chat.scheduledMessages.list`
- **AND** returns all pending scheduled messages with their `id`, `channel_id`, `post_at`, `date_created`, and `text`

#### Scenario: Filter by channel

- **WHEN** Claude calls `list_reminders` with an optional `channel` parameter
- **THEN** the tool passes the channel ID to `chat.scheduledMessages.list`
- **AND** returns only messages scheduled for that channel

#### Scenario: No pending messages

- **WHEN** there are no pending scheduled messages
- **THEN** the tool returns an empty list

### Requirement: Cancel a Scheduled Message

The system SHALL provide a `cancel_reminder` tool that cancels a pending scheduled message via `chat.deleteScheduledMessage`.

#### Scenario: Cancel with valid ID

- **WHEN** Claude calls `cancel_reminder` with a `scheduled_message_id` and `channel`
- **THEN** the tool calls `chat.deleteScheduledMessage` with the channel and scheduled message ID
- **AND** returns a success confirmation

#### Scenario: Cancel already-posted message

- **WHEN** the scheduled message has already been posted (past its `post_at` time)
- **THEN** the Slack API returns an `invalid_scheduled_message_id` error
- **AND** the tool returns this error to Claude

#### Scenario: Cancel with invalid ID

- **WHEN** the `scheduled_message_id` does not match any pending message
- **THEN** the Slack API returns an error
- **AND** the tool returns this error to Claude

### Requirement: Timezone-Aware Scheduling

Claude SHALL resolve relative time expressions using the requesting user's Slack timezone.

#### Scenario: User timezone available in context

- **WHEN** Claude prepares a `schedule_reminder` call
- **THEN** the system prompt includes the user's IANA timezone (e.g., `America/New_York`)
- **AND** Claude uses this timezone to convert relative expressions ("tomorrow at 3pm") to an ISO 8601 UTC timestamp

#### Scenario: User timezone unavailable

- **WHEN** the user's timezone could not be resolved from the `UserInfo` cache
- **THEN** Claude asks the user to specify a timezone or provide an absolute time

### Requirement: Configuration Gate

The scheduled message tools SHALL only be available when `config.cron.userSchedules` is `true` AND `config.cron.enabled` is `true`. If `config.cron.enabled` is `false` and `config.cron.userSchedules` is `true`, the system SHALL log a warning at config load and treat `userSchedules` as `false` for the lifetime of that boot.

#### Scenario: Feature disabled (default)

- **WHEN** `config.cron.userSchedules` is not set or is `false`
- **THEN** the tool server does NOT register `schedule_reminder`, `list_reminders`, `cancel_reminder`, `create_scheduled_message`, `cancel_scheduled_message`, `list_scheduled_messages`, `update_scheduled_message`, `run_scheduled_message_now`, or `get_scheduled_message_runs`

#### Scenario: Feature enabled

- **WHEN** `config.cron.userSchedules` is `true`
- **AND** `config.cron.enabled` is `true`
- **AND** a Slack client is available in the tool context
- **THEN** the tool server registers all scheduled-message and reminder tools

#### Scenario: Feature enabled but no Slack client

- **WHEN** `config.cron.userSchedules` is `true`
- **AND** no Slack client is available (e.g., test context)
- **THEN** the tool server does NOT register the scheduled message tools

#### Scenario: Invalid combination coerced

- **WHEN** `config.cron.enabled` is `false`
- **AND** `config.cron.userSchedules` is `true`
- **THEN** the system SHALL log a warning naming both keys
- **AND** treat `userSchedules` as `false` for all gating decisions during that boot
- **AND** the persisted config file is NOT rewritten (the value is coerced in-memory only)

### Requirement: Cron-jobs load is schema-driven

`loadJobs` SHALL parse the cron-jobs store against zod schemas (`CronJobState`/`CronJob`/`CronRun`/`SkipDate`) rather than a blind `as Partial<CronJobState>` cast plus the hand-rolled `sanitizeLoadedJobs` pass. The `submitResponseMode` field SHALL be a `z.enum`, replacing the manual enum sanitize. The contract stays graceful: a missing file, invalid JSON, or shape mismatch SHALL log and return `[]`, never throw. Legacy on-disk jobs (e.g. nameless jobs) SHALL still load.

#### Scenario: Invalid submitResponseMode is handled by the enum, not a manual sanitize

- **WHEN** a stored job carries a `submitResponseMode` value outside the allowed set
- **THEN** the schema rejects/normalizes it equivalently to the pre-migration `sanitizeLoadedJobs` behavior, with the same logged warning intent

#### Scenario: Legacy and current jobs round-trip

- **WHEN** a cron-jobs file written by a prior build (including legacy nameless jobs and populated `runs[]`/`skipDates[]`) is loaded
- **THEN** the returned `CronJob[]` is identical to the pre-migration result; a corrupt file still yields `[]`

