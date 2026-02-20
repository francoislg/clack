import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 2,
  name: "Update custom instructions with delivery context and workMode guidance",
  priority: "blocking",
  prompt: `Update custom instruction override files in data/configuration/ with two changes.
If a file does not exist, skip it — the user will get the updated defaults automatically.

### 1. data/configuration/instructions.md — Delivery context action guidance

Find the "## Submitting Your Response" section. Replace the "Common action patterns" list with delivery-context-aware guidance.

The old pattern looks like:
\`\`\`
Common action patterns:
- Q&A answer: \`accept\`, \`edit\`, \`refine\`, \`reject\`
- Answer needing clarification: \`choice\` actions with options, plus \`refine\` and \`reject\`
- Casual conversation (greetings, compliments, jokes, chitchat): empty actions \`[]\` — no buttons needed
\`\`\`

Replace it with:
\`\`\`
### Actions by Delivery Context
Your prompt includes a \`DELIVERY CONTEXT\` block that tells you how the response will be delivered. Use it to decide which actions to include:

**Ephemeral** (reaction triggered, only visible to requester):
- You MUST include \`accept\`, \`reject\`, and \`refine\` — these control visibility (accept publishes the answer, reject dismisses it)
- Optionally add \`edit\`, \`choice\`, \`followup\`, or change-related actions
- Example Q&A: \`accept\`, \`edit\`, \`refine\`, \`reject\`
- Example needing clarification: \`choice\` actions, plus \`refine\` and \`reject\`

**DM-first** (reaction triggered, answer delivered via DM):
- Include \`send_to_thread\` (lets the user share to the original channel thread) and \`reject\`
- Optionally add \`choice\` or \`followup\` if the answer needs clarification
- The user can also reply in the DM thread to refine — no \`refine\` button needed

**Direct message** (user is chatting with you in a DM):
- Do NOT include \`accept\` or \`reject\` — the message is already delivered to the user
- Optionally add \`choice\`, \`followup\`, or change-related actions if useful
- For simple Q&A, use empty actions \`[]\`

**Channel mention** (@mention in a channel):
- Do NOT include \`accept\` or \`reject\` — the message is already visible in the channel
- Optionally add \`choice\`, \`followup\`, or change-related actions if useful
- For simple Q&A, use empty actions \`[]\`

**Casual conversation** (greetings, compliments, jokes, chitchat): always use empty actions \`[]\` regardless of delivery context.
\`\`\`

Also update the line before the action patterns from:
\`- **actions**: Buttons for the user to interact with.\`
to:
\`- **actions**: Buttons for the user to interact with. Which actions to include depends on the delivery context (see below).\`

If the "Submitting Your Response" section doesn't exist or the "Common action patterns" text isn't found, append the entire "Actions by Delivery Context" block at the end of the file.

### 2. data/configuration/dev_instructions.md — workMode: true on choice actions

Find the line that contains:
\`offer a \\\`choice\\\` action (e.g. "Fix this bug") so the user can quickly request a fix\`

Replace it with:
\`offer a \\\`choice\\\` action (e.g. "Fix this bug") with \\\`workMode: true\\\` so the user can quickly request a fix\`

If this exact text is not found, the file may already be updated or have different wording — skip this change.

### 3. data/configuration/instructions.md — URL-to-MCP guidance

Find the paragraph that starts with:
\`You also have access to MCP integrations\`

After the paragraph that starts with \`While you cannot modify code directly\`, insert the following new section:

\`\`\`
## URLs and MCP Tools
When messages contain URLs, check whether one of your available MCP integrations can fetch data for that service. Match the URL's domain to your MCP tools (e.g. a \\\`github.com\\\` URL → GitHub MCP tools, a \\\`linear.app\\\` URL → Linear MCP tools, a \\\`sentry.io\\\` URL → Sentry MCP tools). Decompose the URL into the identifiers needed by the appropriate tool (owner, repo, PR number, issue ID, run ID, etc.) and call that tool directly. Never try to open or fetch URLs directly — always go through the matching MCP tool.
\`\`\`

If the "URLs and MCP Tools" section already exists, skip this change.`,
  files: ["data/configuration/instructions.md", "data/configuration/dev_instructions.md"],
};
