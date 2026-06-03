## Why

When a trivia answer is revealed, players often want to know *why* the answer is what it is — the backstory, the trivia behind the trivia. Today the reveal card only offers "See your answer" (a private recap of how they did). There is no way to ask Clack for more depth without leaving the game and starting a separate conversation, and a plugin currently has no way to kick off a Claude Q&A turn in a thread (the only SDK Claude entry point, `askClaude`, is single-turn, tool-less, and creates no session, so it cannot lead to a follow-up conversation).

## What Changes

- Add an optional **"Tell me more"** button next to "See your answer" on the revealed-question card. Configurable on/off at the **game** and **workspace** tiers (off by default).
- On click: remove the button from the shared card (global, one shared conversation), post a short thread reply tagging the clicker (e.g. *"User @alice asked for more information, here we go:"*), then kick off a Claude turn in that thread that surfaces interesting details about the question and its answer.
- The kicked-off thread becomes an **auto-follow** conversation: because a real session is created, subsequent replies continue the conversation through the normal thread auto-respond path.
- Add a new SDK primitive `sdk.startThreadConversation(...)` that lets a plugin start a Claude Q&A turn (full tools, real session, auto-follow) in a given channel/thread — the reusable mechanism the button depends on, wrapping core's `processMessage`.
- Add a new SDK primitive `sdk.sendMessage(...)` — a narrow, `Result`-returning post helper that supports the two delivery shapes a plugin needs (top-level channel message, or threaded follow-up via `threadTs`), so plugins don't reach for the raw `getSlackClient()` client just to post text/blocks.

## Capabilities

### New Capabilities
- `trivia-tell-me-more`: the reveal-card "Tell me more" button — its game/workspace `tellMeMore` config resolution, the click handler (button removal + intro post + thread kickoff), and the prompt/context handed to Claude.
- `plugin-thread-conversation`: a new SDK method, `startThreadConversation`, that lets a plugin programmatically start a Claude Q&A turn in a channel/thread with a real session and auto-follow, using the common chat streamer (normal thinking-card UX, not silent).
- `plugin-send-message`: a new SDK method, `sendMessage`, a narrow `Result`-returning post helper supporting top-level channel messages and threaded follow-ups.

### Modified Capabilities
- `trivia-games`: `upsert_game` and `set_workspace_config` accept the `tellMeMore` field; `list_games` surfaces it (per-game + workspace defaults).

## Impact

- **SDK** (`src/plugins/sdk.ts`, `ClackSdkDeps`): new `startThreadConversation` method (routes through `processMessage` with the common streamer / no `silentThinking`) + injected dep bound to core's `processMessage` (wired in the Slack app/lifecycle layer, mirroring `clackQuery`/`getSlackClient`); new `sendMessage` method (uses the existing `getSlackClient` dep, no new wiring).
- **Core** (`src/slack/handlers/core.ts`): export a `startThreadConversation` binding over `processMessage` (trigger type `autoRespond`, streamed), wired into the SDK dep at the `loadAndInstallPlugins` call sites.
- **Trivia plugin** (`src/plugins/trivia/`): new `tellMeMore` config field + parser + `domain/` resolver (game→workspace→off); new `revealCards/tellMeMoreHandler.ts`; button rendering in `revealCards/editCard.ts`; registration in `index.ts`; surfaced/settable via `tools/games/{upsertGame,setWorkspaceConfig,listGames}.ts`.
- **i18n**: new button label + intro-message strings (en/fr).
- No new third-party dependencies. No data migration (new optional config field; legacy questions without `postedBlocks`/`messageLink` already skip the reveal-card edit, so the button is simply absent there).
