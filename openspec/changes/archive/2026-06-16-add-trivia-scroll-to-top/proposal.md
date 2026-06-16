## Why

When a trivia fire posts several questions as separate top-level channel messages, players who arrive mid-batch (or scroll down through the questions) have no quick way back to the first question to start in order. A trailing "jump to the top" link closes that gap with one mechanical message, opt-in per game or workspace.

## What Changes

- Add a new cascading knob `scrollToTop` (boolean) that resolves `game → workspace → default false`, mirroring the existing `tagPlayers` game+workspace pattern (dedicated resolver, NOT a `CascadeAxes` member — no slot/season tiers).
- When enabled and a fire posts **2+ questions**, `post_questions` deterministically posts one trailing top-level channel message after the batch: a single mrkdwn link `📜 Scroll to the first question` pointing at the **earliest question message in the whole batch** (true top, including the append case), with link unfurls suppressed.
- The trailing message is purely mechanical (no Claude involvement, no `get_ideas` roll, no prompt changes) and is not stamped on any question record.
- Expose the knob through the existing config surfaces: settable via `upsert_game` (per-game) and `set_workspace_config` (workspace), surfaced read-only in `list_games` (per-game + `workspaceDefaults`), and validated when parsing `config.json`.
- The trailing label is on the direct-to-Slack path, so it is resolved through `sdk.t()` with new keys added to the plugin's `en`/`fr` dictionaries.

## Capabilities

### New Capabilities
- `trivia-scroll-to-top`: An opt-in, game+workspace-cascading knob that makes `post_questions` append a trailing "scroll to the first question" navigation message after a multi-question batch, linking to the batch's earliest message with unfurls suppressed.

### Modified Capabilities
<!-- None — behavior is purely additive; default-off preserves existing posting behavior exactly. -->

## Impact

- **Code:** `src/plugins/trivia/core/configTypes.ts` (knob on `TriviaGame` + `TriviaConfig` + `DEFAULT_SCROLL_TO_TOP`), new `src/plugins/trivia/domain/scrollToTop.ts` (resolver), `src/plugins/trivia/core/configBridge.ts` (workspace validation), `src/plugins/trivia/tools/questions/postQuestions.ts` (trailing post), `src/plugins/trivia/tools/games/upsertGame.ts` + `setWorkspaceConfig.ts` (schema), `src/plugins/trivia/tools/games/listGames.ts` (surfacing).
- **i18n:** new key(s) in the trivia plugin's `en`/`fr` dictionaries.
- **Config:** new optional `scrollToTop` field readable on `config.json` game entries and workspace `trivia` block; absent = default false, so existing deployments are unaffected.
- **No record/schema migration:** the value is resolved and consumed inline at post time, never persisted on the question record.
