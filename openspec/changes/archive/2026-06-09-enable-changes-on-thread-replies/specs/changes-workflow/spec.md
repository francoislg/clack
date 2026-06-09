## ADDED Requirements

### Requirement: Changes Workflow availability by context visibility

Beyond the per-trigger opt-in for mentions/DMs/reactions, the system SHALL make the Changes Workflow available on the `threadReply`, `autoRespond`, and `scheduled` triggers when global `changesWorkflow.enabled` is `true` AND the context is **visible** AND the acting user has change permission (`canRequestChanges(role)` — dev or higher).

A context is **invisible** when it is a channelless cron dispatch (a synthetic `channelless:<jobId>` channel with no bound Slack channel, per `src/channelless.ts`). In an invisible context the Changes Workflow SHALL be unavailable, and `auto`-execution of change / config / update / skill intents SHALL be suppressed. Channelless `post_to` auto-delivery is unaffected (channelless dispatch depends on it). All other contexts (mentions, DMs, reactions, thread replies, auto-respond replies, and channel-bound scheduled runs) are visible.

For `threadReply`, availability is determined by the replying user's role and the visibility/global rules only — independent of who started the thread or the thread's original trigger type. Thread replies, auto-respond, and scheduled triggers have no per-trigger `changesWorkflow.enabled` config block, so none is consulted for them.

#### Scenario: Dev replies in a visible thread
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible (a real Slack channel)
- **AND** a user with role dev (or higher) replies in an existing thread without @mentioning the bot
- **WHEN** the reply is processed as a `threadReply` trigger
- **THEN** the Changes Workflow tools (`propose_change`, `request_update`, `cancel_worker_run`) are available
- **AND** an unambiguous "do it" directive stages the change with `auto: true` so it executes without a second click

#### Scenario: Non-dev starts the thread, a dev replies "do it"
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible
- **AND** a thread was started by a non-dev user
- **WHEN** a dev (or higher) replies in that thread with a clear directive
- **THEN** availability is based on the replying dev's role, not the thread starter's, and the change can be staged and launched

#### Scenario: Auto-respond and channel-bound scheduled are visible
- **GIVEN** `changesWorkflow.enabled` is `true`
- **WHEN** a turn is processed as `autoRespond`, or as `scheduled` bound to a real Slack channel
- **THEN** the Changes Workflow is available to a dev+ acting user (these are visible contexts)

#### Scenario: Channelless cron dispatch is an invisible context
- **GIVEN** a `scheduled` trigger dispatched to a channelless sentinel (`channelless:<jobId>`)
- **WHEN** the turn runs
- **THEN** the Changes Workflow tools are NOT available
- **AND** `auto`-execution of any staged change / config / update / skill intent is suppressed
- **AND** `post_to` auto-delivery still functions

#### Scenario: Member acting in a visible context
- **GIVEN** `changesWorkflow.enabled` is `true` and the context is visible
- **WHEN** a user with role member asks for a code change
- **THEN** the Changes Workflow tools are NOT available
- **AND** the bot explains that a dev is needed rather than reporting a tooling outage

#### Scenario: Workflow disabled globally
- **GIVEN** `changesWorkflow.enabled` is `false` or not configured
- **WHEN** any user acts in any context
- **THEN** the Changes Workflow is unavailable and the turn is treated as a Q&A query
