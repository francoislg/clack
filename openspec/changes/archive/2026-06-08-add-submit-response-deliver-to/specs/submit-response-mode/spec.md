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
- `"optional-post-to"`: the run has no bound primary channel. The schema exposes a `deliver_to` array and an OPTIONAL `skip_response`, but NOT the primary delivery fields (`blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`) and NOT the top-level `actions`/`post_to` path. The run delivers via `deliver_to` (one or more entries, each carrying an explicit `channel` and a message-payload `response`) OR terminates with `skip_response: true`. The `optional-` prefix mirrors `"optional"`: skipping is allowed.
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
| `"optional-post-to"` | any              | Optional-post-to schema (`deliver_to` array + optional `skip_response`, no primary fields, no top-level `actions`). |
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

#### Scenario: Mode "optional-post-to" exposes deliver_to and optional skip

- **GIVEN** a cron job with `submitResponseMode: "optional-post-to"`
- **WHEN** the run fires and the session's `submit_response` schema is built
- **THEN** the schema includes `deliver_to` (an array of `{ channel, thread_ts?, response }` entries) and an optional `skip_response`
- **AND** the schema does NOT include `blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`, or a top-level `actions` field

#### Scenario: Unset mode preserves today's behavior

- **GIVEN** a scheduled cron job with `submitResponseMode` unset AND no `skipConditions`
- **WHEN** the run fires
- **THEN** the schema does NOT include `skip_response` (today's behavior)

### Requirement: Channelless Delivery Context Forces Optional-Post-To Schema

When the active run's delivery context has no bound channel (a channelless dynamic cron job — `job.channel === undefined`), the `submit_response` tool SHALL use the `"optional-post-to"`-shape Zod schema (`deliver_to` array + optional `skip_response`, no primary delivery fields). This SHALL hold regardless of the cron job's persisted `submitResponseMode` value (which may be absent, `"always"`, `"optional"`, `"optional-post-to"`, or `"skipped"`). The channelless rule is mechanical: there is no bound destination for `blocks` / etc., so the schema MUST NOT offer those fields — instead `deliver_to` carries an explicit `channel` per entry so the run can deliver.

The schema-selection precedence SHALL be:

1. Channelless delivery context → `"optional-post-to"` shape (mechanical).
2. Otherwise, persisted `submitResponseMode` if set → that shape.
3. Otherwise, auto-derivation rules from the `skip-response` capability.

`deliver_to` is the sole legitimate delivery path in channelless runs. A channelless run that ends with `submit_response({ skip_response: true })` and no `deliver_to` SHALL be treated as a successful skip (not an error). A run that provides NEITHER `deliver_to` nor `skip_response` SHALL be a hard error returned to Claude (never a silent success).

#### Scenario: Channelless run gets optional-post-to schema

- **GIVEN** a dynamic cron job with no `channel` field
- **WHEN** the job fires and the `submit_response` Zod schema is assembled for the session
- **THEN** the schema accepts `deliver_to` (an array of destination entries) and an optional `skip_response: z.literal(true)`
- **AND** the schema rejects `text`, `blocks`, `table`, `reactions`, `message`, `post_top_level`, top-level `actions`, top-level `additional_messages`, top-level `thread_replies`, and `attention_level`
- **AND** the schema does NOT include any of those rejected keys in its description / parameter list shown to Claude

#### Scenario: Channelless rule overrides persisted submitResponseMode === "always"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"always"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"optional-post-to"`-shape (channelless rule wins)
- **AND** Claude cannot deliver a primary response via `submit_response`, but CAN deliver via `deliver_to`

#### Scenario: Channelless rule overrides persisted submitResponseMode === "optional"

- **GIVEN** a channelless dynamic cron job whose persisted `submitResponseMode` is `"optional"`
- **WHEN** the job fires and the `submit_response` schema is assembled
- **THEN** the assembled schema is the `"optional-post-to"`-shape (channelless rule wins)

#### Scenario: Channel-bound run with persisted submitResponseMode still wins for that mode

- **GIVEN** a dynamic cron job with `channel: "C123"` and persisted `submitResponseMode: "always"`
- **WHEN** the job fires
- **THEN** the assembled schema follows the `"always"` shape (NO `skip_response` field)
- **AND** the channelless rule does NOT apply because the delivery context has a bound channel

#### Scenario: Channelless run delivers via deliver_to

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `submit_response({ deliver_to: [{ channel: "C456", response: { blocks: [...] } }] })`
- **THEN** the entry's message is posted to `C456`
- **AND** the run is recorded with `status: "success"` and `responseTs` from the first posted message

#### Scenario: Channelless run without deliver_to records as skipped

- **GIVEN** a channelless dynamic cron job
- **WHEN** the run fires and Claude calls `submit_response({ skip_response: true })` with no `deliver_to`
- **THEN** the Zod validation passes
- **AND** the run is recorded with `status: "skipped"` and no `responseTs`
- **AND** no error DM is sent to creator or owner (skip is not a failure)

### Requirement: submit_response Schema Variant for "optional-post-to" Mode

When the active run's `submitResponseMode === "optional-post-to"`, the `submit_response` tool SHALL use a Zod schema that exposes EXACTLY two fields:

```ts
{
  skip_response?: z.literal(true);   // optional terminator
  deliver_to?: Array<{
    channel: string;                 // REQUIRED explicit destination
    thread_ts?: string;              // optional — reply into this thread vs top-level
    response: MessagePayload;        // shared message-content entity (blocks + thread_replies? + actions? + suppress_unfurls? + reactions?)
  }>;
}
```

The schema SHALL include `deliver_to` and an OPTIONAL `skip_response`. It SHALL NOT include `blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`, a top-level `actions` field, or the top-level `additional_messages` / `thread_replies` fields. Any excluded key in the input SHALL be rejected at the Zod boundary.

The handler SHALL resolve the call to exactly one outcome:

- `deliver_to` present and non-empty → deliver each entry (see the `submit-response-deliver-to` capability); record success.
- `skip_response: true` and no `deliver_to` (or empty `deliver_to`) → record a skip.
- neither `deliver_to` nor `skip_response` (e.g. `submit_response({})`) → a hard error returned to Claude (`recordError`), NOT a silent skip.

This is the middleground between `"optional"` (full primary schema, may skip) and `"skipped"` (terminator only): a run delivers by emitting `deliver_to` entries — each carrying its own explicit `channel` — OR terminates with `skip_response: true`.

#### Scenario: Optional-post-to schema accepts a deliver_to entry

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({ deliver_to: [{ channel: "C123", response: { blocks: [...] } }] })`
- **THEN** the call passes Zod validation
- **AND** the handler delivers the entry's message to `C123`
- **AND** the run is recorded with `status: "success"` and `responseTs` from the first posted message

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

#### Scenario: Optional-post-to call with neither deliver_to nor skip is a hard error

- **GIVEN** an active run with `submitResponseMode === "optional-post-to"`
- **WHEN** Claude calls `submit_response({})` (no `deliver_to`, no `skip_response`)
- **THEN** the handler returns an error to Claude indicating it must provide `deliver_to` or `skip_response`
- **AND** the run is NOT silently recorded as a successful skip
