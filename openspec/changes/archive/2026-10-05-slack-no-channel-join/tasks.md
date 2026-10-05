## 1. Membership check and refusal

- [x] 1.1 Add `src/slack/botMembership.ts` exporting `isBotInConversation(client, channel)`, that zod-parses `is_member` / `is_im` / `is_mpim` from `conversations.info`. It returns true for a member, DM or MPIM, and false on a thrown error, `ok: false`, a missing channel or a malformed shape. Add `src/slack/botMembership.test.ts` alongside it.
- [x] 1.2 In `src/investigations/engine.ts`, delete `ensureChannelMembership`, including the `conversations.join` call and its error-code handling, and drop `slackErrorCode` if nothing else uses it. In `bootstrapInvestigation`, move the duplicate check first. Right after it, and before resolving the main surface, for every surface (`channel` and `dm`), return `{ status: "not_in_channel" }` when `isBotInConversation(client, originChannel)` is false. This runs before any post, session or index write. Remove `degraded` from `BootstrapResult`, and give the origin thread `params.originMode ?? "followAndInteract"` with no fallback.
- [x] 1.3 In `src/slack/handlers/investigateReaction.ts`, remove the `result.degraded` owner DM, plus any deps only it used. Add a `not_in_channel` case that posts an ephemeral `t("investigations.reactor_not_in_channel", …)` to the reactor.
- [x] 1.4 In `src/i18n/strings/en.ts` and `fr.ts`, delete `investigations.owner_degraded` and add `investigations.reactor_not_in_channel`. The message says Clack isn't in that channel and needs to be invited before it can investigate.
- [x] 1.5 In `src/tools/actions/startInvestigation.ts`, drop `degraded` from the ok result. Map `not_in_channel` to an English `errorResult` saying the bot isn't in that channel and must be invited first.
- [x] 1.6 In `src/tools/actions/followThread.ts`, after the access and cycle guards, return an English `errorResult` with the same meaning when `isBotInConversation` is false.

## 2. Remove the scope

- [x] 2.1 Remove the `channels:join` push from `requiredBotScopes` in `src/slack/requiredScopes.ts`. Keep the investigation events. Keep the hunk separate from the slack-canvases and slack-lists scope edits.
- [x] 2.2 Regenerate `slack-app-manifest.json` with `npm run manifest`, and check that the only diff is the removed `channels:join`.
- [x] 2.3 In CLAUDE.md's investigations section, drop `channels:join` from the operator note (enabling adds `message.channels` / `message.groups` and needs a manifest re-upload). Say that Clack never joins channels and refuses, telling the requester, when it isn't in the origin channel. Keep the hunk separate from other sessions' CLAUDE.md edits.

## 3. Tests

- [x] 3.1 `src/investigations/engine.integration.test.ts`: replace the three join/degrade tests (join failure → degraded follow; already a member → no join; info error → falls through to join) with the cases below, and assert that `conversations.join` is never called. Cover: member → ok with the requested mode; non-member → `not_in_channel` with no post, session or index entry; info throws / `ok: false` → `not_in_channel`; DM surface with a non-member origin channel → `not_in_channel` with no DM opened; an already-investigated thread whose channel the bot left → `duplicate`; non-member with no investigations channel configured → `not_in_channel`.
- [x] 3.2 `src/slack/handlers/investigateReaction.test.ts`: remove the degraded owner-DM tests, and cover the `not_in_channel` ephemeral.
- [x] 3.3 `src/tools/actions/startInvestigation.test.ts`: remove the `degraded` assertions, and cover the `not_in_channel` error result.
- [x] 3.4 `src/tools/actions/followThread.test.ts`: cover the not-in-channel refusal (nothing added, no join) and a DM/MPIM target being accepted. Mock `isBotInConversation` at its module boundary.
- [x] 3.5 `src/slack/requiredScopes.test.ts` and `scripts/generate-manifest.test.ts`: assert that `channels:join` never appears, with investigations enabled or not.
- [x] 3.6 `src/slack/scopeDriftCheck.test.ts` and `src/lifecycle.test.ts`: swap the sample `channels:join` scope for a scope the bot still requires (e.g. `im:write`).

## 4. Verify

- [x] 4.1 `grep -rn "channels:join\|conversations.join\|degraded" src/investigations src/slack src/tools/actions src/i18n scripts CLAUDE.md slack-app-manifest.json` shows no join code and no investigation `degraded`.
- [x] 4.2 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on the touched files, and `npm test` all pass.
- [x] 4.3 `openspec validate slack-no-channel-join --strict` passes.
