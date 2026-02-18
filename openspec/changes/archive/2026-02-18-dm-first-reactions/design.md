## Context

Currently, reaction-triggered responses are always delivered as ephemeral messages in the channel thread. Refinement happens through modals (Refine opens a text input modal). This is functional but clunky for iterative work — each refinement round-trips through a modal, and the user never sees their conversation history with Clack.

The bot already supports DMs as a *trigger* method (user messages Clack directly), with thread-based follow-ups. This change introduces DMs as a *response delivery* method for reaction triggers, creating a private conversation space for refinement before public sharing.

Key existing infrastructure:
- `postEphemeralResponse()` in `core.ts` handles current delivery
- `threadReply.ts` handles DM thread replies for DM-originated queries
- `sessions.ts` tracks `channelId`, `threadTs`, `userId` per session
- `homeTab.ts` renders role-based views with modals
- `generate-manifest.ts` conditionally adds scopes based on config
- `notifyHiddenThread` already uses `im:write` to send DMs

## Goals / Non-Goals

**Goals:**
- Allow reaction-triggered answers to be delivered via DM thread instead of ephemeral messages
- Support natural thread-based refinement in DMs (free-form replies + buttons)
- Provide a synthesis step that creates a clean, unified answer from the DM conversation before posting to the channel
- Give users control over post-accept updates (edit in place vs. new reply)
- Allow per-user opt-out from DM mode via Home tab Settings modal
- Keep ephemeral mode fully functional as the alternative path

**Non-Goals:**
- Changing how DM-originated or mention-originated queries work (only reaction triggers affected)
- Supporting DM-first for the changes workflow
- Real-time collaboration (multiple users in the same DM thread)
- Message history / conversation archive beyond session lifetime

## Decisions

### D1: Response delivery routing

**Decision:** Add a `reactions.responseType` config field (`"ephemeral"` | `"directMessage"`) that controls the default delivery method. Per-user preference can override this. The routing decision happens in `core.ts` before response delivery.

**Rationale:** Keeps the decision point centralized. The existing `postEphemeralResponse` path stays untouched; a new `postDmResponse` path is added alongside it. Config-driven so workspaces that don't want DM mode never see it.

**Alternative considered:** A per-user-only setting with no config default — rejected because it requires every user to configure individually and doesn't give admins control.

### D2: DM thread lifecycle

**Decision:** Each reaction trigger creates one DM "root" message (the investigation notice with link to original), and all subsequent interactions happen as replies in that DM thread. The session tracks both `originChannel`/`originThreadTs` (where the reaction was) and `dmChannel`/`dmThreadTs` (the DM conversation).

**Rationale:** Slack threads are natural conversation containers. One root message per investigation keeps the user's DM tidy — they can have multiple concurrent investigations, each in its own thread.

**Alternative considered:** Reusing a single DM thread for all investigations — rejected because it conflates conversations and makes session tracking ambiguous.

### D3: Follow-up mechanism in DM threads

**Decision:** DM thread replies from the user are treated as refinements (similar to current Refine modal flow). The existing `threadReply.ts` handler is extended to detect replies in DM threads that belong to reaction-originated sessions, route them through the same `processMessage` pipeline, and post the response back in the DM thread with action buttons.

**Rationale:** Reuses existing infrastructure. The thread reply handler already handles DM-originated query follow-ups — this extends it to handle reaction-originated query follow-ups delivered to DM.

### D4: Synthesis step

**Decision:** When the user clicks "Send to thread", Clack makes an additional Claude call with a synthesis prompt that summarizes the full DM conversation into a single clean answer. The synthesis is posted in the DM thread for user review with Accept/Edit/Reject buttons.

**Rationale:** Raw DM back-and-forth would look messy in a channel thread. A synthesis pass produces a polished answer. The extra Claude call is acceptable — it's a lightweight summarization task, and it only happens when the user explicitly requests it.

**Prompt approach:** The synthesis call receives the full conversation history and is instructed to produce a unified, clean answer as if responding to the original question directly. No mention of the refinement process.

### D5: Post-accept comeback flow

**Decision:** After the synthesis is accepted and posted to the channel, the DM thread remains active. If the user sends another message, Clack refines and produces a new synthesis. The user is then offered two buttons: "Update original post" (edits the channel message via `chat.update`) and "Post new reply" (adds a new thread reply in the channel).

**Rationale:** Gives the user full control. Editing in place keeps the channel thread clean; posting a new reply is appropriate when the update adds materially new information.

### D6: Per-user preferences storage

**Decision:** Store preferences in `data/state/user-preferences.json` as a simple `{ [userId]: { dmOptOut: boolean } }` map. Default is `false` (DM mode active). Only meaningful when config `reactions.responseType` is `"directMessage"`.

**Rationale:** Follows the existing pattern of file-based state in `data/state/` (alongside `roles.json`). Simple boolean rather than an enum since the only valid override direction is opting out of DM back to ephemeral.

**Alternative considered:** Full `responseType` enum per user — rejected because admins with ephemeral config shouldn't allow users to opt into DM mode (requires scopes the admin may not have configured).

### D7: Thinking feedback in DM mode

**Decision:** In DM mode, the thinking indicator is a DM message: "Looking into this message: <link>. I'll reply here when ready." No emoji reaction is added to the original message. The answer is then posted as a thread reply to this DM message.

**Rationale:** Keeps the channel completely clean — zero trace until the user deliberately shares. The DM message serves as both the thinking indicator and the thread anchor.

### D8: Reject in DM mode

**Decision:** When user clicks Reject in a DM thread, Clack acknowledges with "Got it, discarded." in the thread. The session can be cleaned up normally.

**Rationale:** Can't delete DM messages like ephemeral messages. An acknowledgment provides clear closure.

### D9: NotifyHiddenThread suppression

**Decision:** When the user is in DM mode (config is `directMessage` and user hasn't opted out), skip the `notifyHiddenThread` DM notification since the user is already receiving the answer in DM.

**Rationale:** Avoids confusing double-DMs.

## Risks / Trade-offs

- **Extra Claude call for synthesis** → Adds latency and cost to the "Send to thread" action. Mitigation: only triggered on explicit user action, and synthesis is a lightweight summarization task.
- **DM rate limits** → Slack has rate limits on `chat.postMessage` and `conversations.open`. Mitigation: unlikely to hit limits at normal usage; existing rate limit handling in the bot applies.
- **Session lifetime** → DM threads may be revisited hours/days later. If the session has expired, we need graceful degradation. Mitigation: extend existing expired-session reconstruction to handle DM context (parse origin info from session ID or stored metadata).
- **Scope dependency** → `im:write` must be added to the Slack app when DM mode is enabled. Mitigation: manifest generator handles this automatically; docs/setup guide should mention it.
- **User confusion** → Users accustomed to ephemeral might not understand why nothing appeared in the channel. Mitigation: the DM arrives quickly with a clear link to the original message.
