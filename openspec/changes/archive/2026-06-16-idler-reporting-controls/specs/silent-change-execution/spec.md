## ADDED Requirements

### Requirement: Silent cron-triggered change execution

A cron job specification SHALL support a `silent` flag. A silent fire SHALL suppress ALL Slack output for that run — the `submit_response` delivery message, the worker `report_status` posts, and any change-lifecycle status posts on that path — regardless of whether the run posts a plain answer or executes a change. When a silent cron fire triggers an auto-executed change action (`submit_response` with `{ type: "change", auto: true }`), the system SHALL execute the change end-to-end — acquiring a worktree, committing, pushing, and opening/continuing a pull request — while keeping that output suppressed. Suppression SHALL NOT disable change auto-execution: the run SHALL retain a real destination channel (so it is not treated as a channelless dispatch, which would suppress execution), and the flag SHALL only gate the Slack `chat.postMessage` calls. GitHub-side effects (branch push, PR creation, PR/review comments) SHALL be unaffected — "silent" means Slack-silent only.

#### Scenario: Silent change executes and posts nothing

- **GIVEN** a cron spec marked `silent` whose fire auto-executes a change action against a real channel
- **WHEN** the change runs
- **THEN** the change is executed (commits made and/or a pull request created)
- **AND** no `submit_response` message, `report_status`, or lifecycle status is posted to Slack

#### Scenario: report_status is a no-op under silent execution

- **WHEN** the worker calls `report_status` during a silent change run
- **THEN** the call succeeds without posting any Slack message

#### Scenario: Non-silent execution is unchanged

- **GIVEN** a cron spec without the `silent` flag
- **WHEN** its fire auto-executes a change action
- **THEN** the `submit_response` delivery and `report_status` posts appear in the channel exactly as before

#### Scenario: Silent run is not treated as channelless

- **GIVEN** a silent cron spec with a real destination channel
- **WHEN** the fire stages a change action with `auto: true`
- **THEN** the change auto-executes (it is not suppressed as a channelless dispatch)
