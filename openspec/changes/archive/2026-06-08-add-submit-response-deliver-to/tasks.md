# Tasks

## 1. Shared message-payload entity

- [x] 1.1 Extract the message-content shape (`blocks` + `thread_replies?` + `actions?` + `suppress_unfurls?` + `reactions?`) into ONE reusable Zod schema/type, building on today's `messageContentFields`. Exclude routing fields (`channel`, `thread_ts`, `skip_response`, `deliver_to`, `additional_messages`).
- [x] 1.2 Reuse the existing per-channel delivery routine `postAnswerToChannel` (`src/slack/handlers/dmActions.ts`) as the shared routine — it already posts `blocks` (honoring `suppress_unfurls`), adds `reactions`, posts `thread_replies`, and returns the posted `ts`, and is already shared with `post_to` auto-execute. Factor/rename if needed; do NOT build a parallel one.
- [x] 1.3 Share the message-payload ENTITY across the primary, each `post_to` action, and each `deliver_to.response`. `post_to` and `deliver_to` deliver through the shared per-channel routine (`postAnswerToChannel`); the interactive bound-channel primary keeps its streamer-based `DeliverFn` as its delivery adapter (the streamer does an in-place `chat.update` on the thinking card — it CANNOT route through `postAnswerToChannel`'s `chat.postMessage` without orphaning the card and losing `postTopLevel`/follow-up-session/notification behavior). Only the payload SHAPE is unified; the bound-channel primary's adapter stays streamer-based.

## 2. deliver_to schema variant

- [x] 2.1 Add the `deliver_to` array schema (`{ channel: string (required), thread_ts?: string, response: <shared payload> }`) and rebuild the `"optional-post-to"` schema to expose EXACTLY `{ skip_response?: literal(true), deliver_to?: [...] }` — no top-level `actions`, no primary fields.
- [x] 2.2 Update the channelless schema selector in `server.ts` so a channelless run assembles the new `deliver_to` shape (the `optional-post-to` mode value already exists from the archived change — only the schema it maps to changes). Wired the `deliverToChannel` + `recordResponseTs` deps here (adapter over `postAnswerToChannel`).

## 3. deliver_to handler

- [x] 3.1 Rewrite the `optional-post-to` handler branch: deliver each `deliver_to` entry via the shared routine (in array order); record `responseTs` = first entry's ts; `success`.
- [x] 3.2 Implement deliver-or-skip-or-error: non-empty `deliver_to` → deliver; bare `skip_response` (no/empty `deliver_to`) → skip; neither → `recordError` (no silent no-op).
- [x] 3.3 Reuse per-message validation building blocks (blocks, button labels, nested `post_to` inside an entry's `actions`, referenced intents) from `submitResponse/actions.ts` (via the new `submitResponse/deliverTo.ts`).

## 4. Remove the band-aids

- [x] 4.1 Drop the uncommitted implicit-`auto` forcing in the `optional-post-to` branch (not needed — `deliver_to` is not an action).
- [x] 4.2 Collapse the `optional-post-to`-before-skip ordering trick into the single `deliver_to` branch.
- [x] 4.3 **Kept the `handleSuccess` `isChannellessChannelId` guard (deviation from the original "remove it" plan).** Its precondition — "channelless never routes a primary to the sentinel" — is NOT met: if Claude ends a channelless run WITHOUT calling `submit_response`, `buildSuccessResponse` returns the raw-text path and `handleSuccess`'s fallback would `chat.postMessage` that text to the synthetic `channelless:<id>` channel → `channel_not_found` crash. The guard is the correct permanent safety property (the sentinel is never postable), not a band-aid. On the happy `deliver_to` path the guard is also satisfied (delivery happened via the explicit channels; `responseCapture` is set). Removing it would reintroduce the crash for zero benefit.

## 5. casual-talk prompt

- [x] 5.1 Rewrite the casual prompt to deliver via `submit_response({ deliver_to: [{ channel, thread_ts?, response: { blocks } }] })` (not a `post_to` action); skip via `submit_response({ skip_response: true })` only; never combine the two.
- [x] 5.2 Update casual prompt tests for the new delivery wording.

## 6. Tests

- [x] 6.1 `submitResponse` tests: `deliver_to` single entry delivers + records `responseTs`; multiple entries (same and different channels); entry with `thread_ts` (threaded) / without (top-level); delivery needs no `auto` flag; `deliver_to` + `skip_response` together still delivers (deliver_to wins); bare skip; neither → hard error; empty `deliver_to` → hard error; Slack failure → run error. Schema-shape tests cover missing `channel` rejected, empty `response.blocks` rejected, and primary/top-level `actions` fields absent.
- [x] 6.2 Shared-payload tests: `post_to` and `deliver_to` go through the same per-channel delivery routine (`deliverTo.test.ts` asserts the validator path; the handler delivers each entry via the injected `deliverToChannel` adapter, which wraps `postAnswerToChannel`). The primary shares the payload ENTITY but keeps its streamer adapter (not asserted as the same routine).
- [x] 6.3 `handlerResponse` test: channelless success never posts to the `channelless:` sentinel; no `channel_not_found` (existing guard test, comment updated for the deliver_to mechanism).
- [x] 6.4 Regression: the `optional-post-to` schema shape exposes EXACTLY `{ skip_response, deliver_to }` and no top-level `actions`/`blocks`/primary fields (asserted via the exported `buildSubmitResponseSchema`).

## 7. Verify

- [x] 7.1 `npx tsc --noEmit`, `npx oxlint src/`, `npx oxfmt --check` all clean.
- [x] 7.2 Full `npm test` suite green (334 files, 5514 tests).
- [x] 7.3 `openspec validate add-submit-response-deliver-to --strict` passes.
- [ ] 7.4 VM check after deploy: a casual-talk roll=1 actually posts to the channel (delivered, `responseTs` set, zero `channel_not_found`).
