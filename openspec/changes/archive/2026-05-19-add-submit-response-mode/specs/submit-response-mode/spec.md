## ADDED Requirements

### Requirement: submitResponseMode Field on Cron Jobs

The `CronJob` data model SHALL accept an optional `submitResponseMode` field with values `"always"`, `"optional"`, or `"skipped"`. The field SHALL be optional; absence means today's auto-derivation rules apply (allowSkip derived from triggerType + skipConditions).

```ts
interface CronJob {
  // ... existing fields ...
  submitResponseMode?: "always" | "optional" | "skipped";
}
```

Each value has a precise semantic:

- `"always"`: the run MUST deliver a response via `submit_response`. The `skip_response` parameter is NOT in the schema. Equivalent to today's default for scheduled runs without `skipConditions`.
- `"optional"`: the run MAY decline delivery via `submit_response({ skip_response: true })`. The `skip_response` parameter IS in the schema, optional. Equivalent to today's behavior for scheduled runs WITH `skipConditions`, but available regardless of whether `skipConditions` is set.
- `"skipped"`: the run MUST decline delivery. The `submit_response` schema accepts ONLY `{ skip_response: true }` — `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, and `disengage` are all absent from the schema and rejected at the Zod boundary. Use when the run's actual deliverable is produced by another tool and `submit_response` is purely a run terminator.

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

#### Scenario: Field round-trips through reconcileCronJobs

- **GIVEN** a plugin-managed `CronJob` with `submitResponseMode: "skipped"` whose specKey matches an incoming spec that ALSO sets `submitResponseMode: "skipped"`
- **WHEN** `reconcileCronJobs` runs
- **THEN** the persisted record's `submitResponseMode` remains `"skipped"`
- **AND** `updateJob` is called with the spec's `submitResponseMode`

#### Scenario: Invalid value is rejected at config load

- **GIVEN** a cron-jobs.json row containing `submitResponseMode: "bogus"` (not one of the three valid values)
- **WHEN** the row is loaded
- **THEN** a warning is logged identifying the offending field and row
- **AND** the field is dropped from the in-memory record (or the row is rejected, matching how other invalid-typed cron fields are handled today)

### Requirement: submit_response Schema Variant for "skipped" Mode

When the active run's `submitResponseMode === "skipped"`, the `submit_response` tool SHALL use a Zod schema that accepts ONLY a single field:

```ts
{
  skip_response: z.literal(true);
}
```

The schema SHALL NOT include `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, or `disengage`. Any of those keys in the input SHALL cause Zod to reject the call with an unknown-field error before the handler runs.

#### Scenario: Skipped schema accepts the correct shape

- **GIVEN** an active run with `submitResponseMode === "skipped"`
- **WHEN** Claude calls `submit_response({ skip_response: true })`
- **THEN** the call passes Zod validation
- **AND** the handler proceeds to the requiredTools gate, then to the skip branch
- **AND** the run is recorded as skipped

#### Scenario: Skipped schema rejects extra fields

- **GIVEN** an active run with `submitResponseMode === "skipped"`
- **WHEN** Claude calls `submit_response({ skip_response: true, blocks: [...] })`
- **THEN** Zod rejects the call with an error citing the unknown `blocks` field
- **AND** the handler is NOT invoked
- **AND** no message is delivered

#### Scenario: Skipped schema rejects skip_response: false

- **GIVEN** an active run with `submitResponseMode === "skipped"`
- **WHEN** Claude calls `submit_response({ skip_response: false })`
- **THEN** Zod rejects the call (literal type mismatch)
- **AND** the handler is NOT invoked

#### Scenario: Skipped schema rejects an empty call

- **GIVEN** an active run with `submitResponseMode === "skipped"`
- **WHEN** Claude calls `submit_response({})`
- **THEN** Zod rejects the call (missing required `skip_response`)
- **AND** the handler is NOT invoked

### Requirement: Mode Precedence Over Auto-Derivation

When `submitResponseMode` is set on a cron job, it SHALL take precedence over the existing auto-derivation rules in `computeAllowSkip` (which currently derives `allowSkip` from `triggerType` and `skipConditions`).

Resolution table:

| `submitResponseMode` | `skipConditions` | Effective behavior                                             |
| -------------------- | ---------------- | -------------------------------------------------------------- |
| `"always"`           | any              | `allowSkip = false`. No `skip_response` in schema.             |
| `"optional"`         | any              | `allowSkip = true`. `skip_response` in schema, optional.       |
| `"skipped"`          | any              | Skipped-only schema. `allowSkip` is moot.                      |
| unset                | non-empty        | Today's behavior: `allowSkip = true`.                          |
| unset                | empty/absent     | Today's behavior: `allowSkip = false` (for scheduled trigger). |

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

#### Scenario: Unset mode preserves today's behavior

- **GIVEN** a scheduled cron job with `submitResponseMode` unset AND no `skipConditions`
- **WHEN** the run fires
- **THEN** the schema does NOT include `skip_response` (today's behavior)
- **AND** behavior is byte-identical to the pre-change implementation

### Requirement: requiredTools Gate Runs Before the Skip Branch

The existing `requiredTools` gate on `submit_response` SHALL fire BEFORE the skip branch under all three modes. A `"skipped"` run that has not satisfied `requiredTools` SHALL be rejected with the standard missing-tools error, even when the call is a valid `{ skip_response: true }`.

#### Scenario: Skipped run with unsatisfied requiredTools is rejected

- **GIVEN** an active run with `submitResponseMode: "skipped"` AND `requiredTools: ["mcp__trivia__post_questions"]`
- **AND** `mcp__trivia__post_questions` has NOT been called during this run
- **WHEN** Claude calls `submit_response({ skip_response: true })`
- **THEN** the gate returns the missing-tools error
- **AND** the run is NOT marked as skipped
- **AND** Claude is expected to call `post_questions` and retry

#### Scenario: Skipped run with satisfied requiredTools succeeds

- **GIVEN** an active run with `submitResponseMode: "skipped"` AND `requiredTools: ["mcp__trivia__post_questions"]`
- **AND** `mcp__trivia__post_questions` HAS been called at least once
- **WHEN** Claude calls `submit_response({ skip_response: true })`
- **THEN** the gate passes
- **AND** the skip branch executes
- **AND** the run is recorded as skipped successfully

### Requirement: Prompt Guidance for "skipped" Mode

The prompt builder SHALL include guidance in the scheduled-prompt context when `submitResponseMode === "skipped"` is set. The guidance SHALL instruct Claude that:

1. The run's actual deliverable is produced by one of the required tools (not by `submit_response`).
2. The only valid `submit_response` call is `{ skip_response: true }`, with no other fields.
3. Attempting to include `blocks`, `actions`, or other delivery fields will be rejected at the schema layer.

#### Scenario: Skipped-mode prompt hint is rendered

- **GIVEN** a scheduled session with `submitResponseMode: "skipped"`
- **WHEN** the prompt builder renders the additionalSystemPrompt
- **THEN** the prompt includes a `"skipped"`-mode hint
- **AND** the hint mentions `submit_response({ skip_response: true })` as the run terminator

#### Scenario: Skipped-mode hint is absent for other modes

- **GIVEN** a scheduled session with `submitResponseMode: "always"` (or unset, or "optional")
- **WHEN** the prompt builder renders the additionalSystemPrompt
- **THEN** the prompt does NOT include the `"skipped"`-mode hint

#### Scenario: skipConditions guidance still rendered when applicable

- **GIVEN** a scheduled session with `submitResponseMode: "optional"` AND a non-empty `skipConditions`
- **WHEN** the prompt builder renders the additionalSystemPrompt
- **THEN** the existing `skipConditions` pre-check guidance is rendered
- **AND** the `"skipped"`-mode hint is NOT rendered (since mode is `"optional"`, not `"skipped"`)
