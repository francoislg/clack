## Context

Clack supports images end-to-end: `extractAttachments()` pulls image metadata from Slack messages, the prompt builder emits an `ATTACHED FILES` section with `view_slack_image` guidance, and the `view_slack_image` MCP tool returns base64 `ImageContent` on demand. But the per-trigger handlers predate image support and gate on `text` being non-empty:

- `src/slack/handlers/assistant.ts:147` — `if (!msg.user || !msg.text) return;` (DM)
- `src/slack/handlers/mention.ts:42-50` — top-level @mention rejects with "include a question"
- `src/slack/handlers/newQuery.ts:163` — reaction rejects with "Sorry, I couldn't read the message"
- `src/slack/handlers/autoRespond.ts:236` — thread auto-respond skips before pre-analysis runs

The @mention-in-thread case already works because the guard is `if (!messageText && !event.thread_ts)` — the thread branch synthesizes a fallback prompt. We want to extend that pattern consistently.

## Goals / Non-Goals

**Goals:**
- Image-only DMs, @mentions, and reactions reach `processMessage` so Claude can view the image via `view_slack_image` and respond.
- Thread auto-respond runs pre-analysis on image-only replies using synthesized image metadata as the classifier input, so pre-analysis retains full `respond`/`skip`/`stop` authority using thread history as context.
- No changes to the image extraction pipeline, the prompt builder, the `view_slack_image` tool, caching, or Slack scopes.

**Non-Goals:**
- Vision-aware pre-analysis (pre-analysis stays text-only; it sees image *metadata*, not pixels).
- Non-image file types (PDFs, archives) — same scope boundary as `slack-image-support`.
- Image support in the Changes Workflow (still excluded, same as the original image-support design).
- A new "disengage" tool for the main Clack run (the existing pre-analysis `stop` path covers the auto-respond case; reactions and DMs always expect a response when deliberately triggered).

## Decisions

### Decision 1: Gate handlers on `text OR images`, not text alone

**Choice**: In DM, @mention (top-level), and reaction handlers, short-circuit only when both text and image files are absent.

```
// DM (assistant.ts)
if (!msg.user || (!msg.text && !attachments.imageFiles?.length)) return;

// @mention (mention.ts)
if (!messageText && !event.thread_ts && !attachments.imageFiles?.length) {
  // post the "include a question" hint
}

// Reaction (newQuery.ts)
if (!resolved?.text && !resolved?.imageFiles?.length) {
  // post the "couldn't read" ephemeral
}
```

**Alternatives considered**:
- **Always process image-only**: Simpler, but a `:clack:` reaction on a random meme in an unrelated channel would always generate a response. Keeping the gate at "text *or* images" means messages with literally nothing still get the friendly error.
- **Per-channel allowlist**: Overbuilt for the problem — admins can already restrict access via `repoAccess`.

**Rationale**: The minimal change preserves existing "friendly rejection" behavior for empty messages while unblocking the real case.

### Decision 2: Synthesize image metadata for pre-analysis

**Choice**: In `autoRespond.ts`, when `rawText?.trim()` is empty but `event.files` contains images, build a pre-analysis input string in the same `[image: filename (file_id: XXX)]` shape the prompt builder uses. Pass that as `textForAnalysis`.

```
rawText = ""     files = [screenshot.png (F123)]
    │
    ▼
textForAnalysis = "[image: screenshot.png (file_id: F123)]"
    │
    ▼
runPreAnalysis(textForAnalysis, ...)  ──▶  respond / skip / stop
```

**Alternatives considered**:
- **Bypass pre-analysis entirely on image-only**: Simpler but removes the `stop` disengagement signal. Threads could never end via image-only replies, creating a small stickiness bug.
- **Vision-aware pre-analysis**: Add image content to the pre-analysis Claude call. Higher cost, slower, and the existing text history + metadata is usually enough signal. Deferred to future change if needed.

**Rationale**: Pre-analysis's real signal is the thread history (previous 10 messages), not the classifier input text. Filenames are usually noise (`Screenshot_2026-04-20.png`), but pre-analysis can still judge based on surrounding conversation — "active thread + user dropped a screenshot" reliably maps to `respond`; "inactive thread + random image" maps to `stop`. No need for vision.

### Decision 3: Per-trigger fallback user-turn text

**Choice**: When text is empty, each handler passes a minimal synthesized `messageText` to `processMessage`:

| Trigger | Fallback |
|---------|----------|
| DM | `"Answer based on the attached image(s)."` |
| @mention (top-level) | `"Answer based on the attached image(s)."` |
| @mention (in-thread) | (unchanged) `"Read the conversation above and provide an answer or investigation based on what's being discussed."` |
| Reaction | `"A user reacted to this message. Look at the attached image(s) and the surrounding conversation to determine what they're asking, then respond."` |
| Thread auto-respond | `"Answer based on the attached image(s)."` |

**Rationale**: Claude already sees full image metadata and thread context via the prompt builder. The user-turn only needs to say "do your thing" — Claude's system prompt and tool set do the rest. The reaction-specific wording nudges Claude toward `fetch_channel_messages` since the reactor's intent usually lives in adjacent messages.

### Decision 4: Extract a shared `buildImageOnlyPreAnalysisText` helper

**Choice**: Put the image-metadata-synthesis logic in one helper (likely in `autoRespond.ts` or `fileExtractor.ts`) and reuse it for the thread pre-analysis path. The handler-level fallbacks stay as inline constants in each handler since they're trigger-specific strings, not logic.

**Rationale**: The metadata-to-text transformation is the only piece that needs consistency with the prompt builder's format. Keeping it in one place avoids drift if the format evolves.

## Risks / Trade-offs

- **More bot replies, more noise**: Users previously got silence for reaction-triggering image-only posts; now they get responses. → `view_slack_image` is on-demand (Claude may decline to download), and the fallback prompt for reactions nudges Claude to check context before answering — it can still produce a short "I don't have enough context" reply if the image is unrelated.
- **Pre-analysis signal quality on image-only**: Filenames are typically useless; pre-analysis leans on history alone. → Acceptable: in inactive threads, history also carries "this thread has moved on" signal, so `stop` still fires correctly. If this produces too much noise in practice, a follow-up change can add vision to pre-analysis.
- **Test surface**: Each handler has tests asserting the empty-text rejection path. All four need updates to reflect the new "empty AND no images" condition and to cover the new image-only success path. → Mechanical update, low risk.
- **Reaction ambiguity**: Reacting `:clack:` to an image someone else posted without context may produce surprising replies. → The reaction-specific fallback explicitly tells Claude to use surrounding conversation before answering.

## Migration Plan

No data migration. Behavior change ships as a normal deploy. Rollback is a straightforward git revert — no persisted state touched.
