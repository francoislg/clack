## MODIFIED Requirements

### Requirement: Auto-Execute Flag on Ref-Based Actions
Auto-execute now receives DM delivery coordinates so it can stream progress in the correct location.

#### Scenario: Auto-execute receives DM coordinates
- **WHEN** `handleAutoExecuteActions` is called after posting a response
- **THEN** it receives optional `dmChannel` and `dmThreadTs` parameters
- **AND** if set, passes them to `triggerChangeWorkflow` and `triggerFollowUp` as stream target overrides
- **AND** progress streaming targets the DM thread instead of the channel thread

#### Scenario: Auto-execute with ephemeral/DM-first response (UPDATED)
- **GIVEN** the response is in DM mode
- **WHEN** an action has `auto: true`
- **THEN** auto-execution streams progress in the DM thread (via `dmChannel`/`dmThreadTs`)
- **AND** uses a `SlackStreamer` in the DM thread for live task card updates
