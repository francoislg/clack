# auto-respond-rule-tools (delta)

## ADDED Requirements

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
