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

## Why these rules exist

The bot core (`src/config.ts`, `src/instructions.ts`, etc.) should know NOTHING about specific plugins. A plugin should be removable by deleting its folder and a line in `src/plugins/index.ts` (or wherever plugins are registered) — no other code should reference it.

Without these rules, plugins become entangled with the core: the core can't change without breaking plugins, and plugins can't ship internal refactors without coordinating with the core. The SDK boundary is what keeps both sides flexible.

## Enforcement

A future lint/check may enforce these rules automatically. Until then, code review and `grep '../../config' src/plugins/<name>/**` are the safety net. If you catch a violation in review, fix it — don't ship "we'll clean it up later" exceptions.
