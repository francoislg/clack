## MODIFIED Requirements

### Requirement: Auto-Respond Rule Management

The system SHALL provide CRUD operations for auto-respond rules. Rules MAY be managed from the Home Tab or from chat via the auto-respond rule tools (see `auto-respond-rule-tools`). Both surfaces mutate the same store via the same CRUD functions in `src/autoRespond.ts` and MUST produce identical persisted state for equivalent operations.

Update operations SHALL follow partial-patch semantics: fields omitted from the update patch are preserved, fields present with an empty string or empty array are explicitly cleared.

#### Scenario: Create a rule
- **WHEN** an admin creates a new rule with channels and optional user filters
- **THEN** the system generates a unique rule ID
- **AND** saves the rule with `enabled: true` by default
- **AND** persists the updated rules to disk

#### Scenario: Create a rule with pre-analysis context
- **WHEN** an admin creates a new rule with a `preAnalysisContext` value
- **THEN** the system saves the rule with the `preAnalysisContext` field
- **AND** pre-analysis is active for that rule

#### Scenario: Update a rule preserves omitted fields
- **WHEN** an admin updates an existing rule with a partial patch (some fields omitted)
- **THEN** the omitted fields retain their prior values
- **AND** the provided fields are applied
- **AND** the updated rules are persisted to disk

#### Scenario: Update a rule with all fields behaves as full replacement
- **WHEN** an admin updates a rule and supplies values for every optional field
- **THEN** the rule's optional fields reflect exactly the supplied values (mirroring the Home Tab modal submission flow)
- **AND** the updated rules are persisted to disk

#### Scenario: Clear pre-analysis context via explicit empty value
- **WHEN** an admin updates a rule with `preAnalysisContext: ""`
- **THEN** the system removes the `preAnalysisContext` field from the rule
- **AND** pre-analysis is no longer active for that rule

#### Scenario: Omitting pre-analysis context in a patch does not clear it
- **GIVEN** a rule with `preAnalysisContext` currently set
- **WHEN** an admin updates the rule with a patch that does not include a `preAnalysisContext` key
- **THEN** the rule's `preAnalysisContext` is unchanged

#### Scenario: Toggle a rule
- **WHEN** an admin toggles a rule's enabled state
- **THEN** the system flips the `enabled` boolean
- **AND** persists the updated rules to disk

#### Scenario: Delete a rule
- **WHEN** an admin deletes a rule
- **THEN** the system removes the rule from the rules array
- **AND** persists the updated rules to disk
