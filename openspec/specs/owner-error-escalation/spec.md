# Owner Error Escalation

## Purpose

Clack SHALL allow Claude to escalate internal system failures to the workspace owner via an optional field on `submit_response`, so that unrecoverable tool errors, misconfigurations, and credential failures are surfaced to the operator (not the end user) for timely remediation, while normal user-facing outcomes continue to be reported as before.
## Requirements
### Requirement: escalate_to_owner Field on submit_response

The `submit_response` tool schema SHALL expose an optional `escalate_to_owner` string field in every trigger context (not gated by trigger type, unlike the multi-message fields). The field carries an operator-facing diagnostic intended for the workspace owner, never the end user. It SHALL be accepted alongside `skip_response` so a run may decline a user-facing message yet still escalate.

#### Scenario: Field available across trigger contexts
- **WHEN** the `submit_response` schema is built for any trigger (DM, mention, reaction, auto-respond, thread-reply, scheduled/channelless)
- **THEN** `escalate_to_owner` is an accepted optional string field
- **AND** providing it does not require any particular trigger type

#### Scenario: Field compatible with skip_response
- **WHEN** a channelless/scheduled run calls `submit_response` with `skip_response: true` and `escalate_to_owner` set
- **THEN** the schema accepts the call
- **AND** the escalation is honored even though no user-facing primary message is delivered

#### Scenario: Field absent or empty leaves behavior unchanged
- **WHEN** `submit_response` is called with `escalate_to_owner` absent, null, or an empty string
- **THEN** it is treated as no escalation
- **AND** delivery behaves exactly as it does today (no owner DM, no escalation error report)

### Requirement: Audience Split on Escalation

When `escalate_to_owner` was captured at any point during a run — including on a `submit_response` call that was subsequently rejected — the delivery layer SHALL split the response by audience: the user receives only Claude's acknowledgement `blocks` (or nothing, when the run produced no user-facing message), and the workspace owner receives the diagnostic via direct message. The split SHALL occur in the single delivery path shared by interactive and channelless-cron runs, so escalation works in both without separate wiring.

The captured diagnostic SHALL be carried on every non-hard-failure run outcome, not only the structured-response and skip outcomes: a run that ends with plain assistant text instead of a `submit_response` call, and a run that ends with no response at all, SHALL still propagate the diagnostic to the delivery layer.

#### Scenario: Diagnostic goes to owner, not user

- **WHEN** a successful response sets `escalate_to_owner` with a diagnostic
- **AND** a workspace owner is configured
- **THEN** the system sends the owner a direct message containing the diagnostic
- **AND** the user-facing message contains only the acknowledgement `blocks` Claude provided
- **AND** the raw diagnostic is not posted to the user

#### Scenario: Owner DM enriched with run context

- **WHEN** the owner DM is composed
- **THEN** it includes the session id, the triggering user, and the channel/context where the run occurred, in addition to the diagnostic body

#### Scenario: Escalation in a channelless run with no user message

- **WHEN** a channelless-cron run sets `escalate_to_owner` and posts no primary user message
- **THEN** the owner is still DMed the diagnostic

#### Scenario: Escalation survives a run that ends without submit_response

- **GIVEN** a rejected `submit_response` call captured a diagnostic
- **WHEN** the run then ends with plain assistant text and no successful `submit_response`
- **THEN** the diagnostic is still propagated to the delivery layer and DMed to the owner

#### Scenario: Escalation survives a run that produces no response

- **GIVEN** a rejected `submit_response` call captured a diagnostic
- **WHEN** the run then ends with no response at all
- **THEN** the diagnostic is still propagated to the delivery layer and DMed to the owner

### Requirement: Escalation Writes an Error Report

Each escalation SHALL also persist an error report through the existing `error-reporting` `writeErrorReport` mechanism, using the same `ErrorReport` shape as hard failures (the diagnostic as the error message, the session id, the conversation trace, the tool-call history when available, and a timestamp), so soft-fail escalations appear in `admin_list_error_reports` alongside hard failures — regardless of whether the owner DM succeeded.

#### Scenario: Report written on escalation
- **WHEN** a response sets `escalate_to_owner`
- **THEN** the system writes an error report in the same `ErrorReport` shape used for hard failures, carrying the diagnostic and the run's session id
- **AND** the report is discoverable through the admin error-report tools

### Requirement: No-Owner and DM-Failure Fallback

When no workspace owner is configured, or the owner DM fails to send, the system SHALL degrade safely: log a warning, still write the error report, and leave the user-facing outcome unchanged (the acknowledgement if one was posted; nothing additional if the run skipped its user message). It SHALL NOT fall back to surfacing the diagnostic to the user.

#### Scenario: No owner configured
- **WHEN** `escalate_to_owner` is set and no owner is configured
- **THEN** the system logs a warning
- **AND** writes the error report
- **AND** the user-facing outcome is unchanged (the diagnostic is not surfaced to the user)

#### Scenario: Owner DM send fails
- **WHEN** `escalate_to_owner` is set, an owner is configured, but the DM post fails (including an invalid or deactivated owner user)
- **THEN** the system logs a warning
- **AND** writes the error report
- **AND** the user-facing outcome is unchanged (the diagnostic is not surfaced to the user)

### Requirement: Instruction Directs Escalation for Operator-Facing Failures

The shipped tool-error instructions SHALL direct Claude to escalate internal/system failures the user cannot act on (unrecoverable tool errors, misconfiguration, missing credentials) via `escalate_to_owner`, keeping `blocks` to a short acknowledgement that the owner was notified, with all technical detail in the field. Normal outcomes the user should see (e.g. "no results found", "I can't do that here") SHALL continue to be reported in `submit_response` as before.

#### Scenario: Internal failure escalated
- **WHEN** Claude encounters an internal/system failure the user cannot resolve
- **THEN** the instructions direct it to set `escalate_to_owner` with the diagnostic
- **AND** to set `blocks` to a short acknowledgement that the owner has been notified

#### Scenario: Normal outcome not escalated
- **WHEN** the result is a normal user-facing outcome (no results, an unsupported request)
- **THEN** the instructions direct Claude to report it in `submit_response` without escalation

### Requirement: Owner-DM Scaffolding Localized

The owner-DM scaffolding emitted by Clack's own code (header and context labels) SHALL be sourced from the localization dictionary via `t()` with `en` and `fr` entries. The Claude-authored diagnostic body and the user-facing acknowledgement remain on their existing paths (Claude-authored under the language directive) and are not re-routed through `t()`.

#### Scenario: Scaffolding present in both languages
- **WHEN** the owner DM is composed under either configured language
- **THEN** its header and context labels resolve from the localization dictionary
- **AND** the diagnostic body passes through unchanged

### Requirement: Escalation Captured Before Any Gate and Retained Across Rejected Calls

The `submit_response` handler SHALL capture `escalate_to_owner` as its first action, ahead of the pending-input gate, the required-tools gate, and all validation — reading it from the raw arguments so a malformed sibling field cannot suppress it. A diagnostic supplied on a call that is subsequently rejected SHALL therefore be retained for the run rather than lost.

Retention SHALL follow last-non-empty-wins semantics: a later call carrying a diagnostic overwrites an earlier one, and a later call omitting it leaves the previously captured diagnostic intact. An escalation is never cleared by a subsequent call.

#### Scenario: Escalation survives a validation rejection

- **WHEN** Claude calls `submit_response` with `escalate_to_owner` set and a payload that fails validation
- **THEN** the call is rejected with a validation error
- **AND** the diagnostic is captured for the run
- **AND** it is delivered to the owner when the run ends

#### Scenario: Escalation survives a gate rejection

- **WHEN** `submit_response` is refused by the pending-input gate or the required-tools gate on a call carrying `escalate_to_owner`
- **THEN** the diagnostic is still captured

#### Scenario: A retry omitting the diagnostic does not clear it

- **GIVEN** an earlier rejected call captured a diagnostic
- **WHEN** Claude retries successfully without `escalate_to_owner`
- **THEN** the earlier diagnostic is still delivered to the owner

#### Scenario: A retry repeating the diagnostic overwrites harmlessly

- **GIVEN** an earlier rejected call captured a diagnostic
- **WHEN** Claude retries successfully with a revised `escalate_to_owner`
- **THEN** the revised diagnostic is the one delivered
- **AND** exactly one escalation is raised for the run

#### Scenario: No escalation supplied stays inert

- **WHEN** no call in the run sets `escalate_to_owner`
- **THEN** no diagnostic is captured and no owner DM or error report is produced

