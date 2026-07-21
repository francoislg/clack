## ADDED Requirements

### Requirement: Agent DM Manifest Emission

When `directMessages.enabled` is true and `dmType` is `"agent"`, the manifest generator SHALL emit the Agent messaging experience: an `agent_view` feature block with an `agent_description`. It SHALL keep the `assistant:write` scope (still used for `assistant.threads.*` status/title/prompt calls), subscribe `app_home_opened` (already core) and `message.im`, and SHALL NOT subscribe `assistant_thread_started` or `assistant_thread_context_changed`. The `"assistant"` and `"classic"` branches SHALL be unchanged.

#### Scenario: Agent DM mode emits agent_view
- **WHEN** `directMessages.enabled` is true and `dmType` is `"agent"`
- **THEN** the manifest's features include an `agent_view` block with an `agent_description`
- **AND** the manifest does not include an `assistant_view` block

#### Scenario: Agent thread events are not subscribed
- **WHEN** `dmType` is `"agent"`
- **THEN** the generated `bot_events` include `app_home_opened` and `message.im`
- **AND** do not include `assistant_thread_started` or `assistant_thread_context_changed`

#### Scenario: assistant:write scope retained under agent mode
- **WHEN** `dmType` is `"agent"`
- **THEN** the generated bot scopes include `assistant:write`

#### Scenario: Assistant and classic emission unchanged by the agent branch
- **WHEN** `dmType` is `"assistant"` or `"classic"`
- **THEN** the generated manifest for that mode is identical whether or not the `"agent"` branch exists in the generator (the baseline is the post-dependency-upgrade output, isolating the agent-branch addition from any Bolt/web-api upgrade effects)
