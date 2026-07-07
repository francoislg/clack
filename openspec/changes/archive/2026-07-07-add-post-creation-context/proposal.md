## Why

When Clack posts a message into a destination it doesn't control the trigger for (`post_to`, `deliver_to`, or a plugin `engageThread`), the reason it posted — and any background facts it should carry forward — lives only in the originating conversation. The destination's later auto-responses start without it. Today's `follow_up_context` field partially addresses this, but (a) it only reaches the **answer turn**, never the **pre-analysis judge** that decides whether to respond at all, and (b) it's framed narrowly as "how to handle clarification requests" rather than the general provenance/background of the post. As a result the judge is blind to why a Clack-initiated thread exists, and Claude has no first-class place to record it.

## What Changes

- **BREAKING** (Claude-facing tool schema): rename `follow_up_context` → **`creation_context`** on the `post_to` action and `deliver_to` entries, make it **required**, and broaden its meaning to "the provenance/background this message is being posted with: why you're posting it, facts to remember for later, and how to handle replies." Not shown to users.
- Rename the internal primitive `followUpContext` → `creationContext` consistently: the core `engageThread`/thread-registration helper, the ephemeral-rule field, the plugin SDK `engageThread` option, and the trivia call site.
- Store `creation_context` as a **first-class `SessionContext.creationContext` field** (and on the ephemeral rule), instead of folding it into the general-purpose `additionalSystemPrompt`, so it can be read cleanly and distinctly.
- **Feed it to the auto-respond pre-analysis judge**: both the thread-reply path and the top-level ephemeral-conversation path SHALL surface the seeded `creationContext` to the judge, in addition to the answer turn — so the judge understands why the conversation exists when deciding to engage.
- Inject `creationContext` into the answer turn as a labeled block (preserving today's answer-turn behavior under the new field).

## Capabilities

### New Capabilities
<!-- none: this reworks an existing cross-cutting field -->

### Modified Capabilities
- `submit-response-deliver-to`: the `deliver_to` entry field `follow_up_context` becomes required `creation_context`; stored on the seeded session's `creationContext`.
- `auto-execute-actions`: the `post_to` action field `follow_up_context` becomes required `creation_context`; stored on the seeded session's `creationContext`.
- `engaged-thread-registration`: the helper's `followUpContext` option becomes `creationContext`, stored as a dedicated `SessionContext.creationContext` field (not `additionalSystemPrompt`) and reaching both the judge and the answer turn.
- `auto-respond-pre-analysis`: NEW requirement — the pre-analysis judge SHALL receive the seeded session's / ephemeral rule's `creationContext` as additional classifier context.
- `ephemeral-channel-conversations`: the ephemeral rule's `followUpContext` field becomes `creationContext` and is surfaced to the pre-analysis judge as well as the responding turn.
- `clack-plugins`: the SDK `engageThread` option `followUpContext` becomes `creationContext`.
- `clack-tool-response`: the per-destination field named alongside `channel_attention_level` is `creation_context` (required) rather than `follow_up_context`.
- `trivia-question-posting`: `post_questions` passes its pending-aware guidance via `creationContext` (and it now also reaches that thread's judge).
- `auto-respond`: the ephemeral-rule shape documented in the rule-persistence requirement names `creationContext` (with a legacy `followUpContext` read) instead of `followUpContext`.

## Impact

- **Tool schema (Claude-facing, BREAKING)**: `src/tools/presentation/submitResponse.ts` (`followUpContextField` → required `creationContextField`; `post_to` and `deliver_to` fields + mapping), `src/tools/types.ts`, `src/tools/server.ts`.
- **Seeding + storage**: `src/sessions.ts` (new persisted `creationContext` field + zod, `EngageThreadOptions`), `src/ephemeralRules.ts` (rule field rename + legacy read), `src/slack/handlers/autoExecute.ts`, `src/slack/handlers/handlerResponse.ts`.
- **Judge + answer wiring**: `src/slack/handlers/autoRespond.ts` (feed `creationContext` to pre-analysis on both paths), `src/claude/promptBuilder.ts` (inject the labeled block).
- **Plugin surface**: `src/plugins/sdk.ts` (`engageThread` option), `src/plugins/trivia/tools/questions/postQuestions.ts`.
- **Persisted state**: sessions gain an optional `creationContext` (graceful/additive — no migration); ephemeral rules rename the field with a short-TTL legacy read.
- **No i18n**: all affected strings are Claude-facing (via-Claude path), so they stay English.
