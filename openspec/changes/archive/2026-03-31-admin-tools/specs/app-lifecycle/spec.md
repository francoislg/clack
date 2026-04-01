# app-lifecycle Specification

## Purpose
Centralized app lifecycle management with soft restart capability — cache resets, scheduler cycling, repo sync — without dropping the Slack socket connection.

## Requirements

### Requirement: Lifecycle Module

The system SHALL provide a centralized lifecycle module (`src/lifecycle.ts`) that manages all cacheable state and schedulers.

#### Scenario: startAll initializes the app
- **WHEN** `startAll(app)` is called during boot (after Bolt app is created and started)
- **THEN** it starts the sync scheduler, cleanup scheduler, config watcher (if enabled), completion monitor, and cron scheduler (if enabled)
- **AND** returns stop handles for the shutdown sequence

#### Scenario: stopAll tears down cleanly
- **WHEN** `stopAll()` is called during shutdown
- **THEN** it stops all schedulers, watchers, and monitors
- **AND** does NOT stop the Bolt app (that is handled separately)

#### Scenario: restartAll performs soft restart
- **WHEN** `restartAll(app)` is called
- **THEN** it executes the restart sequence:
  1. Reload env vars from `data/auth/.env` (dotenv with override)
  2. Reload config via `loadConfig(undefined, true)` — if this fails, abort and throw without stopping anything
  3. Stop all schedulers, watchers, config watcher, and completion monitor
  4. Reset all module caches (MCP, tool mappings, roles, user preferences, github token, auto-respond, cron jobs)
  5. Reload GitHub credentials (`loadGitHubCredentials()`)
  6. Validate instruction files
  7. Initialize and sync repositories
  8. Ensure worktree directories (if changes workflow enabled)
  9. Start all schedulers, watchers, config watcher, completion monitor, and cron scheduler
- **AND** returns a summary object with reload results

#### Scenario: Restart aborts on config validation failure
- **WHEN** `restartAll()` calls `loadConfig(undefined, true)`
- **AND** the config file fails validation
- **THEN** the function throws the validation error
- **AND** no schedulers are stopped or caches reset
- **AND** the app continues running with the previous configuration

#### Scenario: Restart tolerates non-critical failures
- **WHEN** `restartAll()` encounters an error during repository sync or MCP testing
- **THEN** it logs the error and continues with the remaining restart steps
- **AND** includes the failure in the returned summary

### Requirement: Cache Reset Functions

The system SHALL provide cache-clearing exports for all module-level caches. Most already exist (`clearRolesCache`, `clearPreferencesCache`, `clearAutoRespondCache`, `clearCronJobsCache`, `resetMcpCache`, `resetToolMappingCache`). Only `github.ts` lacks one.

#### Scenario: Clear GitHub token cache
- **WHEN** `clearGitHubTokenCache()` is called
- **THEN** the `cachedToken` variable in `github.ts` is set to `null`
- **AND** the next GitHub API call generates a fresh installation token

#### Scenario: restartAll clears all caches
- **WHEN** `restartAll()` executes its cache reset step
- **THEN** it calls all cache-clearing functions: `clearRolesCache()`, `clearPreferencesCache()`, `clearAutoRespondCache()`, `clearCronJobsCache()`, `clearGitHubTokenCache()`, `resetMcpCache()`, `resetToolMappingCache()`
- **AND** reloads config via `loadConfig(undefined, true)`

### Requirement: Always-Register Bolt Handlers

The system SHALL register all Bolt event handlers unconditionally at boot, and check feature enablement at invocation time.

#### Scenario: DM handler registered unconditionally
- **WHEN** `createSlackApp()` is called
- **THEN** the assistant handler is registered regardless of `directMessages.enabled`

#### Scenario: DM handler checks config at invocation
- **WHEN** a direct message event is received
- **AND** `getConfig().directMessages.enabled` is `false`
- **THEN** the handler returns early without processing

#### Scenario: Mention handler registered unconditionally
- **WHEN** `createSlackApp()` is called
- **THEN** the mention handler is registered regardless of `mentions.enabled`

#### Scenario: Mention handler checks config at invocation
- **WHEN** an app_mention event is received
- **AND** `getConfig().mentions.enabled` is `false`
- **THEN** the handler returns early without processing

#### Scenario: Auto-respond handler registered unconditionally
- **WHEN** `createSlackApp()` is called
- **THEN** the auto-respond handler is registered regardless of `autoRespond.enabled`

#### Scenario: Auto-respond handler checks config at invocation
- **WHEN** a message event is received that would trigger auto-respond
- **AND** `getConfig().autoRespond?.enabled` is not `true`
- **THEN** the handler returns early without processing

#### Scenario: Message changed handler registered unconditionally
- **WHEN** `createSlackApp()` is called
- **THEN** the message changed handler is registered regardless of DM/mention configuration
