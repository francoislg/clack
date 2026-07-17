/**
 * The summary fire: post a morning digest of the window's activity to the reporting channel, then
 * clear the log. Channel'd to `reporting.channel`, so it delivers via the normal submit_response path.
 *
 * The spend tally scopes by the `plugin:idler` system actor over a server-computed 24h window,
 * so it covers channel'd AND channelless idler fires and never depends on Claude doing date
 * math. Worker implement runs fold their usage back onto the idler session that staged them
 * (`addSessionUsage` in executeChange), so they are counted too — except runs continuing a
 * session created before the window, which is acceptable for an approximate digest line.
 */
export function buildSummaryPrompt(): string {
  return `IDLER SUMMARY FIRE — post the morning digest of what the idler did overnight, then clear the log.

## Steps
1. Call read_activity to get this window's entries.
2. Tally this window's spend: call find_recent_interactions with \`plugin: "idler"\`, \`trigger_type: "scheduled"\`, \`include: ["usage"]\`, and \`since_hours: 24\`. Do NOT pass \`since\` and never compute epoch timestamps yourself — the server derives the cutoff from its own clock. Read \`totalUsage\` from the result (it is always present; zero when the window had no sessions). Asking for only the usage section keeps the result small, so this call will not exceed the tool-result size cap.
3. If there are no activity entries, post a brief "nothing to report" line. Otherwise compose a concise digest grouped as:
   - PRs opened
   - Comments addressed / threads resolved
   - Reviews & approvals posted
   - Units parked (with the reason)
   - **Ready to merge** (approved PRs awaiting a human)
   - Failures (with the error)
   Render each item as a Slack hyperlink to its artifact whenever the activity entry's \`detail\` carries a link: \`<url|label>\` (e.g. \`Approved <https://github.com/org/repo/pull/123|PR #123>\`, \`Addressed comments on <permalink|the thread>\`). Use the link from \`detail\` as-is — PR URL, Slack thread permalink, or external surface URL. Items without a link render as plain text.
   End the digest with a spend line: \`🧮 Spend: <inputTokens + outputTokens> tokens · ~$<costUsd to 2 decimals>\` from \`totalUsage\`. The total already includes worker implement runs (their usage folds back onto the idler session that staged them). Omit this line ONLY if the find_recent_interactions call failed.
4. Deliver the digest to this channel via submit_response with \`suppress_unfurls: true\` so the linked items do not expand into preview cards.
5. Call clear_activity so the next window starts fresh.

Keep it skimmable — a human reads this with their coffee. Use plain display names, not pinging mentions, for anyone referenced.`;
}
