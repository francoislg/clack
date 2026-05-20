# Plugin Interactivity

## Purpose

TBD

## Requirements

### Requirement: Plugin Action Handler Registration

The Clack plugin SDK SHALL expose `sdk.registerAction(key, handler)` allowing a plugin to register a Slack Bolt action listener owned by that plugin. The SDK SHALL auto-prefix the persisted `action_id` matcher as `plugin:<pluginName>:<key>` so plugin authors never write the prefix themselves. `key` MAY be a literal string (exact-match suffix) or a `RegExp` (suffix pattern). When `key` is a `RegExp`, the effective matcher SHALL be a compiled `RegExp` that begins with the literal prefix and includes the supplied pattern as the suffix.

#### Scenario: String key registers a literal-suffix action

- **WHEN** a plugin named `trivia` calls `sdk.registerAction("answer", handler)`
- **THEN** the SDK records a handler entry keyed by the full `action_id` `plugin:trivia:answer`
- **AND** when Slack dispatches a `block_actions` payload with `action_id === "plugin:trivia:answer"`, the registered `handler` is invoked exactly once with the Bolt action context

#### Scenario: RegExp key registers a suffix-pattern action

- **WHEN** a plugin named `trivia` calls `sdk.registerAction(/^answer:[a-z0-9-]+$/, handler)`
- **THEN** the SDK records a handler entry whose matcher accepts any `action_id` matching `/^plugin:trivia:answer:[a-z0-9-]+$/`
- **AND** when Slack dispatches a `block_actions` payload with `action_id === "plugin:trivia:answer:q-123"`, the registered `handler` is invoked

#### Scenario: Action handler receives unmodified Bolt context

- **WHEN** Slack dispatches an action payload routed to a plugin handler
- **THEN** the handler receives the Bolt `SlackActionMiddlewareArgs` shape unchanged (`ack`, `body`, `client`, `action`, `payload`, `respond`, `logger`)
- **AND** the SDK SHALL NOT mutate or strip fields from the payload before delegating

### Requirement: Plugin View Submission Handler Registration

The Clack plugin SDK SHALL expose `sdk.registerView(key, handler)` allowing a plugin to register a Slack Bolt `view_submission` listener owned by that plugin. The SDK SHALL auto-prefix the persisted `callback_id` matcher as `plugin:<pluginName>:<key>`. `key` MAY be a literal string or a `RegExp` under the same suffix-matching rules as `registerAction`.

#### Scenario: View key registers a literal-suffix view callback

- **WHEN** a plugin named `trivia` calls `sdk.registerView("freeform-modal", handler)`
- **THEN** the SDK records a handler entry keyed by the full `callback_id` `plugin:trivia:freeform-modal`
- **AND** when Slack dispatches a `view_submission` payload whose `view.callback_id === "plugin:trivia:freeform-modal"`, the registered `handler` is invoked exactly once

#### Scenario: View handler receives unmodified Bolt context

- **WHEN** Slack dispatches a view submission routed to a plugin handler
- **THEN** the handler receives the Bolt `SlackViewMiddlewareArgs` shape unchanged (`ack`, `body`, `view`, `client`, `payload`, `logger`)
- **AND** the SDK SHALL NOT mutate or strip fields from the payload before delegating

### Requirement: Plugin Namespacing on Action and View IDs

Every action or view registered via the plugin SDK SHALL have its persisted `action_id` / `callback_id` matcher begin with the literal `plugin:<pluginName>:` prefix. The SDK SHALL reject any registration whose `key` already begins with `plugin:` (defensive — prevents double-prefixing typos).

#### Scenario: Double-prefix rejected at registration

- **WHEN** a plugin calls `sdk.registerAction("plugin:trivia:answer", handler)`
- **THEN** the SDK throws an error with a message indicating the prefix is reserved
- **AND** no handler is recorded for that key

#### Scenario: Distinct plugins do not collide

- **WHEN** plugin `trivia` registers action key `answer` and plugin `weather` also registers action key `answer`
- **THEN** each registers a distinct full `action_id`: `plugin:trivia:answer` and `plugin:weather:answer`
- **AND** dispatching `plugin:trivia:answer` invokes the `trivia` plugin's handler only

### Requirement: Single Wildcard Dispatch at App Setup

The Slack app setup SHALL register exactly one wildcard `app.action(/^plugin:/, ...)` listener and exactly one wildcard `app.view(/^plugin:/, ...)` listener. Both listeners SHALL consult the plugin handler registry by full `action_id` / `callback_id` and delegate to the matching plugin handler. When no handler is found for a `plugin:`-prefixed ID, the wildcard listener SHALL call `ack()` and log a warning (treating the orphan as a no-op so Slack does not see an unhandled-action timeout).

#### Scenario: Registered handler is dispatched through the wildcard

- **WHEN** `app.action` fires for `action_id === "plugin:trivia:answer"` and `trivia` has registered a handler for `answer`
- **THEN** the wildcard listener resolves the handler via the registry
- **AND** invokes it with the unmodified Bolt context

#### Scenario: Orphan plugin action does not crash the app

- **WHEN** `app.action` fires for `action_id === "plugin:ghost:foo"` and no plugin has registered a handler for that key
- **THEN** the wildcard listener calls `ack()`
- **AND** logs a `warn`-level message identifying the unrouted ID
- **AND** does not throw

#### Scenario: Non-plugin actions are not affected

- **WHEN** `app.action` fires for `action_id === "open_settings"` (a built-in Home Tab action)
- **THEN** the wildcard plugin listener is not invoked
- **AND** the existing built-in handler runs normally

### Requirement: Plugin Reload Clears Owned Handlers

When the plugin lifecycle reloads a plugin, the framework SHALL clear all action handlers and view handlers owned by that plugin from the dispatch registry before invoking the plugin's init function again. After the init re-runs, the registry holds only handlers registered during the new init.

#### Scenario: Reload clears stale handlers

- **WHEN** plugin `trivia` is loaded and registers an `answer` action handler
- **AND** the lifecycle reloads `trivia`
- **THEN** the registry slot for `plugin:trivia:*` is cleared before the new init runs
- **AND** the prior handler is no longer reachable via the dispatcher

#### Scenario: Reload preserves other plugins' handlers

- **WHEN** plugin `trivia` and plugin `weather` are both loaded with action handlers registered
- **AND** only `trivia` is reloaded
- **THEN** `weather`'s registry entries are untouched
- **AND** dispatch for `plugin:weather:*` continues to work uninterrupted

### Requirement: Plugin Load Result Exposes Interactivity Handlers

The `PluginLoadResult` returned by plugin loading SHALL include `actionHandlers` and `viewHandlers` collections that the lifecycle layer reads to populate the dispatch registry on load and to clear the registry on reload. Each handler entry SHALL carry the full prefixed matcher (string or RegExp) and the handler function.

#### Scenario: Harvest captures registered handlers

- **WHEN** a plugin init calls `sdk.registerAction("answer", handler)` and `sdk.registerView("freeform-modal", viewHandler)`
- **AND** plugin loading harvests the SDK
- **THEN** the resulting `PluginLoadResult` contains an `actionHandlers` entry with matcher `"plugin:<pluginName>:answer"` and the registered handler
- **AND** contains a `viewHandlers` entry with matcher `"plugin:<pluginName>:freeform-modal"` and the registered view handler

#### Scenario: Empty harvest when plugin registers no interactivity

- **WHEN** a plugin init registers tools and instructions but no actions or views
- **THEN** the resulting `PluginLoadResult` contains an empty `actionHandlers` collection and an empty `viewHandlers` collection (not undefined)
