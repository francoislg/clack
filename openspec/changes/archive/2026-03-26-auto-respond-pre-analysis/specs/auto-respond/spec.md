## MODIFIED Requirements

### Requirement: Auto-Respond Rule Persistence

The system SHALL persist auto-respond rules in `data/state/auto-respond.json` with in-memory caching.

#### Scenario: Rule file structure
- **WHEN** rules are saved
- **THEN** the file contains a JSON object with a `rules` array
- **AND** each rule has: `id` (string), `channels` (string[]), `userFilters` (string[], optional), `keywords` (string[], optional), `extraContext` (string, optional), `preAnalysisContext` (string, optional), `enabled` (boolean)

#### Scenario: Load rules on first access
- **WHEN** rules are accessed for the first time
- **THEN** the system reads from `data/state/auto-respond.json`
- **AND** caches the result in memory
- **AND** returns an empty rules array if the file does not exist

#### Scenario: Persist rules on change
- **WHEN** a rule is created, updated, or deleted
- **THEN** the system writes the updated rules to disk
- **AND** updates the in-memory cache

#### Scenario: Concurrent rule modifications
- **WHEN** two admins modify rules simultaneously
- **THEN** last-write-wins semantics apply
- **AND** the file is always valid JSON (no partial writes or corruption)

### Requirement: Auto-Respond Rule Matching

The system SHALL evaluate incoming messages against active auto-respond rules, filtering out non-message events and triggering on the first matching rule only.

#### Scenario: Match by channel only (no user filters)
- **WHEN** a top-level message arrives in a channel that matches a rule with no `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response (subject to pre-analysis if configured)

#### Scenario: Match by channel and user filter
- **WHEN** a top-level message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is in `userFilters`
- **AND** the rule is enabled
- **THEN** the system triggers a response (subject to pre-analysis if configured)

#### Scenario: No match when user filter excludes author
- **WHEN** a message arrives in a channel that matches a rule with `userFilters`
- **AND** the message author's `user` is not in `userFilters`
- **THEN** the system does NOT trigger a response

#### Scenario: Disabled rule does not match
- **WHEN** a message arrives in a channel that matches a disabled rule
- **THEN** the system does NOT trigger a response

#### Scenario: Ignore own messages
- **WHEN** a message is posted by Clack itself (matching the bot's own user ID)
- **THEN** the system does NOT trigger a response regardless of rules

#### Scenario: Ignore message subtypes
- **WHEN** a message event has a subtype (e.g., `message_changed`, `message_deleted`, `channel_join`, `bot_message`)
- **THEN** the system does NOT trigger a response
- **AND** only messages with no subtype (regular new messages) are evaluated against rules

#### Scenario: Ignore thread replies
- **WHEN** a message event has a `thread_ts` field (indicating it is a reply in a thread)
- **THEN** the system does NOT trigger a response
- **AND** only top-level channel messages are evaluated against rules

#### Scenario: First matching rule wins
- **WHEN** a message matches multiple active rules (e.g., one channel-only rule and one channel+user rule)
- **THEN** the system triggers exactly one response
- **AND** stops evaluating further rules after the first match

#### Scenario: No deduplication of similar messages
- **WHEN** multiple messages in the same channel match the same rule within a short time window (e.g., Sentry posting the same error 10 times)
- **THEN** each message triggers an independent response
- **AND** no deduplication is applied (deduplication is explicitly out of scope for v1)

### Requirement: Auto-Respond Rule Management

The system SHALL provide CRUD operations for auto-respond rules.

#### Scenario: Create a rule
- **WHEN** an admin creates a new rule with channels and optional user filters
- **THEN** the system generates a unique rule ID
- **AND** saves the rule with `enabled: true` by default
- **AND** persists the updated rules to disk

#### Scenario: Create a rule with pre-analysis context
- **WHEN** an admin creates a new rule with a `preAnalysisContext` value
- **THEN** the system saves the rule with the `preAnalysisContext` field
- **AND** pre-analysis is active for that rule

#### Scenario: Update a rule
- **WHEN** an admin updates an existing rule's channels, user filters, or pre-analysis context
- **THEN** the system updates the rule in place
- **AND** persists the updated rules to disk

#### Scenario: Clear pre-analysis context
- **WHEN** an admin updates a rule and clears the `preAnalysisContext` field (empty string or not provided)
- **THEN** the system removes the `preAnalysisContext` field from the rule
- **AND** pre-analysis is no longer active for that rule

#### Scenario: Toggle a rule
- **WHEN** an admin toggles a rule's enabled state
- **THEN** the system flips the `enabled` boolean
- **AND** persists the updated rules to disk

#### Scenario: Delete a rule
- **WHEN** an admin deletes a rule
- **THEN** the system removes the rule from the rules array
- **AND** persists the updated rules to disk

## ADDED Requirements

### Requirement: Auto-Respond Rule UI — Pre-Analysis Context

The Home Tab "Edit Rule" modal SHALL include an optional text input for pre-analysis context.

#### Scenario: Pre-analysis context field displayed
- **WHEN** an admin opens the Add Rule or Edit Rule modal
- **THEN** the modal displays a "Pre-analysis context" plain text input field
- **AND** the field is optional (not required)
- **AND** the field placeholder explains its purpose (e.g., "Only respond if this is an actionable error — leave empty to skip pre-analysis")

#### Scenario: Pre-analysis context field pre-populated on edit
- **WHEN** an admin opens the Edit Rule modal for a rule that has `preAnalysisContext` set
- **THEN** the field is pre-populated with the existing value

#### Scenario: Pre-analysis context saved on submission
- **WHEN** an admin submits the modal with a non-empty pre-analysis context value
- **THEN** the value is saved to the rule's `preAnalysisContext` field

#### Scenario: Pre-analysis context cleared on submission
- **WHEN** an admin submits the modal with an empty pre-analysis context value
- **THEN** the `preAnalysisContext` field is removed from the rule

#### Scenario: Pre-analysis context displayed in rule summary
- **WHEN** the Home Tab renders a rule that has `preAnalysisContext` set
- **THEN** the rule summary indicates that pre-analysis is active (e.g., "Pre-analysis" label)
