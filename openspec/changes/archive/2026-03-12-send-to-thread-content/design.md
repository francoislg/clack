## Context

The `send_to_thread` action lets users share Claude's response to a Slack channel thread. Currently, `submit_response` creates one snapshot of the full response (all sections joined), and every `send_to_thread` button in that response references that same snapshot by ID. At click time, the handler looks up the snapshot from `session.snapshots` and posts it.

This architecture has two bugs:
1. All buttons share one snapshot — multi-option responses post everything instead of the selected option.
2. Snapshot lookups at click time depend on session state being correct — in multi-turn conversations, stale or overwritten state causes the wrong content to be posted.

## Goals / Non-Goals

**Goals:**
- Each `send_to_thread` button posts exactly the content Claude intended for that button
- Eliminate dependency on session-state correctness at click time for content resolution
- Keep the change minimal — only touch the `send_to_thread` path

**Non-Goals:**
- Changing how other action types work (`followup`, `choice`, `change`, etc.)
- Changing the DM-first synthesis flow (Accept/Edit/Reject buttons use a separate code path)
- Optimizing storage — per-button entries in `session.snapshots` is fine for the expected volume

## Decisions

### 1. Add `content` field to `send_to_thread` action schema

Claude specifies the exact text to post for each button. This is the simplest model for the LLM — no index counting, no cross-turn references.

```typescript
// New schema
{
  type: "send_to_thread",
  label?: string,
  content: string,       // <-- new: exact text this button posts
  auto?: boolean,
  channel?: string,
  thread_ts?: string,
}
```

**`content` is required** when `send_to_thread` is used. This prevents the fallback-to-lastAnswer path entirely — every button knows what it sends.

**Alternative considered: `section_indices`** — Claude references sections by index. Rejected because LLMs are unreliable at counting indices, especially when sections are reordered during composition.

### 2. Per-button content entries stored in `session.snapshots`

Reuse the existing `session.snapshots: Record<string, ResponseSnapshot>` field. Each `send_to_thread` action gets its own entry keyed by a unique random ID. The snapshot stores `{ text, sections: [{ body: text }] }`.

This preserves the existing persistence, encoding, and lookup infrastructure. The handler still does `session.snapshots[decoded.snapshotId]` — it just now finds per-button content instead of a full-response blob.

**Alternative considered: inline content in button value** — Avoid persistence entirely by putting content in the Slack button value JSON. Rejected because Slack button values are capped at 2000 bytes — too small for most responses.

### 3. Remove response-wide snapshot and `snapshot` field

The full-response snapshot and the cross-turn `snapshot` reference field are removed. They added complexity for a use case (referencing a previous turn's content) that the `content` field handles more directly — Claude just puts the text in `content`.

The `snapshotId` returned in `submit_response` results is also removed since there's no response-wide snapshot to reference.

### 4. Instruction updates

Remove the "snapshot rule" from instructions. Add guidance that `send_to_thread` requires `content` — the exact text to post. Note that `content` should contain only the shareable portion (no conversational preamble).

## Risks / Trade-offs

**Content duplication** — Claude writes the same text in both `sections` (for display) and `content` (for the button). This is a minor token cost but eliminates all ambiguity about what gets posted.
→ Acceptable trade-off. Claude already duplicates content across labels and descriptions.

**Breaking change for `snapshot` field** — Any existing prompt patterns using `snapshot: "<id>"` will break.
→ Low risk. This feature was rarely used and the `content` field is a direct replacement.

**`content` required on `send_to_thread`** — If Claude omits `content`, the action will fail validation.
→ The schema enforces it, and Claude will see the error and retry. The instructions also document the requirement.
