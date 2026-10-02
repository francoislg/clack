## 1. Shared scope definition and manifest validation

- [x] 1.1 Create `src/slack/requiredScopes.ts` with `CORE_SCOPES`, `CORE_EVENTS`, the features type, `manifestFeatures`, `requiredBotScopes` and `requiredBotEvents`, moved from `scripts/generate-manifest.ts`
- [x] 1.2 Add `src/slack/requiredScopes.test.ts` covering each feature's scopes and events and deduplication
- [x] 1.3 Add `manifestConfigZod` to `src/configSchemas.ts`, reusing `allowPublicSearchZod`, `investigationsZod` and `VALID_DM_TYPES`, with a test for valid, wrong-typed and unknown-key input
- [x] 1.4 Change `scripts/generate-manifest.ts` to parse through `manifestConfigZod` with `zodErrorToResult` formatting, import the shared definition, and drop `PartialConfig`, the `as` cast and `validateSlackAppConfig`
- [x] 1.5 Extend `scripts/generate-manifest.test.ts` with the validation scenarios and confirm the existing fixtures still pass unchanged

## 2. Scope drift check

- [x] 2.1 Create `src/slack/scopeDriftCheck.ts` with `findMissingScopes`, `reportMissingScopes` and `checkTokenScopes`, following `src/tools/servedToolsCheck.ts`
- [x] 2.2 Add the owner DM strings to `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts`
- [x] 2.3 Add `src/slack/scopeDriftCheck.test.ts` covering every scenario in the `slack-scope-drift-check` spec except the soft-restart one (task 2.4)
- [x] 2.4 Call `checkTokenScopes` in `src/index.ts` after the Slack app starts and in the soft-restart path of `src/lifecycle.ts`, with a lifecycle test for the soft-restart call

## 3. Requester access check

- [x] 3.1 Add the bot's team id to `BotIdentity` in `src/slack/botIdentity.ts`, with a test
- [x] 3.2 Create `src/slack/requesterAccess.ts` with requester classification (`users.info`) and its cache
- [x] 3.3 Add `checkConversationAccess` implementing the conversation rule, with paginated `conversations.members` that stops at the first page containing the requester, and its own `conversations.info` call for a DM's user
- [x] 3.4 Add the in-memory verdict cache with separate allow and deny TTLs and in-flight dedupe
- [x] 3.5 Add `checkFileAccess` implementing the file rule and returning the bot's access level
- [x] 3.6 Add `accessGranted` to `SessionContext` in `src/sessions.ts` with a graceful validator on load, with tests for round-trip and malformed input
- [x] 3.7 Make both checks consult the session's grants first and record an allowance on the session
- [x] 3.8 Copy the origin session's grants in `bootstrapInvestigation` (`src/investigations/engine.ts`), with a test for inheritance and for a fork with no origin session
- [x] 3.9 Add `src/slack/requesterAccess.test.ts` covering every scenario in the `slack-requester-access` spec, using `createSlackClientMock()` and fake timers for TTLs

## 4. Tool enforcement

- [x] 4.1 Call `checkConversationAccess` in `fetch_channel_messages` before `conversations.history`; return the fixed denial error
- [x] 4.2 Call `checkConversationAccess` in `fetch_slack_message` before the thread fetch; return the fixed denial error
- [x] 4.3 Filter `search_messages` results through `checkConversationAccess`
- [x] 4.5 Call `checkConversationAccess` in `follow_thread` and `start_investigation` before a thread is followed, with tests
- [x] 4.4 Add tests to each tool's test file: denied makes no Slack read, the error names no channel, allowed output is unchanged (the check mocked at the boundary)

## 5. Documentation and verification

- [x] 5.1 Document the requester-access rule, the scope drift check and the shared scope definition in `CLAUDE.md`, and state there that plugin cron runs (`idler`, `casual-talk`) read public channels only
- [x] 5.2 Run `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt --check` on the changed files and `npm run test`
- [x] 5.3 Run `npm run manifest` against the local config and confirm the output is unchanged
- [x] 5.4 Run `graphify update .`
