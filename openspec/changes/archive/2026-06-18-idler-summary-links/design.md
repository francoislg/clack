## Context

The idler's morning digest is composed by Claude from `read_activity` entries. Each entry is `{ at, kind, unitKey?, detail }`, where `detail` is a free-text one-liner. `buildSummaryPrompt` (`prompts/summary.ts`) groups entries by category but never asks for links, and the digest is delivered via `submit_response`, which already exposes a top-level `suppress_unfurls: boolean`. The work fire (`prompts/work.ts`, step 5) records each action via `record_activity`; at that moment it already holds the artifact's address — it just opened the PR or read the Slack thread via tools that return permalinks (`fetch_channel_messages`/`fetch_slack_message` carry a `url`).

## Goals / Non-Goals

**Goals:**
- Every digest item that has an artifact links to it (PR, Slack thread, or external surface).
- The digest message does not unfurl those links into preview cards.
- Prompt-only: no schema, tool-arg, data-format, or config change.

**Non-Goals:**
- No structured `url` field on the activity entry (rejected in exploration in favor of the cheaper prompt-only path).
- No reconstruction of links from a unit's `references[]` at summary time — closed units drop off `list_top_ideas`, so the link must be baked into `detail` at record time.
- No new Slack-permalink capability — the work fire already obtains permalinks from existing read tools.

## Decisions

1. **Link is captured at record time, in `detail`.** Tighten the `record_activity` `detail` description (`tools/activity.ts`) to require the canonical link to the artifact the action touched — PR URL, Slack thread permalink, or external surface URL. This is the only point where the real href reliably exists; the summary cannot recover it later for closed units.
2. **Render links in the digest.** `buildSummaryPrompt` step 3 instructs each reported item to render as a Slack hyperlink `<url|label>` (e.g. "Approved <pr-url|PR #123>") when the entry's `detail` carries one.
3. **Suppress unfurling on delivery.** `buildSummaryPrompt` step 4 calls `submit_response` with `suppress_unfurls: true`. This is the only reliable suppression mechanism — Slack unfurls bare and labeled URLs regardless of formatting; it is a `chat.postMessage` param, not a Claude-formatting concern.

## Risks / Trade-offs

- **Soft enforcement.** `detail` stays free text, so link presence depends on Claude following the tightened description. Acceptable: the digest is a human-read convenience, not a contract; a missing link degrades to plain text, never an error.
- **Stale/wrong links.** A recorded link is a point-in-time snapshot; if an artifact later moves it could go stale. Low impact for an overnight digest read the next morning.
