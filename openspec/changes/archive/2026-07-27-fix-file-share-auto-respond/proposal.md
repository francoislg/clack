## Why

Slack delivers any user message carrying an uploaded file as a `message` event with `subtype: "file_share"`. Both the auto-respond listener and the classic DM listener discard every subtyped event except `bot_message`, so **a message with a screenshot attached is silently dropped before rule matching, pre-analysis, or DM routing ever runs**. Users get no reply and no log line — the bot appears simply not to have noticed.

`file_share` is the most common instance but not the only one: of Slack's sixteen message subtypes, three denote a genuine user-authored message and all three are being dropped — `file_share`, `thread_broadcast` (a thread reply also sent to the channel), and `me_message` (`/me`).

This is not theoretical. In #dev-team a product bug report with a screenshot ("Kristen Elliott did not receive her birthday celebration…") matched an active auto-respond rule and produced zero log output; it only got a session because a human reacted manually 6 minutes later. Across 1,733 persisted sessions on the production VM, `autoRespond` (73) and `directMessages` (119) have **never once** carried an image, while `mentions` (a separate `app_mention` event, unaffected by the filter) and `reactions` (re-fetches the message via API) both have.

The code already intends to support this: `resolveAutoRespondContext` synthesizes placeholder text for image-only messages via `buildImageOnlyPreAnalysisText`, and `toClassicDmMessage` extracts `files` — but both paths are unreachable behind the subtype gate. Slack's own Bolt SDK allowlists `file_share` in `isAssistantMessage` for exactly this reason.

## What Changes

- Admit the three subtypes that still denote a real user-authored message — `file_share` (an upload), `thread_broadcast` (a thread reply also sent to the channel), and `me_message` (`/me`) — at the auto-respond listener boundary (`handleAutoRespondMessageEvent`), alongside the existing `bot_message` exception. The other twelve subtypes stay filtered.
- Admit the same three at the classic DM listener boundary (`toClassicDmMessage`), which is also the live path for `dmType: "agent"` deployments. `bot_message` stays rejected there — the DM pipeline must never answer a bot.
- Activate the already-written image handling downstream: image-bearing messages now reach rule matching, pre-analysis (with `buildImageOnlyPreAnalysisText` for text-less uploads), the ephemeral-conversation judge, and `processMessage` with extracted attachments.
- Close the matching gap in the standing-rule path, which — unlike its thread and ephemeral siblings — bails out on empty text instead of synthesizing analysis text from the attached images. Without this, a bare screenshot posted top-level in a rule-covered channel stays dropped even after the gate is opened.
- Add regression coverage asserting a `file_share` event with `files` is admitted and a `message_changed` event is still rejected, on both surfaces.

Not a breaking change: this strictly widens what the bot notices. No config, no schema, no persisted-state changes.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `auto-respond`: the message handler's event-admission contract gains an explicit requirement that `file_share` events are processed as ordinary user messages, making the existing "Include attachments and files" / "Message with empty text but attachments" scenarios actually reachable.
- `slack-classic-dm`: the "Classic DM Event Filtering" requirement currently states "no `subtype`" and has a scenario rejecting *any* subtype; both are amended to allowlist `file_share`.

## Impact

- **Code**: `src/slack/handlers/autoRespond.ts` (listener subtype gate, plus image-only analysis-text synthesis in the standing-rule path so it matches its thread and ephemeral siblings), `src/slack/handlers/classicDm.ts` (`toClassicDmMessage` filter). Tests: `autoRespond.test.ts`, `classicDm.test.ts`.
- **Surfaces affected**: top-level auto-respond, thread auto-respond, ephemeral channel conversations, and DMs under both `dmType: "classic"` and `dmType: "agent"` (agent mode delegates to `handleClassicDmEvent`). The `assistant` DM mode is already correct — Bolt's `isAssistantMessage` allowlists `file_share` upstream.
- **Not affected**: `mentions` (`app_mention` event), `reactions` (API re-fetch), file *extraction* logic (`slack-image-support`, `slack-file-attachments`) — those work today once the message reaches them.
- **Operational**: image-only posts in rule-covered channels now reach the pre-analysis classifier, a modest increase in classifier calls in busy channels. The classifier is expected to skip bare screenshots with no question; worth observing after deploy.
- **Deployment**: code-only change, no manifest re-upload, no scope change, no reinstall.
