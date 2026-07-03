# auto-respond-rule-tools Specification

## Purpose
Admin-only MCP tools for managing auto-respond rules from Slack chat: list, add, update, toggle, and delete. Rules are stored in `data/state/auto-respond.json` and shared with the Home Tab UI. All mutation tools apply changes directly (no intent-staging / button confirmation), mirroring the scheduled-messages pattern.

## Requirements

### Requirement: Auto-Respond Rule Tools Admin Gate

The system SHALL expose five MCP tools for managing auto-respond rules from chat, registered together behind a single admin permission gate. Non-admin users MUST NOT see or be able to invoke these tools.

#### Scenario: Admin user sees rule tools

- **WHEN** the tool server builds the tool list for a user whose role satisfies `canEditConfig` (admin or owner)
- **AND** a Slack client is available in the tool context
- **THEN** the tool list SHALL include `list_auto_respond_rules`, `add_auto_respond_rule`, `update_auto_respond_rule`, `toggle_auto_respond_rule`, and `delete_auto_respond_rule`

#### Scenario: Non-admin user does not see rule tools

- **WHEN** the tool server builds the tool list for a user whose role is `member` or `dev`
- **THEN** the tool list SHALL NOT include any of the five auto-respond rule tools
- **AND** calling these tools SHALL NOT be possible from that user's session

#### Scenario: Tools require a Slack client

- **WHEN** the tool server builds tools without a Slack client in context (e.g., a non-Slack execution path)
- **THEN** the tool list SHALL NOT include the auto-respond rule tools regardless of role

### Requirement: List Auto-Respond Rules Tool

The `list_auto_respond_rules` tool SHALL return all auto-respond rules currently stored, including their IDs, channel IDs, optional filters, optional extra context, optional pre-analysis context, optional attention level, and enabled state. It SHALL take no arguments.

#### Scenario: List returns all rules

- **WHEN** an admin calls `list_auto_respond_rules`
- **THEN** the tool returns a JSON result containing every rule from `data/state/auto-respond.json`
- **AND** each rule entry includes `id`, `channels`, `enabled`, and any of `userFilters`, `keywords`, `extraContext`, `preAnalysisContext`, `attentionLevel` that are set

#### Scenario: List returns empty array when no rules exist

- **WHEN** an admin calls `list_auto_respond_rules` and no rules are stored
- **THEN** the tool returns a result with an empty rules array
- **AND** does not error

### Requirement: Add Auto-Respond Rule Tool

The `add_auto_respond_rule` tool SHALL create a new rule with `enabled: true` and return the created rule's ID. It SHALL require a `channels` argument (non-empty) and accept optional `userFilters`, `keywords`, `extraContext`, `preAnalysisContext`, and `attentionLevel`. The `attentionLevel` value SHALL be one of `always | high | medium | low` (the rule MUST NOT seed `"off"`); when omitted, sessions created from the rule default to `"medium"`. Channel entries SHALL be accepted as channel names (with or without `#`), channel IDs, or DM IDs, and resolved to channel IDs via `resolveChannelId` before persisting.

#### Scenario: Create rule with channel name

- **GIVEN** an admin passes `channels: ["#engineering"]` and no other filters
- **WHEN** the tool runs
- **THEN** `resolveChannelId` is called for `"#engineering"` and returns the channel ID
- **AND** the rule is persisted with the resolved channel ID in `channels`
- **AND** the tool returns `{ ok: true, id }` with the new rule's ID

#### Scenario: Create rule with mixed channel inputs

- **GIVEN** an admin passes `channels: ["C0123ABCDEF", "#ops"]`
- **WHEN** the tool runs
- **THEN** both entries are resolved and the rule is persisted with two channel IDs
- **AND** entries already-in-ID form are preserved

#### Scenario: Channel resolution failure aborts the whole call

- **GIVEN** an admin passes `channels: ["#engineering", "#nonexistent-channel"]`
- **WHEN** `resolveChannelId` fails to resolve one entry
- **THEN** the tool returns an error result describing which entry failed
- **AND** no rule is persisted (the call is atomic with respect to the store)

#### Scenario: Create rule with all optional filters

- **WHEN** an admin passes `channels`, `userFilters`, `keywords`, `extraContext`, `preAnalysisContext`, and `attentionLevel`
- **THEN** the persisted rule contains all those fields exactly as supplied (trimmed where `addRule` already trims)
- **AND** `enabled` is `true`

#### Scenario: Attention level rejects off

- **WHEN** an admin passes `attentionLevel: "off"`
- **THEN** the tool returns an error indicating a rule may only seed `always | high | medium | low`
- **AND** no rule is persisted

#### Scenario: Rejects empty channels array

- **WHEN** an admin calls the tool with `channels: []`
- **THEN** the tool returns an error result indicating at least one channel is required
- **AND** no rule is persisted

### Requirement: Update Auto-Respond Rule Tool

The `update_auto_respond_rule` tool SHALL apply a partial patch to an existing rule identified by `id`. Fields not present in the tool arguments SHALL be preserved. Fields present with an empty string or empty array SHALL explicitly clear the corresponding optional field. The `attentionLevel` field MAY be set to one of `always | high | medium | low`; an empty string SHALL clear it (reverting the rule to the `"medium"` default). The tool SHALL require only the `id` argument; all other fields are optional.

#### Scenario: Partial update preserves omitted fields

- **GIVEN** a rule with `channels: [C1]`, `keywords: ["error"]`, `preAnalysisContext: "X"`, `enabled: true`
- **WHEN** an admin calls `update_auto_respond_rule` with `{ id, extraContext: "new context" }`
- **THEN** the rule's `extraContext` becomes `"new context"`
- **AND** `channels`, `keywords`, `preAnalysisContext`, and `enabled` are unchanged

#### Scenario: Set attention level on a rule

- **GIVEN** a rule with no `attentionLevel`
- **WHEN** an admin calls `update_auto_respond_rule` with `{ id, attentionLevel: "high" }`
- **THEN** the rule's `attentionLevel` becomes `"high"`

#### Scenario: Clear attention level

- **GIVEN** a rule with `attentionLevel: "high"`
- **WHEN** an admin calls `update_auto_respond_rule` with `{ id, attentionLevel: "" }`
- **THEN** the rule's `attentionLevel` field is removed (reverts to the `"medium"` default)

#### Scenario: Empty string clears an optional field

- **GIVEN** a rule with `preAnalysisContext: "X"`
- **WHEN** an admin calls `update_auto_respond_rule` with `{ id, preAnalysisContext: "" }`
- **THEN** the rule's `preAnalysisContext` field is removed from the stored rule

#### Scenario: Empty array clears optional list fields

- **GIVEN** a rule with `keywords: ["error", "crash"]`
- **WHEN** an admin calls `update_auto_respond_rule` with `{ id, keywords: [] }`
- **THEN** the rule's `keywords` field is removed from the stored rule

#### Scenario: Updating channels re-resolves names

- **WHEN** an admin passes `channels: ["#ops"]` in an update
- **THEN** `resolveChannelId` is called for each entry and the resolved IDs replace the stored `channels` array

#### Scenario: Unknown rule ID returns an error

- **WHEN** an admin calls `update_auto_respond_rule` with an ID that does not exist
- **THEN** the tool returns an error result indicating the rule was not found
- **AND** no store mutation occurs

### Requirement: Toggle Auto-Respond Rule Tool

The `toggle_auto_respond_rule` tool SHALL flip the `enabled` boolean on an existing rule and return the new state.

#### Scenario: Toggle enabled → disabled

- **GIVEN** a rule with `enabled: true`
- **WHEN** an admin calls `toggle_auto_respond_rule` with the rule's ID
- **THEN** the stored rule's `enabled` becomes `false`
- **AND** the tool returns `{ ok: true, id, enabled: false }`

#### Scenario: Toggle disabled → enabled

- **GIVEN** a rule with `enabled: false`
- **WHEN** an admin calls the tool with the rule's ID
- **THEN** the stored rule's `enabled` becomes `true`
- **AND** the tool returns `{ ok: true, id, enabled: true }`

#### Scenario: Unknown rule ID returns an error

- **WHEN** an admin calls `toggle_auto_respond_rule` with an ID that does not exist
- **THEN** the tool returns an error result indicating the rule was not found

### Requirement: Delete Auto-Respond Rule Tool

The `delete_auto_respond_rule` tool SHALL remove an existing rule by ID and return a success result.

#### Scenario: Delete an existing rule

- **WHEN** an admin calls `delete_auto_respond_rule` with an existing rule's ID
- **THEN** the rule is removed from the stored rules array
- **AND** the file `data/state/auto-respond.json` is written without that rule
- **AND** the tool returns `{ ok: true, id }`

#### Scenario: Unknown rule ID returns an error

- **WHEN** an admin calls `delete_auto_respond_rule` with an ID that does not exist
- **THEN** the tool returns an error result indicating the rule was not found
- **AND** the store is not mutated

### Requirement: Direct-Mutation Execution Model

The five auto-respond rule tools SHALL apply changes directly to the store without staging an intent for user confirmation. The tool descriptions SHALL instruct Claude to ask clarifying questions when the request is ambiguous, mirroring the pattern used by `create_scheduled_message`.

#### Scenario: No intent-store entry is created

- **WHEN** any of the five tools executes successfully
- **THEN** no entry is added to the intent store
- **AND** no button-bearing Slack message is produced for user confirmation
- **AND** the mutation is persisted immediately

#### Scenario: Ambiguous request prompts Claude to clarify

- **WHEN** the tool description is read by Claude
- **THEN** it instructs Claude to ask clarifying questions for ambiguous requests (e.g., an unspecified channel, unspecified keywords) before calling the tool

### Requirement: Ephemeral Rules in Rule Tools

The rule tools SHALL surface ephemeral rules read-only: `list_auto_respond_rules` includes them with their ephemeral metadata (channel, current attention level, expiry/dormant state, linked-session count, anchor text excerpt) so Claude can see which conversations it is following; `update_auto_respond_rule` and toggle SHALL reject ephemeral rules with an error pointing at `channel_attention_level` as the mutation path; `delete_auto_respond_rule` SHALL work on ephemeral rules (admin kill switch). `add_auto_respond_rule` SHALL never create ephemeral rules.

#### Scenario: List surfaces followed conversations
- **WHEN** Claude calls `list_auto_respond_rules` while an ephemeral rule exists
- **THEN** the result includes the ephemeral rule marked as such, with its attention level, expiry or dormant state, and linked-session count

#### Scenario: Update rejects ephemeral rule
- **WHEN** `update_auto_respond_rule` targets an ephemeral rule's ID
- **THEN** the tool returns an error explaining ephemeral conversations are adjusted via `channel_attention_level` on responding turns, not rule edits

#### Scenario: Delete works as kill switch
- **WHEN** `delete_auto_respond_rule` targets an ephemeral rule's ID
- **THEN** the rule is deleted and Clack stops following that channel conversation
