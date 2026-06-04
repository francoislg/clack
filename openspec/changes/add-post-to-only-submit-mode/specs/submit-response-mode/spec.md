## ADDED Requirements

### Requirement: submit_response Schema Variant for "optional-post-to" Mode

When the active run's `submitResponseMode === "optional-post-to"`, the `submit_response` tool SHALL use a Zod schema that exposes EXACTLY two fields:

```ts
{
  skip_response?: z.literal(true);   // optional terminator
  actions: <actions schema including the post_to action>;
}
```

The schema SHALL include `actions` (so `post_to` actions are valid) and an OPTIONAL `skip_response`. It SHALL NOT include `blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`, or the top-level `additional_messages` / `thread_replies` fields (a `post_to` action carries its own `additional_messages` / `thread_replies`). Any excluded key in the input SHALL be rejected at the Zod boundary.

This is the middleground between `"optional"` (full primary schema, may skip) and `"skipped"` (terminator only): a run delivers by emitting one or more `post_to` actions — each carrying its own explicit `channel` — OR terminates with `skip_response: true`.

#### Scenario: Optional-post-to schema accepts a post_to action

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({ actions: [{ type: "post_to", channel: "C123", blocks: [...], auto: true }] })`
- **THEN** the call passes Zod validation
- **AND** the handler auto-executes the `post_to` action and posts the message
- **AND** the run is recorded with `status: "success"` and `responseTs` from the `post_to` post

#### Scenario: Optional-post-to schema accepts a bare skip

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({ skip_response: true })`
- **THEN** the call passes Zod validation
- **AND** the run is recorded as skipped

#### Scenario: Optional-post-to schema rejects primary delivery fields

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({ blocks: [...] })`
- **THEN** Zod rejects the call citing the unknown `blocks` field
- **AND** the handler is NOT invoked
- **AND** no message is delivered

#### Scenario: Optional-post-to call with neither post_to nor skip records as skipped

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({})` (no `actions`, no `skip_response`)
- **THEN** the handler treats it as a no-op and records the run as skipped
- **AND** no error DM is sent to creator or owner

## MODIFIED Requirements

### Requirement: submitResponseMode Field on Cron Jobs

The `CronJob` data model SHALL accept an optional `submitResponseMode` field with values `"always"`, `"optional"`, `"optional-post-to"`, or `"skipped"`. The field SHALL be optional; absence means today's auto-derivation rules apply (allowSkip derived from triggerType + skipConditions).

```ts
interface CronJob {
  // ... existing fields ...
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
}
```

Each value has a precise semantic:

- `"always"`: the run MUST deliver a response via `submit_response`. The `skip_response` parameter is NOT in the schema. Equivalent to today's default for scheduled runs without `skipConditions`.
- `"optional"`: the run MAY decline delivery via `submit_response({ skip_response: true })`. The `skip_response` parameter IS in the schema, optional. Equivalent to today's behavior for scheduled runs WITH `skipConditions`, but available regardless of whether `skipConditions` is set.
- `"optional-post-to"`: the run has no bound primary channel. The schema exposes `actions` (including `post_to`) and an OPTIONAL `skip_response`, but NOT the primary delivery fields (`blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`). The run delivers via one or more `post_to` actions (each carrying an explicit `channel`) OR terminates with `skip_response: true`. The `optional-` prefix mirrors `"optional"`: skipping is allowed.
- `"skipped"`: the run MUST decline delivery. The `submit_response` schema accepts ONLY `{ skip_response: true }` — `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, and `attention_level` are all absent from the schema and rejected at the Zod boundary. Use when the run's actual deliverable is produced by another tool and `submit_response` is purely a run terminator.

When the field is unset, the existing auto-derivation rules (defined by the `skip-response` capability) apply unchanged.

#### Scenario: Field is optional

- **GIVEN** a `CronJob` row with no `submitResponseMode` field
- **WHEN** the row is loaded from disk
- **THEN** loading succeeds
- **AND** the in-memory record has `submitResponseMode === undefined`

#### Scenario: Field round-trips through persistence

- **GIVEN** a `CronJob` row created with `submitResponseMode: "skipped"`
- **WHEN** the row is serialized and reloaded from `data/state/cron-jobs.json`
- **THEN** the loaded record has `submitResponseMode === "skipped"`
- **AND** the field is present in the serialized JSON

#### Scenario: optional-post-to round-trips through persistence

- **GIVEN** a `CronJob` row created with `submitResponseMode: "optional-post-to"`
- **WHEN** the row is serialized and reloaded from `data/state/cron-jobs.json`
- **THEN** the loaded record has `submitResponseMode === "optional-post-to"`

#### Scenario: Field round-trips through reconcileCronJobs

- **GIVEN** a plugin-managed `CronJob` with `submitResponseMode: "skipped"` whose specKey matches an incoming spec that ALSO sets `submitResponseMode: "skipped"`
- **WHEN** `reconcileCronJobs` runs
- **THEN** the persisted record's `submitResponseMode` remains `"skipped"`
- **AND** `updateJob` is called with the spec's `submitResponseMode`

#### Scenario: Invalid value is rejected at config load

- **GIVEN** a cron-jobs.json row containing `submitResponseMode: "bogus"` (not one of the four valid values)
- **WHEN** the row is loaded
- **THEN** a warning is logged identifying the offending field and row
- **AND** the field is dropped from the in-memory record (or the row is rejected, matching how other invalid-typed cron fields are handled today)

### Requirement: Mode Precedence Over Auto-Derivation

When `submitResponseMode` is set on a cron job, it SHALL take precedence over the existing auto-derivation rules in `computeAllowSkip` (which currently derives `allowSkip` from `triggerType` and `skipConditions`).

Resolution table:

| `submitResponseMode` | `skipConditions` | Effective behavior                                                  |
| -------------------- | ---------------- | ------------------------------------------------------------------ |
| `"always"`           | any              | `allowSkip = false`. No `skip_response` in schema.                 |
| `"optional"`         | any              | `allowSkip = true`. `skip_response` in schema, optional.           |
| `"optional-post-to"` | any              | Optional-post-to schema (`actions` + optional `skip_response`, no primary fields). |
| `"skipped"`          | any              | Skipped-only schema. `allowSkip` is moot.                          |
| unset                | non-empty        | Today's behavior: `allowSkip = true`.                              |
| unset                | empty/absent     | Today's behavior: `allowSkip = false` (for scheduled trigger).     |

When the mode is set, `skipConditions` is still honored as guidance (the prompt builder may inject pre-check instructions when both are configured), but the schema gating is decided solely by the mode.

#### Scenario: Mode "always" overrides skipConditions

- **GIVEN** a cron job with `submitResponseMode: "always"` AND `skipConditions: "no PRs merged today"`
- **WHEN** the run fires and the session's `submit_response` schema is built
- **THEN** the schema does NOT include `skip_response`
- **AND** Claude cannot decline delivery even though `skipConditions` is set

#### Scenario: Mode "optional" works without skipConditions

- **GIVEN** a cron job with `submitResponseMode: "optional"` AND no `skipConditions`
- **WHEN** the run fires and the session's `submit_response` schema is built
- **THEN** the schema includes `skip_response` as an optional boolean

#### Scenario: Mode "optional-post-to" exposes actions and optional skip

- **GIVEN** a cron job with `submitResponseMode: "optional-post-to"`
- **WHEN** the run fires and the session's `submit_response` schema is built
- **THEN** the schema includes `actions` (with the `post_to` action) and an optional `skip_response`
- **AND** the schema does NOT include `blocks`, `message`, `table`, `reactions`, `post_top_level`, or `attention_level`

#### Scenario: Unset mode preserves today's behavior

- **GIVEN** a scheduled cron job with `submitResponseMode` unset AND no `skipConditions`
- **WHEN** the run fires
- **THEN** the schema does NOT include `skip_response` (today's behavior)
- **AND** behavior is byte-identical to the pre-change implementation

### Requirement: Channelless Delivery Context Forces Optional-Post-To Schema

When the active run's delivery context has no bound channel (a channelless dynamic cron job — `job.channel === undefined`), the `submit_response` tool SHALL use the `"optional-post-to"`-shape Zod schema (`actions` + optional `skip_response`, no primary delivery fields). This SHALL hold regardless of the cron job's persisted `submitResponseMode` value (which may be absent, `"always"`, `"optional"`, `"optional-post-to"`, or `"skipped"`). The channelless rule is mechanical: there is no destination for `text` / `blocks` / etc., so the schema MUST NOT offer those fields — but `post_to`, which carries its own explicit `channel`, MUST remain available so the run can deliver.

The schema-selection precedence SHALL be:

1. Channelless delivery context → `"optional-post-to"` shape (mechanical).
2. Otherwise, persisted `submitResponseMode` if set → that shape.
3. Otherwise, auto-derivation rules from the `skip-response` capability.

`post_to` actions are the sole legitimate delivery path in channelless runs. A channelless run that ends with `submit_response({ skip_response: true })` without any `post_to` SHALL be treated as a successful skip (not an error).

#### Scenario: Channelless run gets optional-post-to schema

- **GIVEN** a dynamic cron job with no `channel` field
- **WHEN** the job fires and the `submit_response` Zod schema is assembled for the session
- **THEN** the schema accepts `actions` (including the `post_to` action) and an optional `skip_response: z.literal(true)`
- **AND** the schema rejects `text`, `blocks`, `table`, `reactions`, `message`, `post_top_level`, top-level `additional_messages`, top-level `thread_replies`, and `attention_level`
- **AND** the schema does NOT include any of those rejected keys in its description / parameter list shown to Claude

#### Scenario: Channelless rule overrides persisted submitResponseMode === "always"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"always"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"optional-post-to"`-shape (channelless rule wins)
- **AND** Claude cannot deliver a primary response via `submit_response`, but CAN deliver via `post_to`

#### Scenario: Channelless rule overrides persisted submitResponseMode === "optional"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"optional"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"optional-post-to"`-shape (channelless rule wins)

#### Scenario: Channel-bound run with persisted submitResponseMode still wins for that mode

- **GIVEN** a dynamic cron job with `channel: "C123"` and persisted `submitResponseMode: "always"`
- **WHEN** the job fires
- **THEN** the assembled schema follows the `"always"` shape (NO `skip_response` field)
- **AND** the channelless rule does NOT apply because the delivery context has a bound channel

#### Scenario: Channelless run delivers via post_to

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `submit_response({ actions: [{ type: "post_to", channel: "C456", text: "...", auto: true }] })`
- **THEN** the `post_to` action posts the message
- **AND** the run is recorded with `status: "success"` and `responseTs` from the `post_to` post

#### Scenario: Channelless run without post_to records as skipped

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `submit_response({ skip_response: true })` with no `post_to`
- **THEN** the Zod validation passes
- **AND** the run is recorded with `status: "skipped"` and no `responseTs`
- **AND** no error DM is sent to creator or owner (skip is not a failure)

## RENAMED Requirements

- FROM: `### Requirement: Channelless Delivery Context Forces Skipped-Shape Schema`
- TO: `### Requirement: Channelless Delivery Context Forces Optional-Post-To Schema`
