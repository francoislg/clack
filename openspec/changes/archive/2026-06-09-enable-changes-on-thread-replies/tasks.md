## 1. Core fix — visibility gate

- [x] 1.1 `src/changes/detection.ts`: `isChangesEnabledForTrigger` gains a `channelId?` arg; remove the `autoRespond`/`scheduled`/`threadReply` exclusion list.
- [x] 1.2 Return `false` when `isChannellessChannelId(channelId)` (invisible context). Keep the per-trigger opt-in for `mentions`/`directMessages`/`reactions`; `threadReply`/`autoRespond`/`scheduled` return `true` in a visible context. Import `isChannellessChannelId` from `../channelless.js`.

## 2. Thread channelId through the gate

- [x] 2.1 `src/slack/handlers/changeWorkflowHelper.ts`: `getClaudeOptions` and the `ChangeWorkflowHelperDeps.isChangesEnabledForTrigger` signature accept `channelId`; pass it into the gate (still ANDs `canRequestChanges(role)`).
- [x] 2.2 `src/slack/handlers/core.ts`: pass `channelId` into `getClaudeOptions` (deps type + call site at the processMessage build step).
- [x] 2.3 `src/slack/handlers/handlerResponse.ts`: pass `sessionInfo.channelId` into `getClaudeOptions`.

## 3. Auto-execute invisible-context guard

- [x] 3.1 `src/slack/handlers/autoExecute.ts`: after `handlePostToAutoExecute`, return early from the intent-based loop when `isChannellessChannelId(channelId)` — suppresses change/config/update/skill auto-execute in the invisible context; `post_to` auto-delivery (which channelless depends on) is preserved.
- [x] 3.2 UX: confirmed the "tooling disconnected" line was a Claude hallucination, not an instruction. With tools now present for dev+ in visible contexts it no longer arises; no member-facing instruction implied an outage, so no prompt edit needed.

## 4. Tests

- [x] 4.1 `src/changes/detection.test.ts`: visible threadReply/autoRespond/scheduled enabled; channelless disables every trigger; undefined channelId treated as visible; existing mentions/DM/reactions opt-in cases still green.
- [x] 4.2 `src/slack/handlers/changeWorkflowHelper.test.ts`: updated call sites for the new `channelId` arg; asserts channelId is forwarded to the gate.
- [x] 4.3 `src/slack/handlers/autoExecute.test.ts`: channelless suppresses intent auto-execute and still runs `post_to`.
- [x] 4.4 `npx tsc --noEmit`, `npx oxlint` (8 files, 0 warnings), and `npm test` (5521 passed / 3 skipped) all green.

## 5. Spec archive (after merge)

- [x] 5.1 Sync the `changes-workflow` delta into `openspec/specs/changes-workflow/spec.md` and archive the change once merged.
