## 1. Registry module

- [x] 1.1 Create `src/slack/pluginActionRegistry.ts` with two maps: `actionHandlers: Map<string, ActionHandler>` and `viewHandlers: Map<string, ViewHandler>` (both keyed by full prefixed ID); also support regex entries via a second list `actionPatterns: Array<{ pattern: RegExp; handler }>` and `viewPatterns: Array<{ pattern: RegExp; handler }>`
- [x] 1.2 Define `ActionHandler` and `ViewHandler` types as aliases for the relevant Bolt middleware signatures (`(args: SlackActionMiddlewareArgs<BlockAction>) => Promise<void>`, `(args: SlackViewMiddlewareArgs<ViewSubmitAction>) => Promise<void>`)
- [x] 1.3 Implement `registerAction(fullId: string | RegExp, handler)` — string key stores into the literal map, RegExp into the pattern list
- [x] 1.4 Implement `registerView(fullCallbackId: string | RegExp, handler)` — symmetric to actions
- [x] 1.5 Implement `unregisterByPluginName(pluginName: string)` — iterate both maps and pattern lists, drop every entry owned by the named plugin (tracked via the registered `pluginName` field rather than parsing the key — more robust against pattern-source serialization quirks)
- [x] 1.6 Implement `dispatchAction(fullId, context)` — try literal map first (O(1)), then linear-scan patterns; return `{ handled: true | false }` (the resolution itself is exposed via `findActionHandler` so tests can assert on routing without faking Bolt args)
- [x] 1.7 Implement `dispatchView(fullCallbackId, context)` — symmetric to actions
- [x] 1.8 Unit tests for the registry: register → resolve round-trip (literal + regex), literal beats pattern, registration-order scan for overlapping patterns, unregister-by-plugin-name clears only that plugin's entries, find* returns `null` for unmatched IDs

## 2. SDK additions

- [x] 2.1 In `src/plugins/sdk.ts` `ClackSdk` interface: add `registerAction(key: string | RegExp, handler): void` and `registerView(key: string | RegExp, handler): void` signatures with JSDoc describing the `plugin:<name>:` auto-prefixing
- [x] 2.2 In the SDK factory (`createClackSdk`): implement both methods — they compose the full prefixed key/pattern from `pluginName` and push onto local `actionHandlers[]` / `viewHandlers[]` arrays held in closure
- [x] 2.3 Implement the defensive double-prefix check: when `key` is a string starting with `plugin:`, throw with a clear error; when `key` is a `RegExp` whose source begins with `^plugin:` or `plugin:`, throw the same error
- [x] 2.4 RegExp prefixing: when `key` is a `RegExp` with source `<pattern>`, the effective registered RegExp is a new `RegExp("^plugin:" + pluginName + ":" + originalSource.replace(/^\^/, ""), flags)` — strip a leading `^` from the user pattern before splicing
- [x] 2.5 Extend `PluginLoadResult` to include `actionHandlers: Array<{ key: string | RegExp; handler }>` and `viewHandlers: Array<{ key: string | RegExp; handler }>` — populated from the closure arrays in the `harvest()` function
- [x] 2.6 Unit tests: literal string registration produces the expected prefixed key, RegExp registration produces the expected prefixed pattern (with `^` stripping verified), RegExp flags preserved, double-prefix is rejected for both string and RegExp inputs, harvest exposes both registered handlers

## 3. Slack app wiring

- [x] 3.1 In `src/slack/app.ts` setup: import the registry's `dispatchAction` and `dispatchView`
- [x] 3.2 Register one wildcard listener: `app.action<BlockAction>(/^plugin:/, async (args) => { await args.ack(); ...; if (!result.handled) logOrphanAction(...) })`
- [x] 3.3 Register one wildcard listener: `app.view<ViewSubmitAction>(/^plugin:/, async (args) => { ...; if (!result.handled) { await args.ack(); logOrphanView(...) } })` — handler delegates ack to the plugin; orphan path acks explicitly
- [x] 3.4 Verified by inspection: existing built-in `action_id`s never begin with `plugin:`, so the wildcard cannot shadow them
- [x] 3.5 Test in `src/slack/app.test.ts`: assert exactly one `app.action(/^plugin:/, ...)` and one `app.view(/^plugin:/, ...)` registered after `createSlackApp`

## 4. Lifecycle integration

- [x] 4.1 Located the reload entry point at `src/lifecycle.ts` around the prior-plugins watcher teardown
- [x] 4.2 Before the new init runs: call `unregisterByPluginName(result.name)` for each prior generation entry so stale handlers are dropped
- [x] 4.3 After `loadPlugins` returns: iterate every result's `actionHandlers[]` / `viewHandlers[]`, calling `registerAction(...)` / `registerView(...)` to install in the central registry
- [x] 4.4 Cold-start path: unregister with no prior entries is a no-op; verified in registry tests
- [x] 4.5 Unit tests: cold-start unregister is a no-op, full reload cycle routes to the freshly-registered handler, reload of one plugin leaves another's handlers intact

## 5. Helper for Block Kit authoring

- [x] 5.1 Added `sdk.actionId(key: string): string` returning `plugin:<pluginName>:<key>`
- [x] 5.2 Added `sdk.viewCallbackId(key: string): string` returning the same prefixed shape — symmetric for modal payload authoring
- [x] 5.3 Tests verify both helpers match the SDK's internal prefixing exactly and reject already-prefixed inputs

## 6. Documentation

- [x] 6.1 No standalone plugin-SDK summary section exists in `CLAUDE.md` today; JSDoc on the new SDK methods is the primary documentation surface
- [x] 6.2 Inline JSDoc usage example added to `registerAction` / `registerView` showing the button → handler shape
- [x] 6.3 JSDoc on `RegisteredActionEntry` / `RegisteredViewEntry` explains the lifecycle clear-then-install contract

## 7. Verification

- [x] 7.1 `npx tsc --noEmit` — no type errors
- [x] 7.2 `npm test` — 3889/3889 pass
- [x] 7.3 `npx oxlint src/` — 0 warnings, 0 errors
- [x] 7.4 `npx oxfmt --check src/` — clean
- [x] 7.5 `openspec validate add-plugin-interactivity-sdk --strict` — valid
- [ ] 7.6 Smoke test: load the trivia plugin, register a throwaway action handler in a test branch, click a Slack button with the matching action_id, verify the handler fires; then trigger a plugin reload and verify a stale button click hits the orphan warn path *(manual — requires running the bot against a Slack workspace)*
