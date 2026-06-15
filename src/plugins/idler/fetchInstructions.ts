import type { ClackSdk } from "../sdk.js";

export const FETCH_INSTRUCTIONS_PATH = "fetch-instructions.md";

/**
 * Admin-editable sourcing guidance, seeded on first boot. Tells the idler WHICH work to find and
 * HOW to read/comment on each source — kept separate from the shipped behavior contract so editing
 * "what to fetch" can never corrupt "how to behave safely".
 */
export const DEFAULT_FETCH_INSTRUCTIONS = `# Idler fetch instructions

Edit this file to tell the idler what work to look for and how to track it. It is read at every
sync/work fire. (The safety/behavior contract is shipped separately and is not editable here.)

## What counts as "unhandled" in a channel
- A top-level message with no reply and no resolving reaction after a reasonable window.
- Tune per your team's conventions.

## Sources

### Slack channels
List the channels in the plugin config. For each candidate message, create a unit keyed by the
channel+ts ONLY when there is no stabler entity id available.

### Sentry alerts (#sentry-alerts)
Sentry posts alerts as a bot, with the issue detail in message attachments. \`fetch_channel_messages\`
strips attachment blocks, so when the overview is insufficient, open the message permalink with
\`fetch_slack_message\` to read the full alert.
- **Key the unit by the Sentry issue short-id** (e.g. \`PROJ-1Q2W\`) extracted from the alert link —
  NOT the Slack message ts. A re-alerting issue must update the existing unit, never duplicate it.
- howToRead: if a Sentry MCP is installed, \`mcp__sentry__get_issue { issueId }\`; otherwise read the
  Slack message + the linked Sentry URL.
- howToComment: a Sentry MCP comment tool if available, else reply in the alert's Slack thread.
- When you open a PR for the issue, link it back to the Sentry issue in the PR body.

### External tracker (Asana, etc.)
Filter to the bugs/tasks you want the idler to pick up (label, project, assignee). Key units by the
tracker's stable id (Asana gid). howToRead/howToComment use the tracker's MCP tools.

### Clack's own open PRs
Inspect them for continue work (new review comments) and self-review opportunities.

## Prioritization hints
- Prefer continuing in-flight PRs over starting new work.
- Bugs with reproduction steps are more actionable than vague reports — ask for missing info rather
  than guessing.`;

export async function loadFetchInstructions(sdk: ClackSdk): Promise<string> {
  return sdk.readFileOrSeed(FETCH_INSTRUCTIONS_PATH, DEFAULT_FETCH_INSTRUCTIONS);
}
