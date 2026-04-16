## Why

The Trivia plugin's scheduled behavior (daily question, answer reveal) lives as fat prompts inside `cron-jobs.json` — hundreds of lines of game-show persona, step sequences, formatting rules, and voter categorization logic stored outside the plugin code. Editing the behavior means editing mutable JSON rather than versioned source. There is also no way for Clack to record when a user is caught cheating during the game.

This change moves the schedule prompts into the plugin as tools that return instruction text on demand, adds a `save_cheating` tool for recording cheat attempts, and introduces a setup tool that admins use to bootstrap the required cron jobs. The plugin becomes self-contained: install it, call one tool, get working schedules.

## What Changes

- Add `create_schedules_instructions` tool (admin-gated) that returns the recipe for creating both trivia cron jobs.
- Add `send_questions_instructions` tool (admin-gated) that returns the full prompt for the question-posting scheduled run.
- Add `process_responses_instructions` tool (admin-gated) that returns the full prompt for the answer-reveal scheduled run.
- Add `save_cheating` tool (member-gated, hidden from UI) that appends a cheat report to `cheats.json`, increments `cheatAttempts` on the user profile, and signals the caller to DM the owner. Tool execution is suppressed from Slack task cards.
- Add `cheatAttempts` field to `TriviaUser` type.
- Persist cheat reports in a new `cheats.json` file inside the plugin's data directory.
- Ship a `trivia-check` instruction via `sdk.addInstruction("user", "trivia-check", ...)` — loaded for every session — that tells Claude how to detect in-session cheating attempts (random-fact requests, echoes of previous questions) and to call `save_cheating` plus DM the configured owner when detected. The instruction is based on the existing `data/configuration/user/trivia-check.md` content, which continues to override the plugin default via the cascading config resolver.
- Extend the plugin SDK's `ToolMapping` to support `hidden: true`, enabling plugins to register UI-suppressed tools.
- Remove `TRIVIA_INSTRUCTIONS` static instruction registration from the trivia plugin — all trivia prompt content now lives inside instruction-tools.
- **BREAKING** Remove `ClackSdk.requireToolsForScheduled` — plugin-wide required-tools enforcement is replaced by per-schedule `requiredTools` configured via `create_schedules_instructions`.
- Leave the two existing live trivia cron jobs untouched; admins may re-run `create_schedules_instructions` manually to migrate them.

## Capabilities

### New Capabilities
- `trivia-cheating-detection`: recording cheat attempts against users, persisting reports, and notifying the owner.
- `trivia-scheduled-prompts`: plugin-owned instruction-tools that return scheduled-run prompts on demand, plus the setup-recipe tool admins invoke to create the cron jobs.

### Modified Capabilities
- `clack-plugins`: `ToolMapping` gains an optional `hidden` flag; the `requireToolsForScheduled` SDK method is removed.

## Impact

- **Code**: `src/plugins/trivia/` (new tool files, type extension, removal of `TRIVIA_INSTRUCTIONS`), `src/plugins/sdk.ts` (ToolMapping + method removal), `src/streaming/toolMappingLoader.ts` (honor per-mapping `hidden`), `src/plugins/sdk.test.ts` (remove requireToolsForScheduled tests).
- **Data**: new `data/plugins/trivia/cheats.json`; existing `users.json` schema gains optional `cheatAttempts` field (backwards compatible).
- **Config**: existing trivia cron jobs in `data/state/cron-jobs.json` continue to work unchanged; new jobs created via the setup tool use thin prompts.
- **SDK surface**: one removed method — only the trivia plugin calls it today (introduced in `archive/2026-04-15-enforce-required-tools`), so no downstream migration.
