## 1. Session state

- [x] 1.1 `src/sessions.ts` — add `DeliveryMode = "streamer" | "invisible"` type and `SessionContext.deliveryMode?: DeliveryMode` (doc: absent reads as `"streamer"`), beside `attentionLevel`.
- [x] 1.2 `src/sessions.ts` — add `deliveryMode?: DeliveryMode` to `EngageThreadOptions`; pass it into `createSession` in `registerThreadSession` (omit when undefined).
- [x] 1.3 `src/sessions.engagement.test.ts` (or sessions test) — seeded session carries `deliveryMode: "invisible"` when supplied; absent when omitted.

## 2. Read mode → silentThinking (central)

- [x] 2.1 `src/slack/handlers/core.ts` — after the session is resolved in `processMessage`, compute `effectiveSilentThinking = silentThinking || session.deliveryMode === "invisible"` and pass it to `executeAndDeliver` (replacing the bare `silentThinking`).
- [x] 2.2 `src/slack/handlers/core.test.ts` — an engaged session with `deliveryMode: "invisible"` runs `executeAndDeliver` with `silentThinking: true`; `"streamer"`/absent runs with `false`; an explicit cron `silentThinking: true` stays true regardless of mode.

## 3. Switch surface on submit_response

- [x] 3.1 `src/tools/presentation/submitResponse.ts` — add a `deliveryModeField` (`z.enum(["streamer","invisible"]).optional()`, Claude-facing English description) and include it in the attention-enabled response schema (same gate as `attention_level`).
- [x] 3.2 `src/tools/presentation/submitResponse.ts` — parse it onto the returned response object as `deliveryMode` (mirror how `attentionLevel` is surfaced at line ~583).
- [x] 3.3 `src/slack/handlers/handlerResponse.ts` — in `handleSuccess` persist `response.deliveryMode` onto the session (mirror the `setAttentionLevel` block at ~574); in `handleSkip` include it in the atomic `updateSession` (mirror `attentionLevel` at ~538).
- [x] 3.4 `src/tools/presentation/submitResponse.test.ts` — `default_delivery_mode` is parsed and surfaced; absent leaves it undefined.
- [x] 3.5 `src/slack/handlers/handlerResponse.test.ts` — a successful turn with `default_delivery_mode: "streamer"` persists `deliveryMode` on the session; a skip turn persists it; a delivery-failed turn does not.

## 4. Seed surface on post_to / deliver_to

- [x] 4.1 `src/tools/presentation/submitResponse.ts` — add a shared `threadEngagementDeliveryModeField` and attach it to `postToActionSchema` and `deliverToEntrySchema` beside `attention_level` / `follow_up_context`.
- [x] 4.2 `src/tools/types.ts` — thread `deliveryMode` through the `post_to` action type, the `DeliverToChannelFn` args, and the deliver-adapter payload type.
- [x] 4.3 `src/tools/presentation/submitResponse.ts` — forward `entry.default_delivery_mode` into the `deliverToChannel` adapter call (beside `attentionLevel` / `followUpContext`, line ~1036).
- [x] 4.4 `src/tools/server.ts` — in `deliverToChannel`, pass `deliveryMode` into `registerThreadSession` (line ~567).
- [x] 4.5 `src/slack/handlers/autoExecute.ts` — pass `deliveryMode: action.default_delivery_mode` into `registerThreadSession` (line ~579).
- [x] 4.6 Tests — `submitResponse.test.ts`: `deliver_to[].default_delivery_mode` forwards to the deliver adapter. `autoExecute.test.ts`: `post_to.default_delivery_mode` reaches `registerThreadSession`.
- [x] 4.7 `src/tools/server.engagement.integration.test.ts` — a high-attention `invisible` delivery seeds a session whose reply turn runs silent.

## 5. Casual-talk policy

- [x] 5.1 `src/plugins/casual-talk/prompt.ts` — instruct Claude to set `default_delivery_mode: "invisible"` on the single `deliver_to` entry (beside the mandatory `attention_level: "high"`), with a one-line rationale (casual chatter feels natural without a thinking card).
- [x] 5.2 `src/plugins/casual-talk/prompt.test.ts` — assert the prompt mentions `default_delivery_mode: "invisible"` on the deliver_to entry.

## 6. Validate

- [x] 6.1 `npx tsc` — type-check passes.
- [x] 6.2 `npm test` — full suite green (new + existing).
- [x] 6.3 `npx oxlint` + `npx oxfmt --check` on touched files.
- [x] 6.4 `openspec validate add-thread-delivery-mode --strict`.
