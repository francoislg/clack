## Why

Plugins today can register MCP tools, instructions, file watchers, and cron jobs — but they cannot react to Slack user interactions (button clicks, modal submissions, select-menu changes). Every `app.action(...)` / `app.view(...)` listener in the codebase lives in `src/slack/handlers/` and is wired statically at startup. This is fine for built-in surfaces (Home Tab, change-thread buttons) but blocks any plugin that wants its own interactive UI — for example, a trivia question with an `[Answer]` button that opens a free-form text-entry modal.

Adding interactivity to a plugin shouldn't require editing `slack/app.ts` or `slack/handlers/`. Plugins should declare their action and view handlers through the SDK the same way they declare tools, with namespacing that prevents collisions with built-in handlers and lifecycle teardown on plugin reload.

## What Changes

- **New SDK method — `sdk.registerAction(key, handler)`**: registers a Slack Bolt `action` listener owned by the plugin. `key` is either a string (matches the suffix exactly) or a `RegExp` (matches the suffix). The full Slack `action_id` is auto-prefixed as `plugin:<plugin_name>:<key>` so plugin authors never write that prefix themselves.
- **New SDK method — `sdk.registerView(key, handler)`**: registers a Slack Bolt `view_submission` listener for modal submissions. Same namespacing rules as actions — the `callback_id` is auto-prefixed as `plugin:<plugin_name>:<key>`.
- **Single wildcard dispatch in `src/slack/app.ts`**: one `app.action(/^plugin:/)` and one `app.view(/^plugin:/)` registration delegates to a runtime registry keyed by `(pluginName, key)`. Bolt itself doesn't support unregistration, but the registry is mutable — plugin reload atomically clears that plugin's slot, so stale handlers stop firing.
- **`PluginLoadResult` carries action/view handler tables**: the lifecycle layer reads these on reload and clears the registry slot before re-running the plugin init. This mirrors how `watchers[]` are torn down.
- **Block Kit builders accept plugin-prefixed action IDs**: no spec change needed in `src/slack/blocks.ts` — plugin authors just pass `plugin:<name>:<key>` as the `action_id` on their buttons / modals. The wildcard handler does the dispatch.
- Plugin authors continue to construct Bolt `BlockAction` / `ViewSubmitAction` body shapes via the standard Bolt types — the SDK is a thin registration façade, not an abstraction over Bolt.

## Capabilities

### New Capabilities

- `plugin-interactivity`: Plugin-owned Slack interactivity primitives — action listeners (`registerAction`) and view-submission listeners (`registerView`), with `plugin:<name>:<key>` namespacing, central wildcard dispatch, and reload-safe lifecycle teardown.

### Modified Capabilities

(none — this change adds a new capability without modifying the requirements of `clack-plugins`. The existing plugin-tool/instruction/cron/file-watch primitives are untouched.)

## Impact

- **Code**: New module `src/slack/pluginActionRegistry.ts` (or similar) holding the registry + dispatcher. `src/plugins/sdk.ts` gains the two new SDK methods plus the harvest payload (`actionHandlers`, `viewHandlers`). `src/slack/app.ts` registers the two wildcard listeners. `src/plugins/lifecycle.ts` (or wherever plugin reload lives) clears the registry slot for the reloading plugin before re-running its init.
- **Tests**: New unit tests for the registry (register → dispatch → reload-clear → dispatch returns "no handler"). New SDK harvest tests asserting the new tables are exposed. Wildcard-dispatcher tests with a fake `app.action` / `app.view` capture.
- **External dependencies**: None new. Uses `@slack/bolt`'s existing regex-action and regex-view support.
- **Plugin authors**: New surface available. No existing plugin breaks — the SDK gains methods, doesn't remove any.
- **Migration / data**: None. No persisted state.
- **Documentation**: The plugin SDK section of `CLAUDE.md` should mention the new methods. A short usage example (button → modal → submit) goes in the plugin authoring docs or as a comment block in `sdk.ts`.
