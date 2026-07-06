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

Edit this section to list YOUR sources. For each one, describe what to pick up and — per unit — a
\`howToRead\` and \`howToComment\` recipe. The patterns below are source-agnostic; fill them in for
whatever you actually use (an alerting tool, an issue tracker, Slack channels, your own PRs, …).

### Key every unit by a STABLE source-entity id
Use the most durable identifier the source offers (an issue/ticket id, a PR number) — NOT a Slack
message timestamp, which changes on re-post. A re-emitted entity must update its existing unit, never
create a duplicate. Only fall back to channel+ts when no stabler id exists.

### Slack channels
List the channels in the plugin config. When a bot posts detail in message attachments,
\`fetch_channel_messages\` strips attachment blocks — open the permalink with \`fetch_slack_message\`
to read the full content.

### Issue / alert trackers
Filter to the items you want (by label, project, assignee, severity). Prefer the tracker's own MCP
tools for \`howToRead\`/\`howToComment\` when installed; otherwise read the linked URL and reply in the
originating Slack thread. When you open a PR, link it back to the source item in the PR body.

### Clack's own open PRs
Inspect them for continue work (new review comments) and self-review opportunities. Formal review
detection follows the shipped PR-handling contract (canonical review check), which overrides
\`howToRead\` for PR references — no need to spell out review tools in recipes here.

## Prioritization hints
- Prefer continuing in-flight PRs over starting new work.
- Items with reproduction steps are more actionable than vague reports — ask for missing info rather
  than guessing.`;

export async function loadFetchInstructions(sdk: ClackSdk): Promise<string> {
  return sdk.readFileOrSeed(FETCH_INSTRUCTIONS_PATH, DEFAULT_FETCH_INSTRUCTIONS);
}
