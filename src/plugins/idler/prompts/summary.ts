/**
 * The summary fire: post a morning digest of the window's activity to the reporting channel, then
 * clear the log. Channel'd to `reporting.channel`, so it delivers via the normal submit_response path.
 *
 * `channel` is the reporting channel ID, embedded so the usage query can scope to this idler's
 * own scheduled fires. It is stable between reconcile and fire, so embedding it is safe.
 *
 * The spend figure is intentionally approximate: `since` is derived from the activity window, so
 * a work fire that consumed tokens but logged no activity is not counted. This is acceptable for
 * a "what did last night cost" digest line — exact accounting is not the goal.
 */
export function buildSummaryPrompt(channel: string): string {
  return `IDLER SUMMARY FIRE — post the morning digest of what the idler did overnight, then clear the log.

## Steps
1. Call read_activity to get this window's entries.
2. Tally this window's spend: call find_recent_interactions with \`channel: "${channel}"\`, \`trigger_type: "scheduled"\`, \`include: ["usage"]\`, and \`since\` set to the start of this window in epoch-milliseconds — use the EARLIEST activity entry's \`at\` timestamp from step 1, or roughly 24 hours before now if there are no entries. Read \`totalUsage\` from the result (it is always present; zero when the window had no sessions). Asking for only the usage section keeps the result small, so this call will not exceed the tool-result size cap.
3. If there are no activity entries, post a brief "nothing to report" line. Otherwise compose a concise digest grouped as:
   - PRs opened
   - Comments addressed / threads resolved
   - Reviews & approvals posted
   - Units parked (with the reason)
   - **Ready to merge** (approved PRs awaiting a human)
   - Failures (with the error)
   Render each item as a Slack hyperlink to its artifact whenever the activity entry's \`detail\` carries a link: \`<url|label>\` (e.g. \`Approved <https://github.com/org/repo/pull/123|PR #123>\`, \`Addressed comments on <permalink|the thread>\`). Use the link from \`detail\` as-is — PR URL, Slack thread permalink, or external surface URL. Items without a link render as plain text.
   End the digest with a spend line: \`🧮 Spend: <inputTokens + outputTokens> tokens · ~$<costUsd to 2 decimals>\` from \`totalUsage\`. Omit this line ONLY if the find_recent_interactions call failed.
4. Deliver the digest to this channel via submit_response with \`suppress_unfurls: true\` so the linked items do not expand into preview cards.
5. Call clear_activity so the next window starts fresh.

Keep it skimmable — a human reads this with their coffee. Use plain display names, not pinging mentions, for anyone referenced.`;
}
