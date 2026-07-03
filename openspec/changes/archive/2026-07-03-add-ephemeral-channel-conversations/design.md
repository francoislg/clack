# Design: add-ephemeral-channel-conversations

## Context

Clack's engagement machinery is thread-keyed: `AttentionLevel` on a session governs how eagerly thread replies are followed (pre-analysis gate in `src/slack/handlers/autoRespond.ts`), and Claude self-adjusts the dial each turn via `submit_response.attention_level`. Top-level channel messages only trigger through standing `AutoRespondRule`s (`src/autoRespond.ts`) — static admin config where every match spawns a fresh session. When Clack posts top-level (cron digest, `post_to`), the session indexes `responseTs` so *threaded* replies under it find the session, but a reply posted *in the channel* is invisible.

`post_to` and `deliver_to` entries already carry per-destination thread-engagement seeding fields (`attention_level`, `follow_up_context`, `default_delivery_mode` — `submitResponse.ts:119-146`). This change adds the channel-level sibling.

## Goals / Non-Goals

**Goals:**

- Let Clack temporarily follow the channel conversation started by its own top-level post, opt-in per post.
- Decay naturally: unrelated channel traffic shakes the window off without any Claude decision; silence makes it dormant, not leaky.
- Preserve conversational continuity (SDK session resume) and give Claude on-demand access to the whole conversation constellation (thread spin-offs included).
- Zero behavior change when no post opts in; standing rules untouched.

**Non-Goals:**

- No standing "channel attention" config for admins (that's what auto-respond rules already are).
- No back-pointer from spun-off thread sessions to the channel conversation (v2 if needed; forward pointers cover the main risk).
- No multi-window-per-channel; newest-wins.
- No visibility below admin in the Home Tab for v1.

## Decisions

### D1: Chassis — ephemeral `AutoRespondRule`, not a new registry

An ephemeral rule rides the existing rule system: `findMatchingRule` ordering, the top-level message handler, `getRules()`-driven surfaces (Home Tab, `list_auto_respond_rules`) all come for free, and the operator mental model stays unified ("rules, some standing, some temporary").

*Alternative considered*: a channel-window registry like `activeRuns` — rejected; it duplicates matching, persistence, observability, and admin-kill plumbing that rules already have.

### D2: Explicit discriminator, separate persistence file

Rule shape gains `kind: "standing" | "ephemeral"` (absent reads as `"standing"`). Ephemeral-only fields:

- `expiresAt: number` — sliding window end (epoch ms).
- `attentionLevel` — reused from the standing shape; here it is the *live* dial, mutated by ratchet and reframe.
- `sessionIds: string[]` — ordered conversation ledger; `[0]`-anchored, capped at 10 (oldest spin-offs dropped, anchor never dropped).
- `anchorText: string` — the seeding post's text (truncated ~500 chars) for the continuation judge.
- `followUpContext?: string` — mapped from the seed's `follow_up_context`, injected into responding turns (the standing-rule `extraContext` slot).

**Ephemeral rules persist in `data/state/auto-respond-ephemeral.json`, not `auto-respond.json`.** `loadRules()` merges both (ephemeral first). Rationale: on rollback, an old binary parsing `auto-respond.json` would read an ephemeral entry as a *standing match-everything channel rule* (no keywords/userFilters) — a permanent firehose. A separate file is simply invisible to old code. Both readers are graceful/permissive zod per project convention.

The ephemeral type, store, and lifecycle helpers live in their own module, `src/ephemeralRules.ts` (split out of `src/autoRespond.ts` during review — the two concerns have different creation triggers, state machines, and persistence files). `src/autoRespond.ts` keeps the standing-rule CRUD plus the merged `loadRules()`/`getRule()`/`deleteRule()` surface, value-importing from `ephemeralRules.ts` in one direction only (no cycle).

### D3: Seeding — per-destination opt-in field at post time

`post_to` actions and `deliver_to` entries gain `channel_attention_level: "high" | "medium" | "low"` (sibling of the existing per-destination `attention_level`), meaningful only when the destination is top-level (no `thread_ts`; ignored otherwise with a result warning). `"always"` is not seedable — a channel firehose; this mirrors the existing gate cap (`autoRespond.ts:407`). Seeding:

- creates the ephemeral rule for that channel with `sessionIds: [currentSessionId]`, `anchorText` from the posted content, `expiresAt = now + TTL`;
- **newest-wins**: replaces any existing ephemeral rule for the same channel.

TTL is a fixed 60 minutes for v1 (matches the `threadAutoRespondMaxAgeMinutes` default), renewed on every `respond` verdict (sliding window). A config knob can come later if real usage wants it.

### D4: Continuation judge — a third pre-analysis variant

New `runChannelContinuationPreAnalysis` in `src/claude/preAnalysis.ts` alongside the standard and active-run variants. Contract differences from the thread gate:

- **Flipped prior**: in a channel, unrelatedness is the default; the question is "is this message part of the conversation the bot's post started?", not "is this a follow-up?".
- **Inputs**: `anchorText` verbatim, recent channel history (existing enrichment path), author, and the time gap since the bot's last channel message — including *past-expiry* gaps, so a next-morning "actually, one more thing" reads as plausible while a next-morning random message reads as noise.
- **Verdicts**: `respond` / `skip` / `stop`, level-keyed by the rule's current `attentionLevel` like the thread gate.

### D5: Event-driven lifecycle — no timers, expiry is dormancy

The message handler branch (top-level message, ephemeral rule matches the channel):

| Verdict | Within window | Past `expiresAt` (dormant) |
| --- | --- | --- |
| `respond` | continue conversation, renew `expiresAt` | same — conversation revives |
| `skip` | ratchet `attentionLevel` down one rung; below `low` → delete | **delete** (grace is one-shot) |
| `stop` | delete | delete |

The judge always runs while the rule exists — expiry never short-circuits it. Cleanup is entirely at trigger time: an active channel's first unrelated dormant-phase message deletes the rule; a silent channel's rule lingers inert (zero cost until a message arrives). No sweep, no `loadRules()` pruning.

### D6: Matching precedence and single-fire

`findMatchingRule` evaluates ephemeral rules before standing rules; at most one rule fires per message. An ephemeral match routes to the continuation path (D7); only if no ephemeral rule exists (or it was just deleted by its verdict) do standing rules get their normal shot at the same message.

### D7: Continuation, trigger type, and placement

A `respond` verdict **continues the anchor session** (resolved from `sessionIds[0]`) rather than spawning a new session: `processMessage` gains an explicit-session continuation option, the turn resumes `sdkSessionId`, and delivery defaults to top-level in the channel. New `TriggerType` value `"channelReply"` for observability (shallow-filter readers are permissive, so this is additive).

Per-turn placement is Claude's choice via the existing `post_top_level` control: top-level (keeps the channel conversation going; the existing top-level delivery branch already seeds a follow-up thread session for replies under the new post) or the default threaded reply under the user's message (which seeds the same kind of follow-up session for that thread). Either way the seeded thread session is owned by the existing engagement system and its ID is appended to the rule's `sessionIds` — the anchor session record is never re-indexed, so the two mechanisms never fight over a thread key. Prompt guidance: quick conversational beats stay top-level; anything with depth moves to a thread.

Context is **pull-based**: the responding turn's prompt states the conversation has N linked sessions and that `find_sessions` retrieves them — no eager injection.

### D8: Reframing — `channel_attention_level` on responding turns

On `channelReply`-triggered turns, `submit_response` exposes `channel_attention_level` (`"high" | "medium" | "low" | "off"`) which mutates the ephemeral rule; `"off"` deletes it. This is deliberately a separate field from `attention_level` (which continues to govern the anchor *session's thread* dial) — both can meaningfully be set on one turn. Omitting the field leaves the rule's current (possibly ratcheted) level untouched.

### D9: Kill switches

- **Stop emoji**: an inline stop emoji in a *top-level* channel message (today it only targets threads) also deletes the channel's ephemeral rule via the stop pipeline. Reacting with the stop emoji on the bot's top-level post does the same.
- **Home Tab**: ephemeral rows get a "Stop following" button (new action handler) that deletes the rule. They never open the standing-rule edit modal.
- **MCP tools**: `delete_auto_respond_rule` works on ephemeral rules; `update_auto_respond_rule` / toggle reject them with a clear error pointing at `channel_attention_level`.

### D10: Home Tab rendering

`buildAutoRespondSection` splits into two sub-groups: standing rules (unchanged) and "conversations being followed" — per row: channel, current attention rung, `expires in Xm` or `dormant — will re-engage if the conversation resumes`, linked-session count, Stop following button. Admin-only (section visibility unchanged). All new strings through `t()` with en/fr parity.

## Risks / Trade-offs

- **[Cost: one Haiku call per top-level message while a window is live]** → bounded: ≤1 ephemeral rule per channel (newest-wins), skip-ratchet kills windows fast in busy channels, dormant-phase first skip deletes.
- **[Misfire: bot injects itself into unrelated channel talk]** → flipped-prior judge, seed ceiling excludes `always`, ratchet-on-skip, per-turn reframe down, three kill switches.
- **[Rollback safety]** → separate state file (D2); old binaries never read it. Roll-forward deletes any stale entries lazily via the normal lifecycle.
- **[Interleaved multi-user conversations]** → accepted for v1: the window is channel-scoped, not user-scoped; the judge sees authorship and history and decides per message. Thread handoff is the escape hatch for parallel deep conversations.
- **[Anchor session unbounded growth]** (long-lived channel conversations keep appending turns) → same exposure as long threads today; TTL + ratchet bound realistic length.
- **[Two engagement dials on one turn confuse Claude]** → field descriptions explicitly contrast them (destination thread vs channel window); schema only exposes `channel_attention_level` on `channelReply` turns.

## Migration Plan

Additive; no boot migration. New state file appears on first seed. Rollback: old code ignores the ephemeral file entirely (D2). No manifest or scope changes.

## Open Questions

None — resolved during exploration (chassis, discriminator, soft-expiry lifecycle, ledger shape, placement, visibility).
