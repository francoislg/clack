# Proposal: add-ephemeral-channel-conversations

## Why

When Clack posts a top-level channel message (cron digest, `post_to`, scheduled run), replies that land *in the channel* (not in a thread) are invisible to it — the thread-engagement system (`attentionLevel` + pre-analysis) only follows threads, and top-level auto-respond only fires on static, admin-authored rules. Users naturally answer a bot's channel post with another channel message; today that conversation dies unless an admin happens to have a standing rule. This change lets Clack *temporarily follow the channel conversation it just started*, with an attention dial that decays as the channel moves on.

## What Changes

- **Ephemeral auto-respond rules**: Clack can seed a channel-scoped, self-expiring auto-respond rule when it posts a top-level message. Rides the existing `AutoRespondRule` chassis with an explicit `kind: "ephemeral"` discriminator plus `expiresAt`, `sessionIds` (conversation ledger), and `anchorText` fields. Standing (admin) rules are untouched.
- **Opt-in seeding at post time**: a new field on top-level delivery surfaces (`submit_response` top-level/cron delivery and `post_to` actions) lets Claude opt a post into channel-following. Absent → today's behavior, zero change for existing deployments.
- **Continuation judge**: a channel-conversation variant of pre-analysis that asks "is this message part of the conversation Clack's post started?" (unrelatedness is the default prior), receives the anchor post text and the time gap, and returns respond/skip/stop.
- **Event-driven lifecycle, no timers**: every top-level message in the channel runs the judge while an ephemeral rule exists (even past expiry). `respond` → continue the anchor session and renew `expiresAt`; `skip` within the window → ratchet the attention level down one rung; `skip` past expiry → delete the rule; `stop` → delete. Past-expiry rules are *dormant*, not dead — a late genuine continuation (e.g. EOD post, next-morning reply) revives the conversation.
- **Session continuity + ledger**: matches continue the anchor session (SDK session resume), and each session involved in the conversation (anchor + thread spin-offs) is appended to the rule's `sessionIds` so Claude can pull full context on demand via `find_sessions`.
- **Per-turn placement**: Claude chooses top-level (keeps the channel conversation going, renews the window) or a thread reply (hands off to the existing thread-engagement system; the spun-off session joins the ledger).
- **Reframing on response**: each responding turn can set the rule's attention level via `submit_response` (mirroring the existing `attention_level` control), including `"off"` to stop following.
- **Matcher precedence**: ephemeral rules match before standing rules in the same channel; only one fires per message. Newest-wins: a new seeded post in a channel replaces that channel's existing ephemeral rule.
- **Home Tab display (admin-only)**: the auto-respond section splits into standing rules and "conversations being followed" (channel, attention rung, expiry/dormant state, linked-session count, Stop following button). Ephemeral rules never open the standing-rule edit modal.

## Capabilities

### New Capabilities

- `ephemeral-channel-conversations`: the conversation-window concept — seeding at post time, ephemeral rule shape (`kind`, `expiresAt`, `sessionIds`, `anchorText`), the continuation judge contract, the event-driven lifecycle (ratchet / dormancy / revival / deletion), session continuation + ledger semantics, per-turn placement and thread handoff, reframing via `submit_response`, and seed-level ceiling.

### Modified Capabilities

- `auto-respond`: rule persistence schema gains the ephemeral variant; matching gains ephemeral-first precedence and one-rule-fires semantics; the message handler routes ephemeral matches through the continuation lifecycle instead of spawning a fresh session.
- `auto-respond-pre-analysis`: new channel-continuation judge variant (flipped prior, anchor-text input, expiry-gap signal) alongside the existing thread and rule gates.
- `auto-respond-rule-tools`: `list_auto_respond_rules` surfaces ephemeral rules (so Claude can see what it's following); mutation tools (`update`/`toggle`) reject ephemeral rules; `delete` works (admin kill switch).
- `clack-tool-response`: `submit_response` (and `post_to` action entries) gain the channel-following opt-in field at post time and the channel attention reframe on responding turns.
- `home-tab`: auto-respond section renders the two sub-groups, dormant state, and the Stop following action.

## Impact

- **Code**: `src/autoRespond.ts` (rule shape, zod schema, matching, lifecycle mutations), `src/slack/handlers/autoRespond.ts` (ephemeral branch, continuation routing), `src/claude/preAnalysis.ts` (continuation variant), `src/tools/presentation/submitResponse.ts` (seed + reframe fields), `src/tools/actions/postTo`-related staging, `src/tools/query/listAutoRespondRules.ts`, `src/slack/homeTab.ts` + a new action handler (Stop following), `src/slack/stopPipeline.ts` (stop emoji kills the channel window), i18n strings (en/fr).
- **State**: `data/state/auto-respond.json` stays standing-rules-only; ephemeral rules live in a new `data/state/auto-respond-ephemeral.json` (graceful/permissive zod reader per project convention) merged by `loadRules()` — a separate file so a rolled-back binary can never misread an ephemeral rule as a standing match-everything channel rule.
- **Behavior**: fully inert unless Claude opts a post in; standing rules, thread engagement, and all existing auto-respond behavior unchanged when no ephemeral rule exists.
- **Cost**: one Haiku pre-analysis call per top-level channel message while a window is live; bounded by the skip-ratchet (busy channels shake the window off fast) and newest-wins (≤1 ephemeral rule per channel).
