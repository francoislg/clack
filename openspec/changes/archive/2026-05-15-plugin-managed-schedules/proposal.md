## Why

Today, only humans (or Claude on behalf of humans) create cron jobs via `create_scheduled_message`. Plugins can be *tagged* on a job via the optional `CronJob.plugin` field (used to derive default required tools), but they have no way to *own* a schedule declaratively — to say "these are the N jobs my plugin needs to exist" and have the runtime keep that true across config edits, restarts, and admin overrides.

This change introduces the framework that lets a plugin declare and reconcile its own cron jobs. The first consumer is the trivia plugin (tracked in the separate `add-trivia-games` change), but the SDK surface is plugin-agnostic — any future plugin can adopt it. Without this framework, every recurring plugin behavior has to be set up by hand and drift from the plugin's expectations over time.

## What Changes

- **NEW: `ClackSdk.reconcileCronJobs(ownerKey, specs[])`** — declarative API the plugin calls during init. Diffs against existing `plugin === ownerKey` jobs: upserts entries in `specs[]`, deletes prior plugin-owned jobs not in `specs[]`. Preserves the admin-toggled `enabled` state across reconciles (admin override).
- **NEW: `ClackSdk.watchFile(relativePath, callback)`** — plugin-scoped file watcher (resolves under the plugin's `data/plugins/<name>/` dir, like `readFile`/`writeFile`). Returns an `FSWatcher`. The factory wires teardown into plugin reload so a reload doesn't double-fire callbacks across generations.
- **NEW: `data/config.json` watcher** — `startConfigWatcher()` gains a watcher for `data/config.json` that triggers the existing `restartAll()` reload pipeline. Currently the watcher only fires for MCP and instruction files; this change adds the config file. Plugins observe config changes "for free" because their init re-runs on every reload.
- **CHANGED: `CronJob` admin-override fields.** Add `pluginManaged?: boolean` (true when the row was created by a plugin's `reconcileCronJobs`) and `specKey?: string` (stable per-plugin identity). Reconcile preserves the existing `enabled` flag on matching jobs — an admin pause sticks even if the spec stays in config.
- **CHANGED: User-facing edit/delete tools.** `update_scheduled_message` and `delete_scheduled_message` (and the Home Tab affordances) reject jobs where `pluginManaged === true`. Toggling `enabled` from the Home Tab is still permitted — that's the admin-override path.
- **CHANGED: Home Tab Scheduled Messages section splits into two subsections** — "Scheduled Messages" (user-created, full edit/delete/enable controls as today) and "Plugin Scheduled Messages" (`pluginManaged: true`, read-only details + Enable/Disable only, no Edit, no Delete). The plugin section is admin-only.

## Capabilities

### New Capabilities

- `plugin-cron-reconciliation`: Declarative SDK API (`reconcileCronJobs`) for plugins to manage their own cron jobs, including admin-override preservation and the `pluginManaged` flag on `CronJob`.
- `plugin-file-watch`: SDK `watchFile` primitive scoped to the plugin's data directory, plus `data/config.json` watching wired through the existing config watcher to trigger plugin reload.

### Modified Capabilities

- `clack-plugins`: Adds two new SDK methods (`reconcileCronJobs`, `watchFile`) to the `ClackSdk` interface contract. New requirements covering their semantics, scoping, and lifecycle integration with plugin reload.
- `cron-messages`: Adds `pluginManaged: boolean` and `specKey?: string` to the cron job data model and codifies the admin-override-preservation rule for plugin-managed jobs (existing `enabled` flag is respected by reconcile). Also gates `update_scheduled_message`/`delete_scheduled_message` to reject plugin-managed jobs.
- `home-tab`: Splits the Scheduled Messages section into two subsections with different control sets for plugin-managed entries.

## Impact

- **Code:** `src/plugins/sdk.ts` (SDK additions, `CronJobSpec` type, reconcile + watchFile implementations, `PluginLoadResult.watchers`), `src/cronJobs.ts` (`pluginManaged` + `specKey` fields, `findByPluginOwner` helper, `CreateCronJobParams` extension), `src/configWatcher.ts` (`data/config.json` watcher), `src/lifecycle.ts` (close plugin watchers before reload), `src/tools/actions/updateScheduledMessage.ts` + `cancelScheduledMessage.ts` (reject plugin-managed jobs), `src/slack/homeTab.ts` (split section + new render path).
- **Tests:** SDK reconcile unit tests (upsert/delete/preserve-enabled), `watchFile` lifecycle, Home Tab split rendering, config-watcher → plugin-reload integration, cron data model.
- **Data:** `pluginManaged` and `specKey` fields added to `CronJob` records (defaults absent for user-created jobs — backwards-compatible).
- **External:** No external API changes. Adoption is opt-in per plugin. The first consumer is trivia (`add-trivia-games` change).
- **Dependencies:** None new (`cron-parser` is already a dependency).
