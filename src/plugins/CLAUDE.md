# Plugin Hard Rules

These rules apply to every file under `src/plugins/<name>/**` (e.g. `src/plugins/trivia/`, `src/plugins/tenor-gif/`). They are non-negotiable — the boundary they enforce is what makes plugins replaceable, testable, and safe to evolve independently of the bot core.

## 1. Never import code from outside the plugin folder

Plugin code MUST NOT import from `src/config.ts`, `src/logger.ts`, `src/slack/...`, `src/instructions.ts`, or anywhere else in `src/` that lives outside the plugin's own directory.

The only exceptions are:

- **The plugin SDK**: `import type { ClackSdk, ClackPlugin, CronJobSpec, ... } from "../sdk.js"` (or `"../../sdk.js"` from nested files).
- **Third-party packages**: `zod`, `@anthropic-ai/claude-agent-sdk`, `cron-parser`, `simple-git`, etc. — anything from `node_modules`.
- **Node built-ins**: `node:fs`, `node:path`, etc. — but prefer the SDK's `readFile`/`writeFile`/`watchFile` for plugin-data I/O so paths stay scoped.

If you find yourself wanting to import the bot's `logger`, use `sdk.logger` instead. If you need a type the bot defines (e.g. `JsonValue`, `UserRole`), check whether the SDK re-exports it; if not, the plugin defines its own equivalent.

## 2. Use the SDK as the entry point

The SDK (`src/plugins/sdk.ts`) is the contract between the bot and the plugin. Everything the plugin does — registering tools, instructions, cron jobs, reading/writing files, logging, querying Slack — flows through the `ClackSdk` interface.

Specifically:

- File I/O under `data/plugins/<name>/`: use `sdk.readFile(path)` / `sdk.writeFile(path, content)` / `sdk.watchFile(path, cb)`. Never `node:fs` with absolute paths into `data/`.
- Logging: `sdk.logger.{debug,info,warn,error}`. Never `console.log` for production output, never import `../../logger.js`.
- Cron jobs: `sdk.reconcileCronJobs(...)` with `CronJobSpec[]`. Never write to `data/state/cron-jobs.json` directly.
- Slack: `sdk.dmOwner(...)`, `sdk.getSlackClient(...)` (for advanced cases). Never import from `src/slack/...`.

If the SDK is missing a capability you need, **expand the SDK** rather than reaching past it. Adding a new SDK method is a deliberate API decision; bypassing the SDK silently breaks the contract for every other plugin.

## 3. Define your own types

Plugin domain types (e.g. trivia's `TriviaConfig`, `TriviaGame`, `TriviaAnswersFormatWeights`) live INSIDE the plugin. They are not shared with the bot core, not exported from `src/config.ts`, and not duplicated across plugins.

If two plugins independently need the "same" type, that's a sign you have two distinct types that happen to have similar shapes today. Keep them separate. The cost of duplication is far lower than the cost of premature coupling.

Parsers, validators, and constants follow the same rule. The trivia plugin's `parseTriviaGames` lives under `src/plugins/trivia/core/`, NOT in `src/config.ts`.

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

A future lint/check may enforce these rules automatically. Until then, code review and `grep '../../config' src/plugins/<name>/**` are the safety net. If you catch a violation in review, fix it — don't ship "we'll clean it up later" exceptions.
