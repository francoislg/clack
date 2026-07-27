## Context

Two listener boundaries independently reject Slack `message` events that carry an uploaded file.

`src/slack/handlers/autoRespond.ts:693-696`:

```ts
// Skip non-message subtypes (edits, deletes, joins, etc.) — but allow bot_message through
if ("subtype" in event && event.subtype !== undefined && event.subtype !== "bot_message") {
  return;
}
```

`src/slack/handlers/classicDm.ts:85`:

```ts
if (e.subtype !== undefined) return null;
```

Slack sends `subtype: "file_share"` for a user message with an attachment. Neither gate anticipated it — the comment enumerates "edits, deletes, joins", all genuinely non-conversational. `file_share` is the odd one out: it is a real user message that happens to carry a file.

The evidence that this is a gate problem and not a downstream problem:

- `resolveAutoRespondContext` already handles image-bearing messages at `autoRespond.ts:286-295` (thread path) and `autoRespond.ts:563-571` (ephemeral path), calling `buildImageOnlyPreAnalysisText` to synthesize analysis text for a text-less upload. Those two call sites are the **only** consumers of that helper in the codebase, and both are unreachable today.
- `respond()` extracts attachments at `autoRespond.ts:776` and forwards them to `processMessage`.
- `toClassicDmMessage` reads `e.files` at `classicDm.ts:97`, two lines after the gate that guarantees it never sees any.
- `@slack/bolt`'s own `isAssistantMessage` (`Assistant.js:106-112`) allowlists `file_share` explicitly, which is why the `assistant` DM mode has never had this bug.

Production data across 1,733 sessions: `autoRespond` 73/0 with images, `directMessages` 119/0, versus `mentions` 78/2 and `reactions` 1/1. The two broken surfaces are exactly the two behind these gates.

`dmType` is `"agent"` in the live deployment, and `registerAgent` (`agent.ts:74-77`) delegates to `handleClassicDmEvent`, so the classic gate is on the hot path for DMs today.

## Goals / Non-Goals

**Goals:**

- A user message with an attachment reaches auto-respond rule matching, pre-analysis, and `processMessage` exactly as the same message without an attachment would.
- The same for DMs under `dmType: "classic"` and `dmType: "agent"`.
- Keep every other subtype filtered; `message_changed` in particular must stay with the dedicated `messageChanged` handler.
- Regression tests that fail against the current code.

**Non-Goals:**

- No change to file extraction, caching, or the image/file MIME allowlists (`slack-image-support`, `slack-file-attachments` already work once a message reaches them).
- No change to the `assistant` DM path — Bolt handles it upstream.
- No change to pre-analysis prompts or verdict semantics. The classifier decides whether a screenshot post deserves a reply; this change only lets it see the message.
- No new config flag. The current behavior is a defect, not a policy, so there is nothing to opt into.

## Decisions

**Decision: allowlist the subtype rather than invert to a denylist, and admit exactly the three that are real messages.**

`@slack/types` enumerates sixteen message subtypes (`node_modules/@slack/types/dist/events/message.d.ts`). They fall into four groups:

| Group | Subtypes | Verdict |
|---|---|---|
| Genuine user message | `file_share`, `thread_broadcast`, `me_message` | **Admit** — each carries `user` + `text` and was authored by a person |
| Bot output | `bot_message` | Admit in auto-respond (rules deliberately target bot posts, e.g. the Sentry alert rule); reject in classic DM |
| Hidden meta | `message_changed`, `message_deleted`, `message_replied` | Reject — all carry `hidden: true`; edits stay owned by `messageChanged.ts` |
| Channel lifecycle | `channel_join`, `channel_leave`, `channel_topic`, `channel_purpose`, `channel_name`, `channel_archive`, `channel_unarchive`, `channel_posting_permissions`, `ekm_access_denied` | Reject |

`thread_broadcast` and `me_message` are the same defect as `file_share`, just rarer: a person typed a message and the gate threw it away. Fixing only `file_share` would knowingly leave two instances of the bug in place.

The alternative shape is a denylist — enumerate what to *reject* and admit everything else. Rejected: nine of the sixteen are channel lifecycle noise, so the denylist is longer than the allowlist and it fails open. Slack adds subtypes over time, and an open-by-default gate would silently begin feeding join/leave/topic-change events into the pre-analysis classifier the next time one ships. An allowlist fails closed, the right failure direction for an event boundary, and it matches what Bolt itself does in `isAssistantMessage`.

**Decision: express the allowlist as a per-handler constant rather than a chained `!==`.**

A chain of `!==` reads fine at two entries and badly at four. A module-level `Set` in each handler keeps the gate a single readable predicate. The two handlers keep their own constant rather than sharing one — their allowlists genuinely differ (`autoRespond` admits `bot_message`, `classicDm` must keep rejecting it), so a shared constant would be a false abstraction that immediately needs a parameter to undo it.

The two gates read the subtype from differently-typed values, so they narrow differently. In `autoRespond` the event is Bolt's discriminated `MessageEvent` union, where `subtype` is already `string`, and `ADMITTED_SUBTYPES.has(event.subtype)` type-checks directly. In `classicDm` the handler validates a structurally-typed `RawMessageEvent` whose `subtype` is `unknown` (it is an untrusted boundary payload), so membership goes through a small `isAdmittedSubtype(subtype: unknown): boolean` guard that checks `typeof === "string"` first. Widening the Set to `ReadonlySet<unknown>` was considered and rejected — the guard keeps the Set honestly typed as strings and puts the narrowing where the untyped value actually enters.

**Decision: the top-level standing-rule path must also synthesize image-only analysis text.**

Opening the gate is necessary but not sufficient. Three paths inside `resolveAutoRespondContext` build the text handed to pre-analysis, and only two of them handle a text-less upload:

- thread path (`autoRespond.ts:286-295`) — synthesizes via `buildImageOnlyPreAnalysisText`
- ephemeral path (`autoRespond.ts:563-571`) — synthesizes via `buildImageOnlyPreAnalysisText`
- standing-rule path (`autoRespond.ts:459-461`) — `const textForAnalysis = rawText?.trim(); if (!textForAnalysis) return null;`

The third drops an image-only message even after the gate admits it. That is the single most common real-world shape of this bug: someone posts a bare screenshot in a rule-covered channel. Leaving it would make the fix true for thread replies and ephemeral windows but silently false for the top-level case the proposal is motivated by, and would make the "Image-only file-share message reaches pre-analysis" requirement unimplementable at the top level.

So the standing-rule path gets the same synthesis the other two already have — but rather than copy the block a third time, all three now call one `resolveAnalysisText(rawText, rawFiles)` helper returning `string | null`. The drift between these three siblings is what produced this bug in the first place, and the spec now carries a requirement that they behave uniformly; a shared helper makes that uniformity structural instead of three parallel implementations that agree by coincidence. Each call site keeps its own empty-case handling (the thread path logs before returning), which is the only thing that legitimately differs.

Alternative considered: narrow the spec to exempt the top-level path. Rejected — it would codify an inconsistency between three sibling code paths that have no reason to differ, and it would not fix the reported bug for text-less posts.

Note this also means `findMatchingRule(channelId, messageUser, rawText)` still receives the raw (empty) text. That is correct and unchanged: a keyword-filtered rule genuinely cannot match a message with no words, while an unfiltered or user-filtered rule matches on channel/author alone and proceeds.

**Decision: no change to the `mentions` or `reactions` paths.**

`app_mention` is a distinct event type never routed through these gates, and the reaction handler re-fetches the target message through the Web API where `conversations.history` has already normalized the subtype away. Both demonstrably carry images in production today. Touching them would be scope creep.

**Decision: type handling stays structural.**

`MessageEvent` is a discriminated union (`GenericMessageEvent | BotMessageEvent | FileShareMessageEvent | …`). The existing code narrows with `"subtype" in event` and reads `files` via `"files" in event && Array.isArray(event.files)` (`autoRespond.ts:729`), which already type-checks against `FileShareMessageEvent`. No cast or type widening is needed; verify with `npx tsc`.

## Risks / Trade-offs

**[Higher classifier volume in rule-covered channels]** → Image-only posts now reach pre-analysis instead of being dropped for free. In a busy channel with an `attentionLevel: high` rule (e.g. `a2f2f6b0` on #dev-team) this is a real, if modest, increase in Haiku classifier calls. Mitigation: the `buildImageOnlyPreAnalysisText` placeholder is deliberately low-signal, so a bare screenshot with no question should classify as "skip". Watch `Pre-analysis result` log volume for a day after deploy; if screenshots are being over-answered, the fix is the rule's `preAnalysisContext`, not the gate.

**[Unwanted replies to screenshot-only chatter]** → A channel where people paste images casually could see the bot chime in where it previously stayed silent. Mitigation: same as above — this is a per-rule prompt tuning question, and rule owners can already tighten `preAnalysisContext` from the Home Tab without a deploy.

**[Regression: admitting a subtype that should stay out]** → Guarded by the tests in this change: a `message_changed` event must still be rejected on both surfaces, which is the specific behavior the current gate exists to protect.

## Migration Plan

Code-only. No config keys, no persisted-state shape change, no zod schema change, no Slack manifest change, no scope change, no workspace reinstall. Deploy via the normal `scripts/gce-update-image.sh` path.

Rollback is a revert of the two gate edits; nothing is written to disk that a rollback would have to undo.

Verification after deploy: post a message with a screenshot in a rule-covered channel and confirm a `Pre-analysis result` line appears in `docker logs clack` for it — the absence of that line is precisely the symptom this change fixes.

## Open Questions

None. The failure mode, the two responsible lines, and the upstream precedent (Bolt's own allowlist) are all confirmed.
