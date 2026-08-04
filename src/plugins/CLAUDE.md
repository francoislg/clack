# Plugin Hard Rules

These rules apply to every file under `src/plugins/<name>/**` (e.g. `src/plugins/trivia/`, `src/plugins/tenor-gif/`). They are non-negotiable — the boundary they enforce is what makes plugins replaceable, testable, and safe to evolve independently of the bot core.

## 1. Never import code from outside the plugin folder

**The one-surface rule** — a file under `src/plugins/<name>/**` may import ONLY:

1. **Files inside its own plugin directory.**
2. **The SDK surface**: top-level files of `src/plugins-sdk/` — usually just the façade `"../../plugins-sdk/sdk.js"` (types like `ClackSdk`, `ClackPlugin`, `CronJobSpec`, `SlackBlocks`, AND the pure helpers: `textResult`, `errorResult`, `zodErrorToResult`, `validateBlocks`, `postStructuredMessage`, the image-search contract, …). The façade is import-time light (types + pure modules only; the implementation lives in `plugins-sdk/internal/`), so value-importing it from anywhere in a plugin is safe. The sibling leaf modules (`toolResults.js`, `zodResult.js`, `imageSearchResult.js`) are also importable directly, but `plugins-sdk/internal/**` is NEVER importable from a plugin.
3. **Third-party packages**: `zod`, `@anthropic-ai/claude-agent-sdk`, `cron-parser`, etc. — anything from `node_modules`.
4. **Node built-ins**: `node:fs`, `node:path`, etc. — but prefer the SDK's `readFile`/`writeFile`/`watchFile` for plugin-data I/O so paths stay scoped.
5. **Test files only** (`*.test.ts`): additionally `"../../plugins-sdk/testHelpers.js"` — `parseToolResult`, `toolResultText`, `createClackSdk`, `createMemorySurface`.

Nothing else. Not `src/config.ts`, not `src/logger.ts`, not `src/slack/...`, not `src/tools/...`, not another plugin's directory, not `src/plugins-core/...` (the plugin loader), and not `plugins-sdk/internal/**`. `*.integration.test.ts` files are exempt (their purpose is testing the plugin↔core seam).

If you find yourself wanting to import the bot's `logger`, use `sdk.logger` instead. If you need a type the bot defines (e.g. `JsonValue`, `UserRole`), check whether `sdk.js` exports it; if not, the plugin defines its own equivalent.

The façade's export block in `plugins-sdk/sdk.ts` is the **single sanctioned exception** to the repo's no-re-export rule: the boundary IS the re-export point, and routing everything through it is what makes the one-surface rule possible. Don't replicate the pattern elsewhere.

## 2. Use the SDK as the entry point

The SDK (`src/plugins/sdk.ts`) is the contract between the bot and the plugin. Everything the plugin does — registering tools, instructions, cron jobs, reading/writing files, logging, querying Slack — flows through the `ClackSdk` interface.

Specifically:

- File I/O under `data/plugins/<name>/`: use `sdk.readFile(path)` / `sdk.writeFile(path, content)` / `sdk.watchFile(path, cb)`. Never `node:fs` with absolute paths into `data/`.
- Logging: `sdk.logger.{debug,info,warn,error}`. Never `console.log` for production output, never import `../../logger.js`.
- Cron jobs: `sdk.reconcileCronJobs(...)` with `CronJobSpec[]`. Never write to `data/state/cron-jobs.json` directly. `CronJobSpec.channel` is OPTIONAL — omit it to declare a channelless job that decides its delivery destination at fire time. Channelless runs get the `optional-post-to` `submit_response` schema: deliver via a `deliver_to` array (each entry names an explicit `channel`) OR terminate with `skip_response: true`. Providing neither is a hard error — `deliver_to` is the only legitimate delivery.
- Slack: `sdk.dmOwner(...)` (DM the deployment owner), `sdk.dmUser(userId, text, opts?)` (DM any user — plugin-trusted, fail-soft), `sdk.getSlackClient(...)` (for advanced cases). Never import from `src/slack/...`.
- Personal preferences: `sdk.registerPreferences({ schema, fields, title? })` declares per-user toggle fields rendered into the Home Tab settings modal (field labels and the optional `title` section header resolve through the plugin's own `sdk.t` dictionary; a label with no translation renders literally, e.g. a per-item name); `sdk.preferences.get(userId, schema)` reads back the user's slice. This is a USER-owned choice store — read-only for the plugin — distinct from `sdk.users.data(schema)`, which is the plugin's own read/write extension namespace.

If the SDK is missing a capability you need, **expand the SDK** rather than reaching past it. Adding a new SDK method is a deliberate API decision; bypassing the SDK silently breaks the contract for every other plugin.

## 3. Define your own types

Plugin domain types (e.g. trivia's `TriviaConfig`, `TriviaGame`, `TriviaAnswersFormatWeights`) live INSIDE the plugin. They are not shared with the bot core, not exported from `src/config.ts`, and not duplicated across plugins.

If two plugins independently need the "same" type, that's a sign you have two distinct types that happen to have similar shapes today. Keep them separate. The cost of duplication is far lower than the cost of premature coupling.

Parsers, validators, and constants follow the same rule. The trivia plugin's `parseTriviaGames` lives under `src/plugins/trivia/core/`, NOT in `src/config.ts`.

## 4. Prefer hot-reload over soft-restart

When a plugin owns a file (config, data, instruction overrides), **react to changes by hot-reloading, not by `sdk.requestSoftRestart`** — unless the change touches something that can only be wired at init. A soft restart tears down and re-runs the whole plugin: it re-reconciles cron jobs, re-registers tools, and re-installs instructions, but it also coalesces concurrent restarts (rapid edits get "already in flight — skipping", so intermediate triggers are dropped) and, in container deployments, churns the process enough to wipe `docker logs` history. Reach for it only when nothing cheaper covers the change.

Decide by what the changed value feeds:

- **Read live by a tool handler** (a threshold, a flag, a list a tool iterates at call time) → **pure hot-reload.** `sdk.watchFile(file, cb)` where `cb` re-parses and updates an in-memory cache; the tool's synchronous accessor returns the new value on the next call. No restart.
- **Baked into a cron prompt** (e.g. casual-talk embeds its channel list / die / topics into the cron job's prompt at `reconcileCronJobs` time) → **hot-reload by re-reconciling.** The `watchFile` callback rebuilds the prompt and calls `sdk.reconcileCronJobs(...)` again. `reconcileCronJobs` is idempotent and callable after init, so this updates the spec in place — still no restart.
- **Wired only at init** — tool registration/gating (`registerTool` behind a config gate, like trivia's seasons-gated tools), `registerMcpServer`, or `addInstruction`/`addTopicInstruction` content → **soft restart is required**, because the SDK only exposes those during plugin load. Pair it with a cache reload (`watchFile` → update cache **and** `requestSoftRestart`) so tool calls in the debounce+restart gap still observe the new state. This is what `trivia/core/configBridge.ts` does, and why it can't fully escape the restart.

The rule of thumb: a config field that only affects _runtime behavior_ (prompts, thresholds, lists) is hot-reloadable; a field that affects the plugin's _surface area_ (which tools/servers/instructions exist) needs a restart. If you find yourself soft-restarting for a runtime-only field, switch to `watchFile` + re-reconcile.

## Topics vs MCP Servers — two related-but-distinct concepts

The bot uses two concepts joined by a shared name convention. When you author a plugin, knowing which is which prevents confused-mental-model bugs.

- A **topic** is a keying axis for instruction files. Files live at `topics/<name>/*.md` (on-disk or as plugin virtual defaults). Loaded when the topic is active for the session — pre-attached via `CronJobSpec.attachedTopics` or runtime-attached via `attach_integration`. Plugin SDK touch points: `sdk.addTopicInstruction(role, topic, filename, content)`, `CronJobSpec.attachedTopics`. Handles returned by `sdk.registerMcpServer(...)` expose a convenience method `handle.addTopicInstruction(role, filename, content)` that auto-keys the topic to the server's full name.

- An **MCP server** is the container for plugin tools. Every plugin has an implicit always-on default server (`sdk.mcpServer`, full name = plugin name, tools at `mcp__<plugin>__<tool>`); tools registered via the SDK shorthand `sdk.registerTool(...)` land there. Plugins can additionally declare **on-demand servers** via `sdk.registerMcpServer(name, { autoload, description })` — the returned handle is the binding point for tools and (paired) topic instructions on that server. On-demand servers (`autoload: false`) become a catalog entry that Claude can `attach_integration("<plugin>:<name>")`; attaching calls `setMcpServers` and the server's tools become available on the next turn. Tools live at `mcp__<plugin>_<name>__<tool>`.

By convention an on-demand server's full name (`<pluginName>:<key>`) doubles as the topic name for its instructions — `handle.addTopicInstruction(...)` makes this automatic. But the two are distinct concerns:

- Instructions are **topic-things**.
- Tool grouping and catalog discoverability are **server-things**.

A plugin that ships an admin-only toolkit (like trivia's management tools) does it through a handle:

```ts
const management = sdk.registerMcpServer("management", {
  autoload: false,
  description: "Manage trivia games, seasons, categories",
});
management.addTopicInstruction("admin", "manage", MANAGEMENT_INSTRUCTION);
management.registerTool("admin", createUpsertSeasonTool(data), "Upserting season — {game}/{slug}");
// ... more management.registerTool(...) calls bind to the same on-demand server
```

The `name` you pass to `registerMcpServer` is the SUFFIX — the SDK auto-prefixes with the plugin name to produce the full public name. `name` MUST NOT contain `:` (the SDK enforces this). The full name `<pluginName>:<name>` is globally unique across all plugins, so no cross-plugin collisions are possible. The MCP-namespace tool names become `mcp__<plugin>_<name>__<tool>` (`:` → `_` because MCP names can't contain colons).

Tools registered via the SDK shorthand `sdk.registerTool(...)` are equivalent to `sdk.mcpServer.registerTool(...)` — the explicit form is rarely needed.

## Why these rules exist

The bot core (`src/config.ts`, `src/instructions.ts`, etc.) should know NOTHING about specific plugins. A plugin should be removable by deleting its folder and a line in `src/plugins/index.ts` (or wherever plugins are registered) — no other code should reference it.

Without these rules, plugins become entangled with the core: the core can't change without breaking plugins, and plugins can't ship internal refactors without coordinating with the core. The SDK boundary is what keeps both sides flexible.

## Enforcement

The one-surface rule is enforced statically by `src/plugins-core/pluginBoundary.guard.test.ts`, which resolves every import specifier under `src/plugins/<name>/**` and fails the suite on any violation — and the pre-commit hook runs the full suite, so a violation is uncommittable. The guard has NO per-file exception mechanism: when a plugin needs a capability the SDK lacks, grow the SDK surface (a module export in `plugins-sdk/sdk.ts` if pure, a `ClackSdk` instance member wired through `plugins-sdk/internal/factory.ts` if stateful) — never work around the guard.

The same guard enforces the layer layout: `src/plugins/` contains ONLY plugin directories; `src/plugins-sdk/` top-level is the plugin-facing surface, with the implementation in `plugins-sdk/internal/` (bridge code — may import bot core) and the pure leaf modules (`toolResults.ts`, `zodResult.ts`, `imageSearchResult.ts`) importing only npm packages and node builtins so they can never form an import cycle; `src/plugins-core/` holds the core-facing plugin loader (`registry.ts`, `state.ts`) that plugins never touch.
