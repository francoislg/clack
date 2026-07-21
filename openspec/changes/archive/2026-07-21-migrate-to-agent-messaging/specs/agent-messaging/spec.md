## ADDED Requirements

### Requirement: Supported SDK Baseline

The system SHALL run the Slack layer on `@slack/bolt` v5 and `@slack/web-api` ^8 (the pairing Bolt 5 actually requires — spike 0.1). The upgrade SHALL leave all non-DM Slack behavior (reactions, @mentions, Changes Workflow, Home Tab, cron delivery) observably unchanged.

#### Scenario: Dependency baseline
- **WHEN** the project's dependencies are resolved
- **THEN** `@slack/bolt` is v5.x and `@slack/web-api` is v8.x

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

When `dmType` is `"agent"`, the system SHALL detect a user opening a DM via the `app_home_opened` event with `tab === "messages"`. It SHALL NOT depend on `assistant_thread_started`, and it SHALL NOT post a greeting message on DM-open: `app_home_opened` fires on every tab visit (greeting-on-every-open is spam), and the `agent_description` + static suggested prompts occupy the "what can I do" slot natively under agent_view. The greeting drop is a decision, not a deferral.

#### Scenario: User opens the DM
- **WHEN** an `app_home_opened` event arrives with `tab` equal to `"messages"` and direct messages are enabled
- **THEN** the event is acknowledged (observable at debug level) and no message is posted

#### Scenario: Non-messages home tab is ignored
- **WHEN** an `app_home_opened` event arrives with `tab` not equal to `"messages"`
- **THEN** the DM path takes no action

### Requirement: Static Suggested Prompts In The Manifest

When `dmType` is `"agent"`, the generated manifest SHALL populate `agent_view.suggested_prompts` with the default prompt set (capabilities, debug, funny — the same defaults the assistant mode builds from i18n, minus the channel-context prompt, which has no meaning atop the Messages tab). Prompts under agent_view are a static manifest property rendered atop the Messages tab, not a per-thread runtime call.

#### Scenario: Agent manifest carries prompts
- **WHEN** the manifest is generated with `dmType: "agent"`
- **THEN** `agent_view.suggested_prompts` is non-empty and each entry has `title` and `message`

### Requirement: Agent User Turn Without thread_ts

The system SHALL process a DM user turn delivered as a `message` event in an `im` channel **whether or not** it carries a `thread_ts`. A missing `thread_ts` SHALL NOT cause the turn to be dropped.

#### Scenario: DM turn with thread_ts
- **WHEN** a DM `message.im` arrives carrying a `thread_ts`
- **THEN** the turn is processed and continues the session keyed to that thread root

#### Scenario: DM turn without thread_ts
- **WHEN** a DM `message.im` arrives with no `thread_ts`
- **THEN** the turn is still processed
- **AND** the DM session is keyed to the agent thread root the system resolves for the conversation

### Requirement: Best-Effort Live Status And Title

The system MAY provide live status and thread title via the typed `assistant.threads.setStatus` / `assistant.threads.setTitle` Web API methods (retained under the `assistant:write` scope), driven from the agent event handlers rather than Bolt's `Assistant` middleware. These calls are **best-effort and probe-gated**: they SHALL be attempted only after a live probe confirms Slack accepts the resolved thread root (`thread_ts || message ts`) under agent_view, and a failure SHALL never fail or delay the DM turn (log at debug and continue). Channel-context tracking (`assistantCurrentChannelId`) is NOT provided under agent mode — `assistant_thread_context_changed` has no confirmed agent_view equivalent, and the session field simply stays unset.

#### Scenario: Status failure never breaks the turn
- **WHEN** a DM turn is being processed and a `setStatus` or `setTitle` call fails
- **THEN** the turn still completes and the answer is delivered

#### Scenario: No channel-context tracking in agent mode
- **WHEN** a DM session runs under `dmType: "agent"`
- **THEN** `assistantCurrentChannelId` is never written for that session

### Requirement: Classic DM Mode Remains View-Agnostic

The `dmType: "classic"` path SHALL continue to operate on raw `message.im` events with no dependency on `assistant_view` or `agent_view`, serving as the fallback DM experience.

#### Scenario: Classic mode under agent_view app
- **WHEN** `dmType` is `"classic"` and the workspace app is on `agent_view`
- **THEN** DM messages are received and answered through the classic handler
