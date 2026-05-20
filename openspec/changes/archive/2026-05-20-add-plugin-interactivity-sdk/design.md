## Context

The Clack plugin SDK (`src/plugins/sdk.ts`) today gives plugins five primitives: tool registration, instruction registration, file I/O, file watching, and cron job reconciliation. Slack interactivity — `app.action(...)`, `app.view(...)` — is exclusively handled by static handlers in `src/slack/handlers/`, registered at startup in `src/slack/app.ts`. There are roughly 25 such registrations today, all owned by core surfaces (Home Tab, change-thread buttons, config update flows).

The trivia plugin's upcoming free-form answer feature needs an `[Answer]` button that opens a modal — and there's no clean place for that to live without either (a) editing `src/slack/handlers/` from a plugin's source tree, which violates the plugin boundary, or (b) duplicating the wildcard-dispatch pattern inside each plugin. Neither is acceptable.

Bolt's API for handler registration is one-way: `app.action(matcher, handler)` cannot be undone. That's a load-bearing constraint when plugin reload is a routine operation (config file watches reload plugins; `npm run dev` reloads them on TS changes). Any solution that calls `app.action()` from plugin init code leaks handlers across reload generations.

Stakeholders: plugin authors (need a clean API), the core team (need lifecycle safety on reload), and Bolt itself (we work within its constraints).

## Goals / Non-Goals

**Goals:**

- Give plugins a first-class API for registering Slack actions and view submissions without touching core handler code.
- Namespace plugin-owned action and callback IDs so collisions with built-in IDs are structurally impossible.
- Keep plugin reload safe: stale handlers from prior generations stop firing the moment the new init runs.
- Minimize Bolt surface: register exactly two wildcard listeners total (one for actions, one for views), regardless of how many plugins or handlers exist.
- Preserve the existing Bolt middleware shape so plugin authors can use Bolt types directly (no wrapper abstraction over `BlockAction`, `ViewSubmitAction`).

**Non-Goals:**

- Generic event support (`app.event("app_home_opened", ...)`, `message`, etc.). Out of scope for v1 — actions and view submissions are sufficient for the trivia free-form use case. Adding events later follows the same registry pattern.
- Shortcuts (`app.shortcut(...)`) and global slash commands. Same reasoning — defer to a follow-up if a plugin needs them.
- Plugin-to-plugin handler delegation or chaining. Plugins own their own ID prefixes; there is no cross-plugin routing.
- Replacing the existing built-in Home Tab / changes-workflow handlers. They continue to use `app.action(...)` directly in `slack/handlers/`. This change adds a parallel path for plugins; it does not refactor existing handlers.
- Persistence of registrations. Handlers live in memory only — restart re-runs plugin init and re-registers everything from scratch.

## Decisions

### Decision 1: Registry + single wildcard, not per-handler `app.action(...)` calls

Two `app.action(/^plugin:/, dispatch)` listeners (one for actions, one for views) at Slack app setup. A mutable in-memory `Map<fullId, handler>` records the live handlers. Plugin init calls `sdk.registerAction(...)` populate the map; plugin reload clears the plugin's entries before the new init runs.

**Why not call `app.action(...)` directly from `sdk.registerAction`?** Bolt does not support unregistration. Each reload would add a duplicate listener; eventually every action call would invoke every prior generation's handler. The registry pattern sidesteps Bolt's listener-list growth entirely — Bolt sees two listeners, ever.

**Why one wildcard rather than per-plugin wildcards (`/^plugin:trivia:/`, `/^plugin:weather:/`)?** Same reason: per-plugin wildcards still grow Bolt's listener list on every reload. One global wildcard keeps Bolt's surface fixed.

**Alternative considered:** Have `sdk.registerAction` return a `Disposable` and rely on plugins to clean up. Rejected because (a) it pushes lifecycle complexity onto plugin authors and (b) it doesn't solve Bolt's no-unregister limitation — the disposable would only stop firing, not actually unregister.

### Decision 2: `plugin:<name>:<key>` namespacing, auto-prefixed by the SDK

Every registered action and view callback ID begins with the literal `plugin:<pluginName>:` prefix, written by the SDK on the plugin author's behalf. Plugin authors pass only the suffix (`"answer"`, `/^answer:/`). Block Kit code in the plugin uses the full prefixed string when building buttons / modals — typically by reading a small helper that mirrors the SDK's prefixing.

**Why a structural prefix rather than runtime collision detection?** Collision detection at registration time only catches plugin-vs-plugin collisions, not plugin-vs-built-in (the built-in handlers in `slack/handlers/` don't go through the SDK). A structural prefix means built-in action IDs (e.g. `open_settings`, `cron_edit_job:42`) can never collide with plugin IDs by construction.

**Why `plugin:` not `p:` or `_plugin_`?** Readability when grepping the codebase or inspecting a Slack interaction payload. `plugin:trivia:answer` is unambiguous; `p:t:a` would not be.

**Why reject `key`s already prefixed with `plugin:`?** A plugin author who writes `sdk.registerAction("plugin:trivia:answer", ...)` thinking they need to include the prefix would silently produce `action_id === "plugin:trivia:plugin:trivia:answer"` and wonder why nothing fires. Defensive rejection turns the typo into a startup error.

### Decision 3: Plugin authors get raw Bolt middleware context

Handlers receive `SlackActionMiddlewareArgs` / `SlackViewMiddlewareArgs` unchanged. The SDK is a registration façade, not a Bolt wrapper.

**Why not wrap?** A wrapper would have to translate Bolt's evolving middleware shape into our own type. Bolt v4 already has a complete, well-typed middleware context (`ack`, `body`, `client`, `payload`, `respond`, `logger`). Wrapping adds maintenance for negative gain.

**Trade-off:** Plugin authors need to know Bolt. We consider that acceptable — `@slack/bolt` is a peer of `@anthropic-ai/claude-agent-sdk` in the project and plugin authors are already expected to be familiar with it.

### Decision 4: Orphan IDs are warned and acked, not crashed

When the wildcard dispatcher sees a `plugin:`-prefixed ID that has no registered handler (e.g., a button from a stale message after the plugin that owned it was uninstalled), it calls `ack()` and logs a `warn`. It does not throw.

**Why?** A stale button click should not crash the bot or leave Slack staring at a "we'll respond shortly" timeout indicator. Logging is enough to surface the case in operational metrics without bricking the interaction.

**Alternative considered:** Show the user an ephemeral "this action is no longer available" message. Rejected as premature polish — we can add it later if the warning logs show real user-visible orphans rather than just dev-loop noise.

### Decision 5: Lifecycle clear happens before re-init, in `PluginLoadResult`

Plugin reload is owned by the existing lifecycle layer (which already closes file watchers). It will: (1) take the prior `PluginLoadResult`'s `actionHandlers` / `viewHandlers`, (2) remove each entry from the registry by full ID, (3) re-run the plugin init, (4) install the new `PluginLoadResult`'s entries into the registry.

**Why before re-init rather than after?** If the init is in-flight and a Slack action fires for the reloading plugin, the prior generation's handler would be invoked from stale state. Clearing first means the worst case is an orphan-warn during the reload window — strictly better than running stale logic.

**Why per-ID removal rather than registry-wide rebuild?** Other plugins' handlers in the same registry must keep working. Per-ID removal preserves their entries; a rebuild would temporarily blank everyone out.

### Decision 6: No persistence of registrations

The registry is in-memory only. On process restart, plugins re-run their init and re-register everything.

**Why?** Persistence buys nothing — handlers are JS closures, not data. The init code is the source of truth.

## Risks / Trade-offs

- **[Risk] Plugin author bypasses the SDK and calls `app.action` directly.** Nothing structurally prevents this, since the Bolt app is accessible if a plugin pulls it from `slack/app.ts`. → **Mitigation**: The SDK is the documented path; direct Bolt calls are not part of the plugin contract. Code review catches bypass; nothing else can.

- **[Risk] Two plugins with the same name collide in the registry.** The same-name case is already rejected at plugin load by the MCP server collision check (specs/clack-plugins / "No Plugin-vs-Plugin Name Collision"). → **Mitigation**: Existing safety carries forward. No new check needed at the action-registry level — same-name plugins never both load.

- **[Risk] Bolt changes its middleware-context shape in a future major version.** Plugin handlers would need to adapt. → **Accepted**: We pin Bolt at v4 in `package.json`; major version bumps are coordinated upgrades anyway.

- **[Trade-off] Orphan warnings on every reload during dev.** When a plugin reloads, any in-flight Slack action from before the reload may hit the orphan path briefly. → **Accepted**: Warning logs are dev-loop noise but operationally useful in prod. We can downgrade to debug-level if it becomes a problem.

- **[Trade-off] No event support in v1.** A plugin that wants `app_home_opened` or `message` can't subscribe through the SDK. → **Accepted**: Out of scope; the registry pattern extends naturally if needed.

## Migration Plan

This change is additive — nothing existing breaks.

1. Land `src/slack/pluginActionRegistry.ts` with the registry + dispatcher.
2. Wire two wildcard listeners in `src/slack/app.ts`. Verify existing built-in handlers continue to work (smoke test the Home Tab and a changes-workflow action).
3. Add `registerAction` / `registerView` to `src/plugins/sdk.ts` and the `PluginLoadResult` harvest.
4. Update `src/plugins/lifecycle.ts` (or equivalent) to clear the plugin's registry slot on reload, immediately before the new init runs.
5. Ship. No existing plugin uses these methods yet; no data migration; no rollout phasing required.

**Rollback:** Revert the PR. Existing functionality is untouched.

## Open Questions

- **Should the SDK provide a Block Kit helper for prefixed action IDs?** A small utility like `sdk.actionId("answer")` returning `"plugin:<name>:answer"` would prevent plugin authors from typing the prefix themselves when building Block Kit. Default decision: yes — add it as a trivial helper to keep authoring symmetric.
- **Where should orphan-warning telemetry surface?** Today, plugin warnings go to the standard logger. If orphan rate becomes operationally interesting, we may want to count them by plugin name for a Home Tab health view. Punted to a follow-up.
