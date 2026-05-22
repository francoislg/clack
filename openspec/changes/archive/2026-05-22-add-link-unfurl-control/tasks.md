## 1. Shared Helper

- [x] 1.1 Add a pure helper (e.g., `applyUnfurlOptions(args, suppressUnfurls)` or `unfurlParams(suppressUnfurls)`) in a new module under `src/slack/` that, given a boolean, returns either `{}` or `{ unfurl_links: false, unfurl_media: false }`.
- [x] 1.2 Write unit tests covering: absent → empty; `false` → empty; `true` → both keys set to `false`.

## 2. Front Door

- [x] 2.1 Extend `PostStructuredMessageOpts` in `src/slack/messagePoster.ts` with optional `suppressUnfurls: boolean`.
- [x] 2.2 Update `postStructuredMessage` to spread the shared helper's output into the `chat.postMessage` argument object.
- [x] 2.3 Update `MessagePostingClient` if its `postMessage` signature needs the new optional fields surfaced (or relax to allow them implicitly).
- [x] 2.4 Add tests in `src/slack/messagePoster.test.ts` covering both flag states.

## 3. DM and Notification Helpers

- [x] 3.1 Extend `sendDirectMessage` in `src/slack/messagesApi.ts` to accept `{ suppressUnfurls?: boolean }` as an optional final options object; forward via the shared helper.
- [x] 3.2 Extend `sendErrorReport` similarly; forward via the shared helper.
- [x] 3.3 Extend `quarantineNotifier` in `src/workers/quarantineNotifier.ts` to accept and forward the flag.
- [x] 3.4 Extend the migration admin DM in `src/migrations/admin.ts` to accept and forward the flag (default off).
- [x] 3.5 Extend the cron scheduler DM in `src/cronScheduler.ts` to accept and forward the flag (per scheduled message config if applicable, otherwise default off).
- [x] 3.6 Add or update tests for each helper covering both flag states.

## 4. Worker reportStatus

- [x] 4.1 Add optional `suppress_unfurls: boolean` to the `report_status` tool schema in `src/tools/worker/reportStatus.ts`.
- [x] 4.2 Forward the parameter to `chat.postMessage` via the shared helper.
- [x] 4.3 Update `src/tools/worker/reportStatus.test.ts` to cover both flag states.

## 5. Plugin SDK

- [x] 5.1 Update `ClackSdk.dmOwner` signature in `src/plugins/sdk.ts` to accept an optional `{ suppressUnfurls?: boolean }` second argument.
- [x] 5.2 Forward the flag through to `chat.postMessage` via the shared helper.
- [x] 5.3 Update the `ClackSdk` interface declaration to document the new option.
- [x] 5.4 Add tests in `src/plugins/sdk.test.ts` covering both flag states.

## 6. Trivia Question Posting

- [x] 6.1 Extend the trivia `postQuestions` helper in `src/plugins/trivia/tools/questions/postQuestions.ts` to accept and forward `suppressUnfurls` (or wire it directly into the existing `chat.postMessage` call via the shared helper). Default remains off; choosing a default-on for trivia is out of scope here.
- [x] 6.2 Add or extend a test confirming the flag flows through.

## 7. Streamer Fallback

- [x] 7.1 In `src/streaming/slackStreamer.ts`, thread a `suppressUnfurls?: boolean` field through to the fallback-post path (`chat.postMessage`) inside `finalize`/error paths.
- [x] 7.2 Source the value from the same signal that drives `submit_response` delivery (e.g., extend the streamer's options or the `DeliverFn` payload).
- [x] 7.3 Add a test confirming the fallback honors the flag.

## 8. submit_response Schema and Delivery

- [x] 8.1 Add an optional `suppress_unfurls: boolean` field to `normalResponseSchema`, `skipEnabledResponseSchema`, `skipOnlyResponseSchema`, and `disengageEnabledResponseSchema` in `src/tools/presentation/submitResponse.ts`. (The skippedOnlyResponseSchema continues to accept ONLY `skip_response: true`.)
- [x] 8.2 Mirror the field into each `*WithPostTopLevel` variant.
- [x] 8.3 Extend the `DeliverFn` payload type in `src/tools/types.ts` to include optional `suppressUnfurls: boolean`.
- [x] 8.4 In the submit_response handler, forward `args.suppress_unfurls` to the `deliver` callback.
- [x] 8.5 Update every `DeliverFn` implementation (DM-first, in-thread, top-level) to forward the flag to `postStructuredMessage`.
- [x] 8.6 Update the submit_response tool description to mention `suppress_unfurls` (one short sentence).
- [x] 8.7 Add tests in `src/tools/presentation/submitResponse.test.ts` covering: field absent → no unfurl keys; field `true` → flag reaches the deliver callback.

## 9. post_to Schema, Persistence, and Delivery

- [x] 9.1 Add `suppress_unfurls: z.boolean().optional()` to `postToActionSchema` in `src/tools/presentation/submitResponse.ts`.
- [x] 9.2 Extend `ResponseSnapshot` in `src/tools/types.ts` to include optional `suppressUnfurls: boolean`.
- [x] 9.3 Update the submit_response handler's snapshot-persistence path to capture `action.suppress_unfurls` as `snapshot.suppressUnfurls`.
- [x] 9.4 Update the auto-execute post_to path (e.g., `src/slack/handlers/autoExecute.ts` and/or `dmActions.ts::postAnswerToChannel`) to forward the flag to the `chat.postMessage` call via the shared helper.
- [x] 9.5 Update the button-click post_to path (deferred delivery from snapshot) to read `snapshot.suppressUnfurls` and forward it.
- [x] 9.6 Add tests covering both auto and deferred paths.

## 10. Migration Survey and Documentation

- [x] 10.1 Grep the codebase for remaining direct `client.chat.postMessage` calls; verify each is either migrated to the shared helper, intentionally out of scope (e.g., streamer intermediate `chat.update`), or explicitly accepts the new option.
- [x] 10.2 Add a top-of-file comment in `src/slack/messagePoster.ts` pointing future authors at the shared helper for new send paths.
- [x] 10.3 Run `npx tsc` to verify the codebase still type-checks.
- [x] 10.4 Run `npm test` to verify the full suite passes.
- [x] 10.5 Run `npx oxlint <changed files>` and `npx oxfmt <changed files>` and re-stage as needed.

## 11. OpenSpec Validation

- [x] 11.1 Run `openspec validate add-link-unfurl-control --strict` and resolve any reported issues.
