## ADDED Requirements

### Requirement: ClackSdk Exposes Cron Reconciliation

The `ClackSdk` interface SHALL include a `reconcileCronJobs(ownerKey: string, specs: CronJobSpec[]): Promise<void>` method. Plugins use this method during init to declare the cron jobs they want to own. Detailed semantics, identity rules, and admin-override behavior are codified in the `plugin-cron-reconciliation` capability — this requirement only governs the SDK surface.

#### Scenario: SDK method is present on every plugin's SDK instance

- **WHEN** the system creates a `ClackSdk` instance for a plugin during loading
- **THEN** the instance exposes a `reconcileCronJobs` function with the documented signature

#### Scenario: Calling without arguments validates loudly

- **WHEN** a plugin calls `sdk.reconcileCronJobs()` (no args) or with a non-string `ownerKey` or non-array `specs`
- **THEN** the call rejects with a descriptive error
- **AND** no persisted state is touched

### Requirement: ClackSdk Exposes File Watching

The `ClackSdk` interface SHALL include a `watchFile(relativePath: string, callback: () => void): FSWatcher` method. Paths resolve under the plugin's data directory; watchers are torn down on plugin reload. Detailed semantics are codified in the `plugin-file-watch` capability — this requirement only governs the SDK surface.

#### Scenario: SDK method is present on every plugin's SDK instance

- **WHEN** the system creates a `ClackSdk` instance for a plugin during loading
- **THEN** the instance exposes a `watchFile` function with the documented signature

#### Scenario: Watcher is tracked for teardown

- **WHEN** a plugin calls `sdk.watchFile(...)` and receives back an `FSWatcher`
- **THEN** the plugin loader records the watcher in the plugin's load result
- **AND** the watcher is closed when `restartAll()` reloads plugins (before the new init runs)
