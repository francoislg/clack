## ADDED Requirements

### Requirement: Quarantine sidecar load is schema-driven

`readQuarantineRecord` SHALL validate the `.clack-quarantine.json` sidecar against a `QuarantineRecord` zod schema rather than the hand-rolled `isQuarantineRecord` guard, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL return `null` (the worker is simply treated as not quarantined), never throw.

#### Scenario: Malformed sidecar yields null, not a crash

- **WHEN** a worker's quarantine sidecar is missing, not valid JSON, or does not match the `QuarantineRecord` shape
- **THEN** `readQuarantineRecord` returns `null` exactly as today, and the worker pool continues

#### Scenario: A valid sidecar round-trips unchanged

- **WHEN** a sidecar written by `writeQuarantineRecord` (current or older builds) is read back
- **THEN** the parsed `QuarantineRecord` is identical to the pre-migration result
