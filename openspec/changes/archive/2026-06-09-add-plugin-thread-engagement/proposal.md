## Why

When a plugin cron posts into a channel — casual-talk via `submit_response({ deliver_to })`, trivia via `post_questions` → `chat.postMessage` — the thread it creates is **fire-and-forget**. The post lands under a channelless session (`channelId: "channelless:<jobId>"`, synthetic `threadTs`), so a human reply in that real thread finds no session via `findSessionByThread(channel, threadTs)`, the thread auto-respond handler bails, and Clack never follows up. The `attentionLevel` dial that would govern engagement lives on the wrong (channelless) session and is inert for the real thread.

This blocks two concrete wants: casual-talk threads should stay conversational when someone replies, and a trivia question thread should answer a player's *public* clarification request (e.g. "do you mean by area or by population?" on a "largest province" question) with the precision they need — without the anti-cheat treating it as cheating.

## What Changes

- Add a **plugin-supplied per-thread engagement**: when a plugin posts into a `(channel, threadTs)`, it may attach an `attentionLevel` and a `followUpContext`. This seeds a real, discoverable session keyed to that destination thread, so the existing thread-reply machinery (`findSessionByThread` → `isEngaged` → pre-analysis → answer turn) engages human replies, with `followUpContext` injected into the answer turn.
- Two entry points over one core primitive:
  - **`deliver_to` entry** gains optional `attention_level` + `follow_up_context` (the Claude-authored path; casual-talk uses it). `post_to` action gains the same fields for parity.
  - **SDK method** `sdk.engageThread(channel, threadTs, { attentionLevel, followUpContext })` (the plugin-code path; trivia's `post_questions` uses it after each `chat.postMessage`).
- **Default `attentionLevel` is `"off"`** — absent ⇒ no engaged session is created ⇒ today's fire-and-forget behavior is preserved exactly. Fully opt-in, no migration.
- **Trivia**: each posted question message engages its thread with a `followUpContext` that tells Clack to re-read the original question message before helping — answer clarifications while the question is still pending (the message hasn't been edited to show the answer), stop once it shows the revealed answer.
- **Trivia anti-cheat carve-out**: a public clarification request on the currently-pending question's own thread is legitimate and answerable; fishing for the answer is **still** cheating.
- **Casual-talk**: the cron prompt instructs Claude to set `attention_level: high` on the `deliver_to` entry when it joins or opens a thread.

## Capabilities

### New Capabilities
- `engaged-thread-registration`: a destination-thread session that a plugin post can seed with a plugin-supplied `attentionLevel` + `followUpContext`, making the existing thread auto-respond path engage human replies in that thread. `"off"` (the default) registers nothing.

### Modified Capabilities
- `submit-response-deliver-to`: each `deliver_to` entry gains optional `attention_level` + `follow_up_context`; a non-`off` level registers the destination thread on delivery.
- `auto-execute-actions`: the `post_to` action gains the same optional fields and registers the destination thread on auto-execute, for parity with `deliver_to`.
- `clack-plugins`: the plugin SDK gains `engageThread(channel, threadTs, { attentionLevel, followUpContext })`.
- `trivia-question-posting`: `post_questions` engages each question thread with a high attention level and a pending-aware clarification `followUpContext`.
- `trivia-cheating-detection`: the detection instruction carves out public clarification requests on the pending question's thread as legitimate, while still treating answer-fishing as cheating.
- `casual-talk-plugin`: the chatter prompt sets `attention_level: high` on the delivered entry so casual threads engage replies.

## Impact

- **Core**: `src/sessions.ts` (engaged-thread registration helper + reuse of `findSessionByThread`/`threadIndex`/`additionalSystemPrompt`/`attentionLevel`), `src/tools/types.ts` (`DeliverToEntry`/`PostToAction` fields), `src/tools/presentation/submitResponse/deliverTo.ts` + `src/tools/server.ts` (delivery wiring), `src/slack/handlers/autoExecute.ts` (post_to wiring).
- **SDK**: `src/plugins/sdk.ts` (`engageThread`).
- **Plugins**: `src/plugins/trivia/tools/questions/postQuestions.ts`, `src/plugins/trivia/prompts/triviaCheckInstruction.ts`, `src/plugins/casual-talk/prompt.ts`.
- **Behavior**: additive and backward-compatible — default `"off"` means no existing plugin or delivery path changes behavior until it opts in. No data migration.
- **Adjacent**: the in-progress `enable-changes-on-thread-replies` change also touches thread-reply gating (changes-workflow availability — a different axis); expected to be independent.
