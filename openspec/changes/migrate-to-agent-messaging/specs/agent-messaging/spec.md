## ADDED Requirements

### Requirement: Supported SDK Baseline

The system SHALL run the Slack layer on `@slack/bolt` v5 and `@slack/web-api` ≥ 7.18.0, the minimum versions that support the Agent messaging experience for Node. The upgrade SHALL leave all non-DM Slack behavior (reactions, @mentions, Changes Workflow, Home Tab, cron delivery) observably unchanged.

#### Scenario: Dependency baseline
- **WHEN** the project's dependencies are resolved
- **THEN** `@slack/bolt` is v5.x and `@slack/web-api` is ≥ 7.18.0

#### Scenario: Non-DM behavior preserved across the upgrade
- **WHEN** the Bolt 5 upgrade is complete
- **THEN** the full test suite passes with no behavioral change to reactions, @mentions, the Changes Workflow, the Home Tab, or scheduled delivery

### Requirement: dmType Agent Mode

The system SHALL expose `"agent"` as a third valid `directMessages.dmType`, alongside `"assistant"` and `"classic"`. When `dmType` is `"agent"`, the system SHALL route DM handling to the agent handler (`registerAgent`); the `"assistant"` and `"classic"` routes SHALL be unchanged. Switching into or out of `"agent"` SHALL require a restart and a manifest re-upload, consistent with the existing dmType switch contract.

#### Scenario: Agent mode selected
- **WHEN** `directMessages.dmType` is `"agent"` and DMs are enabled
- **THEN** the agent handler is registered and the assistant/classic handlers are not

#### Scenario: Agent is a valid dmType
- **WHEN** config validation runs with `dmType: "agent"`
- **THEN** the value is accepted (no validation error)

### Requirement: Agent DM-Open Detection

When `dmType` is `"agent"`, the system SHALL detect a user opening a DM via the `app_home_opened` event with `tab === "messages"`, and SHALL post the greeting and register suggested prompts on that event. It SHALL NOT depend on `assistant_thread_started`.

#### Scenario: User opens the DM
- **WHEN** an `app_home_opened` event arrives with `tab` equal to `"messages"` and direct messages are enabled
- **THEN** the configured greeting is posted and suggested prompts are set

#### Scenario: Non-messages home tab is ignored
- **WHEN** an `app_home_opened` event arrives with `tab` not equal to `"messages"`
- **THEN** no greeting or prompts are produced by the DM path

### Requirement: Agent User Turn Without thread_ts

The system SHALL process a DM user turn delivered as a `message` event in an `im` channel **whether or not** it carries a `thread_ts`. A missing `thread_ts` SHALL NOT cause the turn to be dropped.

#### Scenario: DM turn with thread_ts
- **WHEN** a DM `message.im` arrives carrying a `thread_ts`
- **THEN** the turn is processed and continues the session keyed to that thread root

#### Scenario: DM turn without thread_ts
- **WHEN** a DM `message.im` arrives with no `thread_ts`
- **THEN** the turn is still processed
- **AND** the DM session is keyed to the agent thread root the system resolves for the conversation

### Requirement: Retained Side-Panel Affordances

The system SHALL continue to provide live status, thread title, and suggested prompts via the `assistant.threads.*` Web API (retained under the `assistant:write` scope), driven from the agent event handlers rather than Bolt's `Assistant` middleware.

#### Scenario: Status during a turn
- **WHEN** a DM turn is being processed
- **THEN** a thinking status is shown via `assistant.threads.setStatus` and cleared when the turn completes

### Requirement: Classic DM Mode Remains View-Agnostic

The `dmType: "classic"` path SHALL continue to operate on raw `message.im` events with no dependency on `assistant_view` or `agent_view`, serving as the fallback DM experience.

#### Scenario: Classic mode under agent_view app
- **WHEN** `dmType` is `"classic"` and the workspace app is on `agent_view`
- **THEN** DM messages are received and answered through the classic handler
