## MODIFIED Requirements

### Requirement: Skip Response Trigger Gating

The `skip_response` and `disengage` parameters SHALL only be available in the `submit_response` schema when the session's trigger type allows skipping. The `scheduled` trigger SHALL additionally allow `skip_response` when the underlying cron job defines a non-empty `skipConditions` field.

These auto-derivation rules SHALL apply only when the underlying cron job's `submitResponseMode` field is unset. When `submitResponseMode` is set, it takes precedence:

- `submitResponseMode === "always"` → `skip_response` SHALL NOT be in the schema, regardless of trigger type or `skipConditions`.
- `submitResponseMode === "optional"` → `skip_response` SHALL be in the schema as an optional boolean, regardless of trigger type or `skipConditions`.
- `submitResponseMode === "skipped"` → the entire `submit_response` schema is replaced by the skipped-only variant (see the `submit-response-mode` capability). The `disengage` parameter is NOT in the skipped-only schema.

The `disengage` parameter follows its own trigger-gating rules (`shouldAllowDisengage`) and SHALL NOT appear in the skipped-only schema regardless of trigger type.

#### Scenario: skip_response and disengage available for autoRespond

- **WHEN** the session's trigger type is `"autoRespond"`
- **AND** the underlying cron job has no `submitResponseMode` (autoRespond is not a cron trigger; this scenario applies generally)
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response and disengage available for threadReply

- **WHEN** the session's trigger type is `"threadReply"`
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema includes the `disengage` boolean parameter

#### Scenario: skip_response available for scheduled runs with skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has a non-empty `skipConditions` string
- **AND** the originating cron job has no `submitResponseMode` set (undefined)
- **THEN** the `submit_response` tool schema includes the `skip_response` boolean parameter
- **AND** the schema does NOT include the `disengage` boolean parameter (disengage is only meaningful for tracked-conversation triggers)

#### Scenario: Skip still enforces requiredTools gate

- **WHEN** a scheduled session has both `skipConditions` and non-empty `requiredTools`
- **AND** Claude calls `submit_response` with `skip_response: true` before calling every required tool
- **THEN** `submit_response` SHALL return the existing `requiredTools` gate error (missing tools listed) and NOT accept the skip
- **AND** Claude is expected to call the missing tool(s) and then retry with `skip_response: true`
- **AND** this matches today's behavior: the `requiredTools` gate runs before the skip branch, so a skip cannot bypass obligations the operator declared for the run
- **AND** this scenario applies identically when `submitResponseMode === "skipped"` and `requiredTools` is non-empty

#### Scenario: skip_response not available for scheduled runs without skipConditions

- **WHEN** the session's trigger type is `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty string)
- **AND** the originating cron job has no `submitResponseMode` set (undefined)
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

#### Scenario: skip_response not available for explicit triggers

- **WHEN** the session's trigger type is `"reactions"`, `"directMessages"`, `"mentions"`, or any other explicit trigger
- **THEN** the `submit_response` tool schema does NOT include the `skip_response` parameter
- **AND** does NOT include the `disengage` parameter

#### Scenario: submitResponseMode "always" suppresses skip_response despite skipConditions

- **GIVEN** a scheduled cron job with `submitResponseMode: "always"` AND a non-empty `skipConditions`
- **WHEN** the run fires and the schema is built
- **THEN** the schema does NOT include `skip_response`
- **AND** the mode overrides the `skipConditions`-derived rule

#### Scenario: submitResponseMode "optional" exposes skip_response without skipConditions

- **GIVEN** a scheduled cron job with `submitResponseMode: "optional"` AND no `skipConditions`
- **WHEN** the run fires and the schema is built
- **THEN** the schema includes `skip_response` as an optional boolean
- **AND** the mode overrides the absence of `skipConditions`

#### Scenario: submitResponseMode "skipped" replaces the schema entirely

- **GIVEN** a scheduled cron job with `submitResponseMode: "skipped"`
- **WHEN** the run fires
- **THEN** the `submit_response` tool schema is the skipped-only variant (see the `submit-response-mode` capability)
- **AND** the schema includes ONLY `skip_response: z.literal(true)`
- **AND** the schema does NOT include `blocks`, `actions`, `table`, `reactions`, `message`, `post_top_level`, or `disengage`

### Requirement: Skip Response Prompt Guidance

The system SHALL include prompt guidance telling Claude when it can skip a response. For auto-respond and thread-reply triggers the guidance applies whenever the conversation does not warrant a reply. For scheduled triggers the guidance is rendered based on the active mode:

- `submitResponseMode === "skipped"` → a `"skipped"`-mode hint is rendered, telling Claude the run's deliverable comes from another required tool and the only valid `submit_response` call is `{ skip_response: true }`.
- `submitResponseMode === "optional"` OR (unset AND `skipConditions` is set) → today's `skipConditions` pre-check guidance is rendered (when `skipConditions` is set) or a generic optional-skip hint is rendered (when `submitResponseMode === "optional"` but no `skipConditions`).
- `submitResponseMode === "always"` OR (unset AND no `skipConditions`) → no skip-related guidance is rendered.

#### Scenario: Auto-respond prompt includes skip guidance

- **WHEN** the delivery context prompt is built for a session with triggerType `"autoRespond"` or `"threadReply"`
- **THEN** the prompt includes guidance that Claude can use `skip_response` when users are talking to each other and not following up on what Clack said
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt includes skipConditions pre-check

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job defines a non-empty `skipConditions` string
- **AND** the originating cron job has no `submitResponseMode` set (undefined)
- **THEN** the prompt includes a pre-check section instructing Claude to evaluate the provided conditions before any other work
- **AND** the prompt includes the verbatim `skipConditions` text supplied by the operator
- **AND** the prompt tells Claude to call `submit_response` with `skip_response: true` when any condition applies
- **AND** the prompt does NOT include the exact safeguard acknowledgment string

#### Scenario: Scheduled prompt omits skip guidance when skipConditions is absent

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job has no `skipConditions` (unset or empty)
- **AND** the originating cron job has no `submitResponseMode` set (undefined)
- **THEN** the prompt does NOT include any skip-related guidance

#### Scenario: Scheduled prompt renders skipped-mode hint

- **WHEN** the delivery context prompt is built for a session with triggerType `"scheduled"`
- **AND** the originating cron job has `submitResponseMode: "skipped"`
- **THEN** the prompt includes a `"skipped"`-mode hint explaining that the run's deliverable is produced by another required tool
- **AND** the hint tells Claude that the only valid `submit_response` call is `{ skip_response: true }` and that the schema rejects any other fields
- **AND** the skipConditions pre-check guidance is NOT rendered (even if `skipConditions` is also set; the strict-skip semantic makes pre-check moot)
