## ADDED Requirements

### Requirement: One-Shot Warning on Every submit_response Error

Every error result returned by `submit_response` SHALL carry a fixed reminder stating that the tool is one-shot — that the next call which validates is what the user sees — and that probe, test, or placeholder payloads must never be sent.

The reminder SHALL be carried as its own field on the error object, leaving the existing `error` string and the `details` array (when present) unchanged, so error-shape assertions and single-error string matching continue to hold.

The reminder SHALL be appended uniformly on every error path, including the pending-input gate, the required-tools gate, validation failures, and delivery failures. It SHALL NOT appear on success or skip results.

#### Scenario: Validation failure carries the reminder

- **WHEN** `submit_response` returns a validation error
- **THEN** the error result includes the one-shot reminder field
- **AND** the `error` string itself is unchanged

#### Scenario: Aggregated batch failure carries the reminder

- **WHEN** `submit_response` returns `{ error: "invalid_batch", details: [...] }`
- **THEN** the error result includes the one-shot reminder field
- **AND** the `details` array is unchanged

#### Scenario: Gate rejections carry the reminder

- **WHEN** `submit_response` is refused by the pending-input gate or the required-tools gate
- **THEN** the returned error result includes the one-shot reminder field

#### Scenario: Delivery failure carries the reminder

- **GIVEN** a call whose validation passed
- **WHEN** the deliver callback fails and the tool returns `{ error: "delivery_failed", details: ... }`
- **THEN** the error result includes the one-shot reminder field

#### Scenario: Successful calls carry no reminder

- **WHEN** `submit_response` succeeds, whether by delivering or by skipping
- **THEN** the result contains no reminder field
