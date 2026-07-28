## ADDED Requirements

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

## MODIFIED Requirements

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
