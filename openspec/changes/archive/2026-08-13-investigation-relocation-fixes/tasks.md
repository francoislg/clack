# Tasks — Investigation Relocation Fixes

## 1. Per-turn requester in the tool context

- [x] 1.1 `src/claude/index.ts` — source `buildQueryContext`'s `userId` from `options?.requester?.userId ?? session.userId`
- [x] 1.2 `src/claude/index.test.ts` (or nearest existing suite covering `buildQuerySetup`/tool context) — unit tests: requester present → context `userId` is the speaker; no requester (scheduled) → falls back to `session.userId`
- [x] 1.3 Audit existing tests that assumed `ctx.userId === session.userId` on reused threads — grep test files for the affected tools (`src/tools/query/stopTracking*.test.ts`, `src/tools/query/findSessionTranscript*.test.ts`, `src/tools/actions/startInvestigation*.test.ts`, `src/tools/actions/followThread*.test.ts`, scheduled-message tool tests) — and update assertions to expect the current speaker's userId when a requester is present, `session.userId` otherwise

## 2. Non-blocking bootstrap (detached first round)

- [x] 2.1 `src/investigations/engine.ts` — `bootstrapInvestigation`: replace the awaited `runInvestigationRound` with a detached launch (`void ….catch(log)`); keep parent post, session creation, `openInvestigation`, and breadcrumb decision synchronous; return promptly with the permalink
- [x] 2.2 `src/investigations/engine` tests — assert bootstrap resolves without awaiting the round (detached spy invoked with the first-round text; bootstrap result available before the round's promise settles) and that a rejected round leaves the ok result, session, and index intact. Pre-existing membership/join scenarios stay covered by their existing tests — no re-testing needed
- [x] 2.3 Confirm `investigateReaction.ts` requires no changes beyond the engine's detached launch (per design Non-Goals); in `src/slack/handlers/investigateReaction.test.ts`, change any assertion that depended on the first round completing inside `bootstrapInvestigation` to a detached-launch spy assertion

## 3. `start_investigation` — ack contract + disengage

- [x] 3.1 `src/tools/actions/startInvestigation.ts` — after an `ok` bootstrap for the CURRENT thread (no `thread_ref`, or `thread_ref` equal to `ctx.session.channelId`/`threadTs`), call `setAttentionLevel(ctx.session.sessionId, "off")`; skip on non-ok results and on foreign `thread_ref`
- [x] 3.2 Same file — extend the tool description + ok result payload: instruct Claude to acknowledge in the origin thread with the permalink, and surface `originDisengaged: true` so Claude can tell the user mentions still re-engage
- [x] 3.3 `startInvestigation` unit tests — disengage on current-thread ok; no disengage on foreign `thread_ref`; no disengage on `duplicate`/`cycle`/`channel_not_configured`/`dm_failed`; assert the tool passes `ctx.userId` as `bootstrapInvestigation`'s `requester` argument (so attribution/`startedBy`/breadcrumb lookup follow the current speaker)
- [x] 3.4 Followed-tee independence test — assert the investigation message-event tee delivers an origin-thread message to the investigation even when the origin session's attention level is `off` (the tee matches by `(channel, threadTs)` and must not consult attention level)

## 4. Followed-thread write guard

- [x] 4.1 `src/tools/presentation/submitResponse.ts` — add `blockedFollowedThreads?: Array<{ channel: string; threadTs: string }>` to the tool options (populated from the live session's `followedThreads` at tool-assembly time, alongside `topLevelDeliveryChannel`); add optional `user_requested: boolean` to the `post_to` action schema with the explicit-request-only description
- [x] 4.2 Same file — batch validation: reject any `post_to` (auto or staged) whose `(channel, thread_ts)` matches a blocked followed thread and lacks `user_requested: true`, with an error naming the followed-thread read-only rule and the escape condition
- [x] 4.3 `src/tools/server.ts` (or wherever submit_response options are assembled) — thread `session.followedThreads` into the new option
- [x] 4.4 `src/investigations/deliveryContext.ts` — extend the read-only directive with the explicit-request exception; ensure ALL investigation sessions (regardless of followed-thread count) do not carry the generic "share findings back to that thread" delivery-context exception (the text lives in `src/claude/promptBuilder.ts:441` — suppress it when the session has an investigation surface)
- [x] 4.5 `submitResponse` unit tests — auto rejected; staged button rejected; `user_requested: true` permitted; channel-without-thread_ts and different-thread targets not blocked; mid-session followed thread covered
- [x] 4.6 `deliveryContext` tests — directive includes the exception wording; generic share-back guidance absent for investigation sessions

## 5. Verification

- [x] 5.1 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt` on touched files
- [x] 5.2 Full `npm test` green
- [x] 5.3 `openspec validate investigation-relocation-fixes --strict` passes
