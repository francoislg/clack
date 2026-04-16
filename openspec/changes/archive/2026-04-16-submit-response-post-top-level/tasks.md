## 1. Type + deliver function

- [x] 1.1 Extend `DeliverFn` in `src/tools/types.ts` with an optional `postTopLevel?: boolean`
- [x] 1.2 Update `buildDeliverFn` in `src/slack/handlers/handlerResponse.ts` to branch on `opts.postTopLevel`: stop and delete the streamer message (if any), then post via `chat.postMessage` without `thread_ts`

## 1b. Follow-up session creation

- [x] 1b.1 Add optional `createSession?: typeof createSession` to `HandlerResponseDeps`
- [x] 1b.2 In `buildDeliverFn`'s top-level branch, after successful post, call `createSession({...})` copying the parent session's userId, channelName, additionalSystemPrompt, username, displayName — threaded at the new ts
- [x] 1b.3 Log and continue on createSession failure (best-effort follow-up tracking; do NOT fail delivery)

## 2. submit_response schema + handler

- [x] 2.1 Add `postTopLevelField` (zod boolean with descriptive `describe`) in `src/tools/presentation/submitResponse.ts`
- [x] 2.2 Build three `*WithPostTopLevel` schema variants (normal, disengage-enabled, skip-enabled)
- [x] 2.3 Select the variant at tool construction based on `allowPostTopLevel` (new dep)
- [x] 2.4 Add `allowPostTopLevel?: boolean` and `sessionChannelId?: string` to `SubmitResponseDeps`
- [x] 2.5 Compute `effectiveTopLevelChannel` per-call: `topLevelDeliveryChannel ?? (wantsPostTopLevel ? sessionChannelId : undefined)`, then pass to `validatePostToActions`
- [x] 2.6 Pass `postTopLevel: true` to the deliver callback when set
- [x] 2.7 Include `postedTopLevel: true` in the success result returned to Claude

## 3. server.ts trigger gating

- [x] 3.1 Add `shouldAllowPostTopLevel(triggerType)` helper in `src/tools/server.ts`, returning true for `autoRespond`, `threadReply`, `mentions`, `reactions`
- [x] 3.2 Pass `allowPostTopLevel: shouldAllowPostTopLevel(triggerType)` to `createSubmitResponseTool`
- [x] 3.3 Pass `sessionChannelId: ctx.session.channelId` to `createSubmitResponseTool`

## 4. Prompt guidance

- [x] 4.1 In `src/claude/promptBuilder.ts`, replace the auto-respond "use `post_to` with `auto: true` for top-level" guidance with "set `post_top_level: true` on submit_response"
- [x] 4.2 Retain `post_to` guidance but narrow it to cross-channel broadcasts; note that combining `post_top_level` with a same-channel `post_to` is rejected

## 5. Tests

- [x] 5.1 `submitResponse.test.ts`: deliver receives `postTopLevel: true` when flag is set
- [x] 5.2 `submitResponse.test.ts`: deliver does NOT receive `postTopLevel` when flag is unset
- [x] 5.3 `submitResponse.test.ts`: `post_to` to the session channel without `thread_ts` is rejected when `post_top_level: true`
- [x] 5.4 `submitResponse.test.ts`: `post_to` to a different channel is allowed alongside `post_top_level: true`
- [x] 5.5 `submitResponse.test.ts`: `post_to` to the same channel WITH `thread_ts` is allowed alongside `post_top_level: true`
- [x] 5.6 `server.test.ts`: `shouldAllowPostTopLevel` returns true for `autoRespond`/`threadReply`/`mentions`/`reactions` and false for `directMessages`/`scheduled`/undefined

## 6. Verification

- [x] 6.1 Run `npx tsc --noEmit` — clean
- [x] 6.2 Run `npm run test` — all new and existing tests pass
- [x] 6.3 Run `openspec validate submit-response-post-top-level --strict`
- [ ] 6.4 Manual sanity check: configure an auto-respond rule whose `extraContext` says "set `post_top_level: true`"; trigger the rule in a channel; confirm one top-level message appears and no thread reply; confirm the thinking indicator is cleaned up.
