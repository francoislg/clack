## 1. Core: engaged-thread registration

- [x] 1.1 Add `registerThreadSession(channel, threadRoot, { attentionLevel, followUpContext })` to `src/sessions.ts` — `"off"` is a no-op; non-`"off"` calls `createSession` with `channelId = channel`, `messageTs = threadTs = threadRoot`, `attentionLevel`, `additionalSystemPrompt = followUpContext`, synthetic placeholder `userId`; skip when a session already exists for `(channel, threadRoot)` (no clobber); ensure `findSessionByThread` resolves it (thread index / disk).
- [x] 1.2 Verify the thread-reply answer turn injects `session.additionalSystemPrompt` into the prompt (the same path auto-respond rule `extraContext` uses); wire it if seeded sessions don't already get it.
- [x] 1.3 Unit tests in a focused `src/sessions.engagement.test.ts` (boundary-mocked): off → no write; non-off → discoverable + engaged; no-clobber of an existing session; followUpContext stored as `additionalSystemPrompt`.

## 2. Schema fields: deliver_to + post_to

- [x] 2.1 Add optional `attention_level` + `follow_up_context` to `DeliverToEntry` (and as needed `DeliverToPayload`) and `PostToAction` in `src/tools/types.ts`.
- [x] 2.2 Add the matching optional zod fields to the `deliver_to` entry schema and the `post_to` action schema in `src/tools/presentation/submitResponse.ts` (default/absent ⇒ `"off"`).
- [x] 2.3 Wire deliver_to delivery in the `deliverToChannel` adapter built in `src/tools/server.ts` (the function that wraps `postAnswerToChannel`): after the post succeeds, call `registerThreadSession` for the destination — root = entry `thread_ts` ?? posted ts; pass `follow_up_context`. (The validation/persist helpers in `src/tools/presentation/submitResponse/deliverTo.ts` are unchanged.) Failed delivery seeds nothing; a seeding failure is logged, not surfaced as a delivery error.
- [x] 2.4 Wire post_to auto-execute: in `src/slack/handlers/autoExecute.ts`, after a successful cross-post with non-`"off"` `attention_level`, call `registerThreadSession` (root = action `thread_ts` ?? posted ts).
- [x] 2.5 Unit tests: deliver_to entry with `attention_level: high` seeds the right root (reply vs top-level); omitted ⇒ no seed; failed delivery ⇒ no seed. Same for `post_to`.

## 3. SDK: engageThread

- [x] 3.1 Add `engageThread(channel, threadTs, { attentionLevel, followUpContext })` to the `ClackSdk` interface and its implementation in `src/plugins/sdk.ts`, wrapping `registerThreadSession`; `"off"`/omitted ⇒ no-op.
- [x] 3.2 Unit test in `src/plugins/sdk.*test.ts`: engageThread forwards to the core helper; off is a no-op.

## 4. Trivia application

- [x] 4.1 In `src/plugins/trivia/tools/questions/postQuestions.ts`, after each question's `chat.postMessage`, call `sdk.engageThread(channel, postedTs, { attentionLevel: <non-off>, followUpContext: <clarification context> })`.
- [x] 4.2 Author the clarification follow-up context string (re-read original message; answer clarifications while pending; public detail request ≠ cheating; stop once the answer shows). It MUST use the SAME canonical good/bad example pair as task 4.3 (single source of truth — the specs require the two cannot drift).
- [x] 4.3 Add the clarification carve-out to `BASE_TRIVIA_CHECK_INSTRUCTION` in `src/plugins/trivia/prompts/triviaCheckInstruction.ts`, scoped to the pending question's own thread, using the canonical self-contained example pair — for the question "What is the largest province in Canada?", allowed clarification = "do you mean by area or by population?"; still cheating = "is it Quebec?". Task 4.2's followUpContext reuses this exact pair.
- [x] 4.4 Tests: `postQuestions` calls `engageThread` with the posted ts and a non-`"off"` level (boundary-mocked SDK); `triviaCheckInstruction` content includes the carve-out + both examples and stays consistent with the follow-up context string.

## 5. Casual-talk application

- [x] 5.1 Update the casual-talk chatter prompt (`src/plugins/casual-talk/prompt.ts`) to set `attention_level: "high"` on the `deliver_to` entry when joining/opening a thread.
- [x] 5.2 Update `src/plugins/casual-talk/prompt.test.ts` to assert the prompt instructs setting `attention_level: high` on the delivered entry.

## 6. Verify + integration

- [x] 6.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on all touched files; full `npm test` green.
- [x] 6.2 Add a focused integration test (`*.integration.test.ts`) for the end-to-end seam: a `deliver_to` with `attention_level: high` delivers, then a simulated reply to the destination thread asserts (1) `findSessionByThread(channel, threadRoot)` resolves the seeded session, (2) `isEngaged(session)` returns true, and (3) the answer turn is initiated with `session.additionalSystemPrompt` (the followUpContext) available (no real Slack/timers; mock at the boundary).
- [x] 6.3 Confirm no behavior change when fields are omitted (regression): existing deliver_to/post_to/trivia/casual tests still pass unchanged.
- [ ] 6.4 Manual VM check after deploy: a casual reply and a trivia clarification each get answered in-thread; an answered trivia thread does not keep helping.
