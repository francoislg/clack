## 1. SDK: sendMessage + startThreadConversation primitives

- [x] 1.1 Add `sendMessage` to the `ClackSdk` interface (`src/plugins/sdk.ts`) with options `{ channel; text?; blocks?; threadTs?; suppressUnfurls? }` and `Result` return `{ ok; ts; channel } | { ok: false; error }`
- [x] 1.2 Implement `sendMessage`: require text|blocks, post via `getSlackClient().chat.postMessage` (threaded when `threadTs` set), apply `unfurlOptions`, fail-soft on disconnected client / API error (mirror `dmOwner`)
- [x] 1.3 Add `startThreadConversation` to the `ClackSdk` interface and an optional `startThreadConversation` dep to `ClackSdkDeps`, with options `{ channel; threadTs; userId; prompt; additionalSystemPrompt? }`
- [x] 1.4 Implement the SDK method: fail-soft (logged no-op) when the dep is absent, otherwise delegate to the injected dep
- [x] 1.5 Wire the dep at the `loadAndInstallPlugins` call sites (`src/index.ts`, `src/lifecycle.ts`) to a closure calling `processMessage` with `triggerType: "autoRespond"` and the common streamer (NO `silentThinking`)
- [x] 1.6 Unit-test both methods: `sendMessage` top-level vs threaded vs missing-content vs disconnected; `startThreadConversation` delegates with correct args, no-op when dep missing

## 3. Trivia config: tellMeMore field (game + workspace)

- [x] 3.1 Add `tellMeMore?: { enabled: boolean }` to `TriviaGame` and `TriviaConfig` types (`src/plugins/trivia/core/configTypes.ts`)
- [x] 3.2 Parse + validate the field in the trivia config parsers (reject-and-warn on bad shape, naming tier/game; treat as absent)
- [x] 3.3 Add `domain/tellMeMore.ts` resolver: cascade `game → workspace → { enabled: false }`
- [x] 3.4 Tests for parser (valid/invalid/absent) and resolver (game beats workspace, workspace beats default, default off)

## 4. Trivia config tools

- [x] 4.1 `upsert_game` accepts `tellMeMore` (omit-keeps, null-clears); persist on the game entry (`tools/games/upsertGame.ts`)
- [x] 4.2 `set_workspace_config` accepts `tellMeMore`; persist on workspace config (`tools/games/setWorkspaceConfig.ts`)
- [x] 4.3 `list_games` surfaces `tellMeMore` per-game when set and `workspaceDefaults.tellMeMore` when the workspace tier set it (present-iff-set) (`tools/games/listGames.ts`)
- [x] 4.4 Update the trivia management instruction to document the `tellMeMore` field
- [x] 4.5 Tests for upsert/set/list behavior including null-clear and present-iff-set

## 5. Reveal card: render the button

- [x] 5.1 In `revealCards/editCard.ts`, resolve `tellMeMore` and, when enabled, append a localized "Tell me more" button (`action_id` `tell-me-more:<questionId>`) into the reveal actions block alongside "See your answer"
- [x] 5.2 Add the button-label string to trivia `en`/`fr` dictionaries
- [x] 5.3 Tests: button present when enabled (game/workspace), absent when disabled/default, absent for legacy questions without `postedBlocks`

## 6. Reveal card: click handler

- [x] 6.1 Create `revealCards/tellMeMoreHandler.ts` (clone seeAnswer shape): regex registration `^tell-me-more:[^:]+$`, parse questionId, find owning game/question, derive channel+ts from `messageLink`
- [x] 6.2 On click: rebuild the card from `postedBlocks` minus the tell-me-more button and `chat.update` (global removal); no-op if already removed
- [x] 6.3 Post the localized intro "starter" reply tagging `<@user>` in the question's thread via `sdk.sendMessage({ channel, threadTs, text })`; add the intro string to `en`/`fr`
- [x] 6.4 Call `sdk.startThreadConversation({ channel, threadTs: question ts, userId: clicker, prompt, additionalSystemPrompt: question+answer context })`
- [x] 6.5 Register `installTellMeMoreHandler(sdk, deps)` in `src/plugins/trivia/index.ts` beside `installSeeAnswerHandler`
- [x] 6.6 Tests: button removed on click, intro posted with mention, startThreadConversation invoked with correct args, race/no-op, Slack-client-absent guard, unparseable reference guard

## 7. Verification

- [x] 7.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 7.2 i18n parity test passes (new keys in en/fr, no fr identical to en)
- [x] 7.3 Full `npm test` passes
- [x] 7.4 `openspec validate add-trivia-tell-me-more --strict` passes
