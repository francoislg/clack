## ADDED Requirements

### Requirement: Channelless Delivery Context Forces Skipped-Shape Schema

When the active run's delivery context has no bound channel (a channelless dynamic cron job — `job.channel === undefined`), the `submit_response` tool SHALL use the same `"skipped"`-shape Zod schema as if the cron job had `submitResponseMode === "skipped"`. This SHALL hold regardless of the cron job's persisted `submitResponseMode` value (which may be absent, `"always"`, `"optional"`, or `"skipped"`). The channelless rule is mechanical: there is no destination for `text` / `blocks` / etc., so the schema MUST NOT offer those fields.

The schema-selection precedence SHALL be:

1. Channelless delivery context → `"skipped"` shape (mechanical).
2. Otherwise, persisted `submitResponseMode` if set → that shape.
3. Otherwise, auto-derivation rules from the `skip-response` capability.

`post_to` actions remain fully available in channelless runs and are the sole legitimate delivery path. A channelless run that ends with `submit_response({ skip_response: true })` without any prior `post_to` SHALL be treated as a successful skip (not an error).

#### Scenario: Channelless run gets skipped-shape schema

- **GIVEN** a dynamic cron job with no `channel` field
- **WHEN** the job fires and the `submit_response` Zod schema is assembled for the session
- **THEN** the schema accepts ONLY `{ skip_response: z.literal(true) }`
- **AND** the schema rejects `text`, `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, `additional_messages`, `thread_replies`, `disengage`
- **AND** the schema does NOT include any of those keys in its description / parameter list shown to Claude

#### Scenario: Channelless rule overrides persisted submitResponseMode === "always"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"always"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"skipped"`-shape (channelless rule wins)
- **AND** Claude cannot deliver text via `submit_response`

#### Scenario: Channelless rule overrides persisted submitResponseMode === "optional"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"optional"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"skipped"`-shape (channelless rule wins)

#### Scenario: Channel-bound run with persisted submitResponseMode still wins for that mode

- **GIVEN** a dynamic cron job with `channel: "C123"` and persisted `submitResponseMode: "always"`
- **WHEN** the job fires
- **THEN** the assembled schema follows the `"always"` shape (NO `skip_response` field)
- **AND** the channelless rule does NOT apply because the delivery context has a bound channel

#### Scenario: Channelless run delivers via post_to then terminates with skip_response

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `post_to({ channel: "C456", text: "..." })`, then `submit_response({ skip_response: true })`
- **THEN** the `post_to` action posts the message
- **AND** the `submit_response` Zod validation passes (it only carries `skip_response: true`)
- **AND** the run is recorded with `status: "success"` and `responseTs` from the `post_to` post

#### Scenario: Channelless run without post_to records as skipped

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `submit_response({ skip_response: true })` with no prior `post_to`
- **THEN** the Zod validation passes
- **AND** the run is recorded with `status: "skipped"` and no `responseTs`
- **AND** no error DM is sent to creator or owner (skip is not a failure)
