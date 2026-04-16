## Context

`submit_response` today always delivers to the triggering thread. Auto-respond rules that want the answer posted at channel top-level had to use a workaround: add `extraContext` text telling Claude to use `post_to` with `auto: true`. Two failure modes:

1. **Duplicate messages.** `submit_response` delivers the answer to the thread; the `post_to` action delivers the same content to the channel top-level. Two messages.
2. **Missed instruction.** Claude may not use `post_to` at all and the answer goes to the thread only — quietly ignoring the admin's routing intent.

There's prior art for this routing: `scheduled` triggers already deliver top-level to the configured channel, and the `topLevelDeliveryChannel` dep (`src/tools/server.ts`) rejects `post_to` duplicates targeting the same channel. This change generalizes that mechanism to be Claude-controlled per-response for other trigger types.

## Goals / Non-Goals

**Goals:**
- Make "post the primary response to the channel top-level" a first-class, structured option on `submit_response`.
- Prevent duplicate-send at the schema/validation layer — impossible to have both `post_top_level: true` AND a `post_to` to the same channel without a `thread_ts`.
- Preserve cross-channel `post_to` semantics (posting to a different channel or specific thread).

**Non-Goals:**
- Changing how scheduled triggers work — they already post top-level via `topLevelDeliveryChannel`.
- Enforcing post-top-level via per-rule config in `AutoRespondRule`. That would be a separate change; admins can still steer Claude via `extraContext` referencing the new flag.
- Applying to DMs (no "channel top-level" concept) or the Changes Workflow.

## Decisions

### Decision 1: Claude-controlled per-response, not rule-level config

The flag lives on the tool call, not the auto-respond rule. Failure mode if Claude forgets to set it: answer goes to thread (routing mistake, no duplication). That's strictly better than Option A's failure mode (rule is active but Claude posts to both places) or today's status quo (duplicate messages).

**Alternative considered:** A `postTopLevel` flag on `AutoRespondRule`. Rejected because it couples the rule to a delivery decision that's Claude's to make based on the current message. Also less composable — channels without rules (e.g., @mentions) couldn't use it.

### Decision 2: Schema-layer duplication guard, not runtime deduplication

When `post_top_level: true`, `sessionChannelId` is treated as the top-level delivery channel for the duration of this call, and the existing `validatePostToActions` check rejects any `post_to` targeting it without a `thread_ts`. The rejection surfaces to Claude as a tool error, so Claude can correct by removing the duplicate action.

**Alternative considered:** Silently dropping the duplicate `post_to`. Rejected — silent behavior change is hard to debug; an explicit error forces Claude to produce a coherent response.

### Decision 3: Schema variant explosion

Adding `post_top_level` on top of the existing `{normal, disengage-enabled, skip-enabled}` schemas doubles the variants to six. We build three additional explicit variants (`*WithPostTopLevel`) rather than dynamic schema assembly, keeping zod's type inference precise at the tool boundary.

**Trade-off:** More named constants; stable typing. An alternative was a single dynamic schema builder, but that loses zod's compile-time type narrowing at the handler — not worth it for five lines of duplication.

### Decision 4: Which trigger types get the flag

`autoRespond`, `threadReply`, `mentions`, `reactions`. Excluded:

- `scheduled` — already posts top-level via `topLevelDeliveryChannel`; adding `post_top_level` would be redundant.
- `directMessages` — DMs have no meaningful "channel top-level".
- Changes Workflow — worker mode doesn't deliver via `submit_response`.

Gated via a new `shouldAllowPostTopLevel(triggerType)` helper in `server.ts`, parallel to the existing `shouldAllowSkip` / `shouldAllowDisengage`.

### Decision 5: Delivery path — delete streamer message

The streamer (thinking indicator) is bound to the thread at construction. For a top-level post, the streamer message is cruft in the thread. `buildDeliverFn` stops the streamer and deletes its message before posting top-level via `chat.postMessage`. Mirrors the existing `handleSkip` pattern that deletes the streamer message for skip-response.

## Risks / Trade-offs

- **Risk:** Claude sets `post_top_level: true` but also adds a `post_to` to the same channel without `thread_ts`. → **Mitigation:** schema-layer guard rejects this combination explicitly; Claude gets a tool error and can retry.
- **Risk:** The streamer-delete races with the top-level post and the user sees the thinking indicator briefly before the channel post appears. → **Mitigation:** delete happens before `chat.postMessage`; stream deletion is already proven by the skip-response path.
- **Trade-off:** Three new schema variants (`*WithPostTopLevel`) add surface area. Acceptable for the precise typing gain.
- **Risk:** Admins migrating their `extraContext` from "use `post_to` with `auto: true`" to "set `post_top_level: true`" need to update their rule text. → **Mitigation:** document in release notes; the old pattern still works (Claude can still use `post_to` to post top-level — but will hit the duplication guard if combined with `post_top_level: true`).

## Migration Plan

No data migration. Existing auto-respond rules with `extraContext` still work — if Claude uses `post_to` alone (without `post_top_level`), current behavior is unchanged. Admins get the improved routing by updating their `extraContext` to reference `post_top_level: true`.
