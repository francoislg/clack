# Optional Baseline Topics (built-in `response-rendering` topic)

## Why

Every query-mode session — including channelless cron fires that end in `skip_response` (idler light sync fires ~12×/day) — pays for ~18k chars of Slack rendering guidance (Block Kit formatting, mrkdwn rules, response style, rich `submit_response` composition) that only sessions actually delivering rich visible messages need. Worker mode is already exempt (it never loads the instruction cascade); the waste is concentrated in scheduled fires. The topic mechanism (`{role}/topics/<topic>/*.md` + `preAttachedTopics` + `attach_integration`) already exists and supports instructions-only attaches — this change reuses it to make a slice of the shipped baseline optional, without degrading any interactive or posting session.

## What Changes

- **New built-in topic `response-rendering`**: move shipped rendering-guidance files from `user/*.md` baseline into `user/topics/response-rendering/`:
  - `block-kit-formatting.md` (moved whole)
  - `slack-formatting.md` (moved whole)
  - `response-style.md` (moved whole)
  - `submit-response.md` **split**: the tool contract (must-call, `skip_response`, gating rules) stays baseline as a thin stub; rich-composition guidance moves into the topic. The stub follows the existing `scheduling.md` pointer pattern and includes a hint to `attach_integration("response-rendering")` before composing rich output.
- **Auto-attach rule**: every interactive trigger (`directMessages`, `mentions`, `reactions`, `autoRespond`, `threadReply`) auto-attaches `response-rendering` at session start. `scheduled` sessions attach only what the cron job's `attachedTopics` declares. Worker mode is unaffected (no cascade).
- **Cron job topic exposure**: `create_scheduled_message` and `update_scheduled_message` (the cron-job-backed schedule tools) gain an `attached_topics` argument (the persistence layer `CronJob.attachedTopics` already exists). User-created schedules default to `["response-rendering"]` so existing quality is unchanged; plugin specs opt in explicitly via `CronJobSpec.attachedTopics` (unchanged mechanism). Topic names are validated against known topics at write time. `schedule_reminder` is out of scope: it posts via Slack's `chat.scheduleMessage` (no Claude session at delivery), so topics don't apply.
- **Instructions-only catalog entry**: `response-rendering` is registered in the integrations catalog with a description and no MCP server, so Claude can self-attach it mid-session (the `instructions_only` attach path already exists).
- **Validation-error hint**: when `submit_response` validation fails with formatting-class errors (blocks / table / length) AND `response-rendering` is not attached, the error result appends a hint to attach the topic before retrying. Action-class errors (unresolved intent refs, bad channels) never trigger the hint.
- **No forced migration of operator files**: `data/configuration/` baseline overrides stay baseline; operators may classify files into topics opportunistically (already supported).

## Capabilities

### New Capabilities

- `builtin-topics`: the built-in topic concept — shipped topics attached deterministically by trigger type rather than by user opt-in; the `response-rendering` topic content contract; the instructions-only catalog entry; the pre-composition stub hint and the validation-failure hint.

### Modified Capabilities

- `instruction-system`: the shipped baseline set shrinks — rendering files resolve from `user/topics/response-rendering/` instead of `user/*.md`; the `submit-response.md` baseline becomes a contract stub. Cascade override paths for the moved files change accordingly (`data/configuration/user/topics/response-rendering/`).
- `scheduled-messages`: `create_scheduled_message` / `update_scheduled_message` accept `attached_topics`; user-created schedules default to `["response-rendering"]`; names validated against known topics. (`schedule_reminder` — Slack-API one-shots — untouched.)
- `clack-tool-response`: `submit_response` formatting-class validation failures append the attach hint when the topic is not loaded.

## Impact

- `src/claude/promptBuilder.ts` / session-start call sites (`src/slack/handlers/core.ts`): compute default `preAttachedTopics` from trigger type.
- `data/default_configuration/user/`: file moves + `submit-response.md` split (operator overrides on the VM for moved files must be re-homed once at deploy — audit `data/configuration/user/` for overrides of the four files).
- `src/tools/actions/createScheduledMessage.ts`, `src/tools/actions/updateScheduledMessage.ts`: new `attached_topics` arg + validation.
- `src/tools/presentation/submitResponse.ts`: conditional hint on formatting-class validation errors.
- `src/mcp.ts` / `resolveEffectiveRegistry`: code-level default `response-rendering` registry entry (the `DEFAULT_GITHUB_REGISTRY_ENTRY` pattern) — instructions-only, no server.
- Token effect: ~18k chars (~4.5k tokens) removed from every scheduled fire that doesn't opt in; interactive sessions byte-identical in content (loaded via topic instead of baseline).
