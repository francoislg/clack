## 1. submit_response schema: the gated field

- [x] 1.1 Add an optional `thread_title` Zod string field (≤ a sane cap, e.g. 60 chars) in `submitResponse.ts`, wired into `buildSubmitResponseSchema` behind a new `allowThreadTitle` dep flag (mirroring `allowPostTopLevel`). Add `thread_title?: string` to `SubmitResponseArgs`.
- [x] 1.2 Description (Claude-facing, English): "Optional short label naming this DM conversation (a few words), in the user's language — used as the thread title. Omit to let it default to the opening message."
- [x] 1.3 Set `allowThreadTitle` in the submit_response tool-context builder from the trigger: `true` only for `directMessages`, `false` everywhere else.

## 2. Payload flow-out

- [x] 2.1 Add `thread_title?: string` to `SubmitResponsePayload` (`src/tools/types.ts`) so it rides on `ClaudeResponse.response`. Confirm the handler passes it through (schema-derived args → payload).

## 3. Agent hook consumption

- [x] 3.1 `classicDm.handleClassicDmEvent`: capture the `processMessage` result and pass `threadTitle: result?.response?.thread_title` into the `onTurnEnd` hook ctx (extend `DmTurnHooks.onTurnEnd` ctx with `threadTitle?: string`).
- [x] 3.2 `agent.ts` `agentTurnHooks.onTurnEnd`: on `isThreadStart`, title = `threadTitle ?? trunc(messageText)`. Keep the existing truncation + best-effort swallow. Non-thread-start turns still skip titling.

## 4. Prompt guidance

- [x] 4.1 Add one line to the DM/response guidance telling Claude the `thread_title` field exists and when to use it (opening turn of a DM; a short descriptive label, not the user's words verbatim). Keep it lean — the field description already carries the contract.

## 5. Tests

- [x] 5.1 `submitResponse` schema: `thread_title` present for `directMessages`, absent for reactions/mentions/scheduled/worker (extend the existing `buildSubmitResponseSchema` gating tests).
- [x] 5.2 Payload passthrough: a `submit_response` call with `thread_title` surfaces it on `ClaudeResponse.response.thread_title`.
- [x] 5.3 `classicDm`: `onTurnEnd` receives `threadTitle` from the result; absent when Claude omitted it.
- [x] 5.4 `agent` hook: Claude title wins over message text on thread start; falls back to message text when absent; no titling on follow-ups.

## 6. Verification

- [x] 6.1 `npx tsc`, `npx oxlint`, `npx oxfmt --check` clean on touched files.
- [x] 6.2 `npm test` green (7607 passed, 4 skipped).
- [~] 6.3 Live check DEFERRED to post-deploy — DM the agent, confirm the thread title is a descriptive label (not the raw message) and a follow-up doesn't change it. Fully covered by unit tests; verify on the next deploy.
- [x] 6.4 `graphify update .` run; graph committed with the code.

## Notes

- **Prerequisite:** `migrate-to-agent-messaging` must ship the `DmTurnHooks` seam + `agentTurnHooks` first (this change layers on it). Ordering for archive: agent-messaging → this change.
