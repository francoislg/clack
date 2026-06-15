/**
 * The summary fire: post a morning digest of the window's activity to the reporting channel, then
 * clear the log. Channel'd to `reportingChannel`, so it delivers via the normal submit_response path.
 */
export function buildSummaryPrompt(): string {
  return `IDLER SUMMARY FIRE — post the morning digest of what the idler did overnight, then clear the log.

## Steps
1. Call read_activity to get this window's entries.
2. If there are no entries, post a brief "nothing to report" line (or skip). Otherwise compose a concise digest grouped as:
   - PRs opened
   - Comments addressed / threads resolved
   - Reviews & approvals posted
   - Units parked (with the reason)
   - **Ready to merge** (approved PRs awaiting a human)
   - Failures (with the error)
3. Deliver the digest to this channel via submit_response.
4. Call clear_activity so the next window starts fresh.

Keep it skimmable — a human reads this with their coffee. Use plain display names, not pinging mentions, for anyone referenced.`;
}
