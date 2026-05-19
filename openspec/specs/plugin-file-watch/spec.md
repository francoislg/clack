# plugin-file-watch Specification

## Purpose
TBD - created by archiving change plugin-managed-schedules. Update Purpose after archive.
## Requirements
### Requirement: Plugin-Scoped File Watch API

The system SHALL expose `sdk.watchFile(relativePath: string, callback: () => void): FSWatcher` on the `ClackSdk` interface. The path SHALL resolve relative to the plugin's data directory (`data/plugins/<pluginName>/`), with the same path-traversal protection as `sdk.readFile` and `sdk.writeFile`. The callback SHALL fire (debounced 500ms) whenever the watched file changes on disk.

#### Scenario: Watch resolves under plugin data directory

- **WHEN** the trivia plugin calls `sdk.watchFile("categories.json", cb)`
- **THEN** the underlying watcher is attached to `data/plugins/trivia/categories.json`
- **AND** changes to that file fire `cb` (debounced)
- **AND** changes to files outside the plugin's data directory do NOT fire `cb`

#### Scenario: Path traversal rejected

- **WHEN** a plugin calls `sdk.watchFile("../other-plugin/data.json", cb)`
- **THEN** the SDK throws an error
- **AND** no watcher is created

#### Scenario: Absolute path rejected

- **WHEN** a plugin calls `sdk.watchFile("/etc/passwd", cb)`
- **THEN** the SDK throws an error
- **AND** no watcher is created

#### Scenario: Missing file does not throw

- **GIVEN** the relative path does not exist yet
- **WHEN** `sdk.watchFile("future-file.json", cb)` is called
- **THEN** the call returns without throwing
- **AND** the returned watcher MAY be inactive until the file is created (consistent with `fs.watch` behavior)

#### Scenario: Watcher is debounced

- **GIVEN** an active `watchFile` registration
- **WHEN** the underlying file is written to ten times within 500ms
- **THEN** the callback fires at most once for the burst

### Requirement: Plugin Watchers Are Torn Down On Plugin Reload

The plugin loading lifecycle SHALL track all `FSWatcher` instances returned by `sdk.watchFile` for a given plugin load and SHALL close them before the plugin is re-loaded (on `restartAll`).

#### Scenario: Watchers closed before plugin reload

- **GIVEN** a plugin has registered three `watchFile` callbacks during its init
- **WHEN** `restartAll()` runs and reaches the plugin-reload step
- **THEN** all three watchers are closed before the plugin's init function runs again
- **AND** the post-reload init can register fresh watchers without colliding with the prior ones

#### Scenario: Watcher leak across reload would cause double-fire

- **GIVEN** the same plugin is reloaded twice
- **WHEN** the watched file changes once after the second load
- **THEN** the callback fires exactly once (not twice) — confirming the prior load's watcher was disposed

### Requirement: Config File Is Watched For Hot Reload

The config watcher (`startConfigWatcher` in `src/configWatcher.ts`) SHALL include `data/config.json` in its watched paths. A change to that file SHALL trigger the same lifecycle reload as `/admin-restart` (`restartAll()`), causing plugins to re-load and reconcile.

This watcher SHALL be unconditional — it is not gated behind `claudeCode.watchMcpConfig` (which only governs MCP-specific reloads).

#### Scenario: Editing config.json triggers full reload

- **GIVEN** the application is running with an active config watcher
- **WHEN** an admin edits `data/config.json` (e.g. to add a `trivia.games[]` entry)
- **THEN** the watcher debounces (500ms) and then calls `restartAll()`
- **AND** `loadConfig` re-reads the file
- **AND** `loadPlugins()` re-runs each plugin's init
- **AND** the cron scheduler is stopped and restarted around the reload

#### Scenario: Save burst debounces to a single reload

- **WHEN** an editor with autosave writes `data/config.json` five times within 500ms
- **THEN** `restartAll()` is invoked exactly once

#### Scenario: Watcher continues after a failing reload

- **GIVEN** an edit to `data/config.json` produces a config that fails validation in `loadConfig`
- **WHEN** the watcher fires and `restartAll()` throws
- **THEN** the watcher remains active and a subsequent edit will trigger another `restartAll()` attempt
- **AND** the running bot continues to serve traffic with the prior in-memory config (no partial state)

